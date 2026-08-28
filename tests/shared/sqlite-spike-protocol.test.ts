import { readFile, rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  activeSessionPath,
  clearActiveSpikeSession,
  createSpikeRequest,
  createSpikeSession,
  eventPath,
  readyPath,
  readJson,
  requestPath,
  responsePath,
  SPIKE_PROTOCOL_VERSION,
  SpikeSession,
  validateSpikeReport,
  validateSpikeSession,
  waitForJson,
  waitForSessionMarker,
  writeSessionMarker,
  writeJsonAtomic,
} from "../../src/shared/sqlite-spike/protocol";
import {
  initializeSyntheticSchema,
  openSpikeDatabase,
  countMarker,
  withImmediateTransaction,
  insertMarker,
} from "../../src/shared/sqlite-spike/database";
import { runRaycastSqliteSpike } from "../../src/shared/sqlite-spike/raycast-peer";

const sessions: SpikeSession[] = [];

afterEach(async () => {
  await Promise.all(
    sessions.splice(0).map(async (session) => {
      await clearActiveSpikeSession(session);
      await rm(session.sessionDirectory, { recursive: true, force: true });
    }),
  );
});

describe("SQLite spike protocol", () => {
  it("round-trips an active temporary session", async () => {
    const session = await createSpikeSession();
    sessions.push(session);
    expect(validateSpikeSession(await readJson(activeSessionPath()))).toEqual(session);
  });

  it("rejects expired, future, and path-mismatched sessions", async () => {
    const now = Date.now();
    const session = await createSpikeSession(now);
    sessions.push(session);

    expect(() => validateSpikeSession(session, now + 11 * 60 * 1_000)).toThrow("expired");
    expect(() => validateSpikeSession(session, now - 10_000)).toThrow("future");
    expect(() => validateSpikeSession({ ...session, databasePath: "/tmp/other.sqlite" }, now)).toThrow(
      "does not match",
    );
  });

  it("validates the structured report contract", () => {
    const report = {
      protocolVersion: SPIKE_PROTOCOL_VERSION,
      sessionId: "00000000-0000-4000-8000-000000000000",
      status: "pass" as const,
      startedAt: "2026-08-24T00:00:00.000Z",
      finishedAt: "2026-08-24T00:00:01.000Z",
      runtimes: { node24: { node: "24.18.0" }, raycast: { node: "22.22.2" } },
      checks: [{ name: "example", status: "pass" as const, durationMs: 1, details: {} }],
    };

    expect(validateSpikeReport(report)).toEqual(report);
    expect(() => validateSpikeReport({ ...report, checks: [{ ...report.checks[0], durationMs: -1 }] })).toThrow(
      "duration",
    );
  });

  it("does not let stale cleanup remove a replacement active session", async () => {
    const first = await createSpikeSession();
    const second = await createSpikeSession();
    sessions.push(first, second);
    await writeJsonAtomic(activeSessionPath(), second);

    await clearActiveSpikeSession(first);
    expect(validateSpikeSession(await readJson(activeSessionPath()))).toEqual(second);
  });

  it("rejects a marker from another session", async () => {
    const session = await createSpikeSession(Date.now(), false);
    sessions.push(session);
    const path = eventPath(session, "test", "release");
    await writeJsonAtomic(path, { protocolVersion: session.protocolVersion, sessionId: "stale-session" });
    await expect(waitForSessionMarker(session, path)).rejects.toThrow("Invalid SQLite spike session marker");
  });
});

async function shortSession(lifetimeMs = 300): Promise<SpikeSession> {
  const session = await createSpikeSession(Date.now(), false);
  session.expiresAt = new Date(Date.now() + lifetimeMs).toISOString();
  sessions.push(session);
  initializeSyntheticSchema(session.databasePath);
  return session;
}

describe("SQLite spike peer lifetime", () => {
  it("expires while idle without finish and refuses later requests", async () => {
    const session = await shortSession();
    const outcome = runRaycastSqliteSpike(session).catch((error: unknown) => error);
    await waitForJson(readyPath(session));
    expect(await outcome).toMatchObject({ message: "SQLite spike session has expired" });
    expect(Date.now() - Date.parse(session.expiresAt)).toBeLessThan(250);

    const request = createSpikeRequest(session, "write-marker", { label: "too-late" });
    await writeJsonAtomic(requestPath(session, request.requestId), request);
    await expect(runRaycastSqliteSpike(session)).rejects.toThrow("expired");
    await expect(readFile(responsePath(session, request.requestId))).rejects.toMatchObject({ code: "ENOENT" });
    const db = openSpikeDatabase(session.databasePath);
    try {
      expect(countMarker(db, "too-late")).toBe(0);
    } finally {
      db.close();
    }
  });

  it("rolls back a held transaction when the session expires", async () => {
    const session = await shortSession();
    const outcome = runRaycastSqliteSpike(session).catch((error: unknown) => error);
    await waitForJson(readyPath(session));
    const request = createSpikeRequest(session, "hold-write", { label: "expired-hold" });
    await writeJsonAtomic(requestPath(session, request.requestId), request);
    await waitForSessionMarker(session, eventPath(session, request.requestId, "started"));
    expect(await outcome).toMatchObject({ message: "SQLite spike session has expired" });
    expect(await readJson(responsePath(session, request.requestId))).toMatchObject({
      status: "error",
      error: { message: "SQLite spike session has expired" },
    });
    const db = openSpikeDatabase(session.databasePath);
    try {
      expect(countMarker(db, "expired-hold")).toBe(0);
      withImmediateTransaction(db, () => insertMarker(db, "test", "after-expiry"));
    } finally {
      db.close();
    }
    await expect(readFile(`${session.databasePath}-journal`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("still finishes normally before expiry", async () => {
    const session = await shortSession(2_000);
    const running = runRaycastSqliteSpike(session);
    await waitForJson(readyPath(session));
    const request = createSpikeRequest(session, "finish");
    await writeJsonAtomic(requestPath(session, request.requestId), request);
    await expect(running).resolves.toBeUndefined();
    expect(await readJson(responsePath(session, request.requestId))).toMatchObject({
      status: "ok",
      output: { finished: true },
    });
  });

  it("does not accept a release marker after the deadline", async () => {
    const session = await shortSession(50);
    const path = eventPath(session, "test", "release");
    await writeSessionMarker(session, path);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 60));
    await expect(waitForSessionMarker(session, path)).rejects.toThrow("expired");
  });
});
