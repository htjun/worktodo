import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  activeSessionPath,
  clearActiveSpikeSession,
  createSpikeSession,
  readJson,
  SPIKE_PROTOCOL_VERSION,
  SpikeSession,
  validateSpikeReport,
  validateSpikeSession,
  writeJsonAtomic,
} from "../../src/shared/sqlite-spike/protocol";

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
});
