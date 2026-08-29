import { mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getRuntimeInfo } from "../runtime-info";
import {
  countMarker,
  insertMarker,
  openSpikeDatabase,
  readSpikePragmas,
  sqliteErrorCode,
  verifySpikeDatabase,
  withImmediateTransaction,
} from "./database";
import { runMigrationContender } from "./migration";
import { validateTaskModelSchema } from "./task-model";
import {
  assertSpikeSessionActive,
  eventPath,
  loadActiveSpikeSession,
  readJson,
  responsePath,
  SpikeRequest,
  SpikeResponse,
  SpikeSession,
  validateSpikeRequest,
  validateSpikeSession,
  waitForSessionMarker,
  writeSessionMarker,
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

  if (request.action === "migrate") {
    return { migration: await runMigrationContender(session, "raycast", "holder") };
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

  if (request.action === "task-model-schema") {
    const schema = requiredParameter(request, "schema");
    const databasePath = join(session.sessionDirectory, `task-model-raycast-${request.requestId}.sqlite`);
    return { validation: validateTaskModelSchema(databasePath, schema) };
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
          await writeSessionMarker(session, eventPath(session, request.requestId, "started"), {
            startedAt: new Date().toISOString(),
          });
          const release = await waitForSessionMarker(session, eventPath(session, request.requestId, "release"));
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
          await writeSessionMarker(session, eventPath(session, request.requestId, "started"), {
            startedAt: new Date().toISOString(),
            markerCount,
          });
          await waitForSessionMarker(session, eventPath(session, request.requestId, "release"));
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
    assertSpikeSessionActive(session);
    const names = (await readdir(requestsDirectory)).filter((name) => name.endsWith(".json")).sort();
    const name = names.find((candidate) => !processed.has(candidate));
    if (name) {
      const request = validateSpikeRequest(await readJson(join(requestsDirectory, name)), session);
      assertSpikeSessionActive(session);
      return request;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
}

export async function runRaycastSqliteSpike(descriptor?: SpikeSession): Promise<void> {
  const session = validateSpikeSession(descriptor ?? (await loadActiveSpikeSession()));
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
      assertSpikeSessionActive(session);
      const output = await handleRequest(session, request);
      assertSpikeSessionActive(session);
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
    assertSpikeSessionActive(session);
    processed.add(requestFileName);
    finished = request.action === "finish";
  }
}
