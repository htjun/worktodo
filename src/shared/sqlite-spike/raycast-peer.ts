import { mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getRuntimeInfo } from "../runtime-info";
import {
  applySyntheticMigration,
  countMarker,
  insertMarker,
  openSpikeDatabase,
  readSpikePragmas,
  sqliteErrorCode,
  verifySpikeDatabase,
  withImmediateTransaction,
} from "./database";
import {
  eventPath,
  loadActiveSpikeSession,
  readJson,
  responsePath,
  SpikeRequest,
  SpikeResponse,
  SpikeSession,
  validateSpikeRequest,
  waitForJson,
  writeJsonAtomic,
  readyPath,
} from "./protocol";

function requiredParameter(request: SpikeRequest, name: string): string {
  const value = request.parameters[name];
  if (!value) {
    throw new Error(`Missing SQLite spike request parameter: ${name}`);
  }
  return value;
}

async function handleRequest(session: SpikeSession, request: SpikeRequest): Promise<Record<string, unknown>> {
  if (request.action === "finish") {
    return { finished: true };
  }

  if (request.action === "verify-backup") {
    const backupPath = requiredParameter(request, "backupPath");
    if (resolve(backupPath) !== join(session.sessionDirectory, "verified-backup.sqlite")) {
      throw new Error("Backup path is outside the active SQLite spike session");
    }
    const db = openSpikeDatabase(backupPath, { readOnly: true });
    try {
      return { verification: verifySpikeDatabase(db), pragmas: readSpikePragmas(db) };
    } finally {
      db.close();
    }
  }

  const db = openSpikeDatabase(session.databasePath);
  try {
    switch (request.action) {
      case "runtime":
        return { ...getRuntimeInfo(), pragmas: readSpikePragmas(db) };

      case "read-marker": {
        const label = requiredParameter(request, "label");
        return { label, count: countMarker(db, label) };
      }

      case "write-marker": {
        const label = requiredParameter(request, "label");
        const startedAt = performance.now();
        try {
          withImmediateTransaction(db, () => insertMarker(db, "raycast", label));
          return { label, outcome: "committed", elapsedMs: performance.now() - startedAt };
        } catch (error) {
          return {
            label,
            outcome: "error",
            elapsedMs: performance.now() - startedAt,
            code: sqliteErrorCode(error),
            message: error instanceof Error ? error.message : String(error),
          };
        }
      }

      case "hold-write": {
        const label = requiredParameter(request, "label");
        const startedAt = performance.now();
        db.exec("BEGIN IMMEDIATE");
        try {
          insertMarker(db, "raycast", label);
          await writeJsonAtomic(eventPath(session, request.requestId, "started"), {
            startedAt: new Date().toISOString(),
          });
          const release = await waitForJson(eventPath(session, request.requestId, "release"));
          const commit =
            typeof release === "object" && release !== null && "commit" in release && release.commit === true;
          db.exec(commit ? "COMMIT" : "ROLLBACK");
          return { label, outcome: commit ? "committed" : "rolled-back", elapsedMs: performance.now() - startedAt };
        } catch (error) {
          if (db.isTransaction) {
            db.exec("ROLLBACK");
          }
          throw error;
        }
      }

      case "migrate": {
        const gate = requiredParameter(request, "gatePath");
        if (resolve(gate) !== resolve(session.sessionDirectory, "gates", "migration.json")) {
          throw new Error("Migration gate is outside the active SQLite spike session");
        }
        await waitForJson(gate);
        return { migration: applySyntheticMigration(db, "raycast") };
      }

      case "foreign-key": {
        try {
          db.prepare("INSERT INTO spike_child(id, parent_id) VALUES (?, ?)").run(10_001, 99_999);
          return { rejected: false, code: null };
        } catch (error) {
          return {
            rejected: true,
            code: sqliteErrorCode(error),
            message: error instanceof Error ? error.message : String(error),
          };
        }
      }

      case "rollback-exception": {
        const label = requiredParameter(request, "label");
        let caught = false;
        try {
          withImmediateTransaction(db, () => {
            insertMarker(db, "raycast", label);
            throw new Error("intentional Raycast rollback probe");
          });
        } catch (error) {
          caught = error instanceof Error && error.message === "intentional Raycast rollback probe";
        }
        return { caught, count: countMarker(db, label), inTransaction: db.isTransaction };
      }

      case "hold-read": {
        db.exec("BEGIN");
        try {
          const markerCount = Number(db.prepare("SELECT COUNT(*) AS count FROM spike_marker").get()?.count ?? 0);
          await writeJsonAtomic(eventPath(session, request.requestId, "started"), {
            startedAt: new Date().toISOString(),
            markerCount,
          });
          await waitForJson(eventPath(session, request.requestId, "release"));
          db.exec("COMMIT");
          return { markerCount };
        } catch (error) {
          if (db.isTransaction) {
            db.exec("ROLLBACK");
          }
          throw error;
        }
      }

      case "verify":
        return { verification: verifySpikeDatabase(db), pragmas: readSpikePragmas(db) };
    }
  } finally {
    db.close();
  }
}

async function nextRequest(session: SpikeSession, processed: Set<string>): Promise<SpikeRequest> {
  const requestsDirectory = join(session.sessionDirectory, "requests");

  while (true) {
    const names = (await readdir(requestsDirectory)).filter((name) => name.endsWith(".json")).sort();
    const name = names.find((candidate) => !processed.has(candidate));
    if (name) {
      return validateSpikeRequest(await readJson(join(requestsDirectory, name)), session);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
}

export async function runRaycastSqliteSpike(): Promise<void> {
  const session = await loadActiveSpikeSession();
  await Promise.all(
    ["requests", "responses", "events", "gates"].map((name) =>
      mkdir(join(session.sessionDirectory, name), { recursive: true }),
    ),
  );
  await writeJsonAtomic(readyPath(session), {
    protocolVersion: session.protocolVersion,
    sessionId: session.sessionId,
    ...getRuntimeInfo(),
    readyAt: new Date().toISOString(),
  });

  const processed = new Set<string>();
  let finished = false;

  while (!finished) {
    const request = await nextRequest(session, processed);
    const requestFileName = `${request.requestId}.json`;
    const startedAt = new Date().toISOString();
    let response: SpikeResponse;

    try {
      const output = await handleRequest(session, request);
      response = {
        protocolVersion: session.protocolVersion,
        sessionId: session.sessionId,
        requestId: request.requestId,
        status: "ok",
        startedAt,
        finishedAt: new Date().toISOString(),
        output,
      };
    } catch (error) {
      response = {
        protocolVersion: session.protocolVersion,
        sessionId: session.sessionId,
        requestId: request.requestId,
        status: "error",
        startedAt,
        finishedAt: new Date().toISOString(),
        error: {
          message: error instanceof Error ? error.message : String(error),
          code: sqliteErrorCode(error),
        },
      };
    }

    await writeJsonAtomic(responsePath(session, request.requestId), response);
    processed.add(requestFileName);
    finished = request.action === "finish";
  }
}
