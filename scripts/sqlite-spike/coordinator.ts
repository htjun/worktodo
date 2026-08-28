import { spawn, ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { getRuntimeInfo } from "../../src/shared/runtime-info";
import {
  createVerifiedBackup,
  initializeSyntheticSchema,
  insertMarker,
  openSpikeDatabase,
  readSpikePragmas,
  SPIKE_BUSY_TIMEOUT_MS,
  SPIKE_JOURNAL_MODE,
  SPIKE_SYNCHRONOUS_LEVEL,
  sqliteErrorCode,
  verifySpikeDatabase,
} from "../../src/shared/sqlite-spike/database";
import { coordinateMigrationRace, validateMigrationContention } from "../../src/shared/sqlite-spike/migration";
import {
  clearActiveSpikeSession,
  createSpikeRequest,
  createSpikeSession,
  eventPath,
  readyPath,
  reportPath,
  requestPath,
  responsePath,
  sessionDescriptorPath,
  SpikeCheck,
  SpikeReport,
  SpikeRequest,
  SpikeResponse,
  SpikeSession,
  validateSpikeReport,
  validateSpikeResponse,
  waitForJson,
  waitForSessionMarker,
  writeSessionMarker,
  writeJsonAtomic,
} from "../../src/shared/sqlite-spike/protocol";

const RAYCAST_DEEP_LINK = "raycast://extensions/jsn/work-todo/sqlite-spike";
const WORKER_PATH = join(__dirname, "worker.js");

type WorkerHandle = {
  child: ChildProcess;
  result: Promise<Record<string, unknown>>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Expected ${label} to be an object`);
  }
  return value;
}

function requireNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number") {
    throw new Error(`Expected ${key} to be a number`);
  }
  return value;
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function launchRaycastCommand(): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("open", [RAYCAST_DEEP_LINK], { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`Could not open the Raycast diagnostic command (exit ${String(code)})`));
      }
    });
  });
}

function startWorker(arguments_: string[]): WorkerHandle {
  const child = spawn(process.execPath, [WORKER_PATH, ...arguments_], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));

  const result = new Promise<Record<string, unknown>>((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      const output = Buffer.concat(stdout).toString("utf8").trim();
      if (signal) {
        reject(new Error(`SQLite spike worker exited from ${signal}`));
        return;
      }
      if (!output) {
        reject(new Error(`SQLite spike worker produced no output (exit ${String(code)})`));
        return;
      }
      try {
        const parsed = requireRecord(JSON.parse(output) as unknown, "worker output");
        if (code !== 0) {
          reject(
            new Error(
              `SQLite spike worker failed: ${JSON.stringify(parsed)} ${Buffer.concat(stderr).toString("utf8")}`,
            ),
          );
          return;
        }
        resolvePromise(parsed);
      } catch (error) {
        reject(error);
      }
    });
  });

  return { child, result };
}

async function dispatchRaycast(
  session: SpikeSession,
  action: Parameters<typeof createSpikeRequest>[1],
  parameters: Record<string, string> = {},
): Promise<{ request: SpikeRequest; response: Promise<SpikeResponse> }> {
  const request = createSpikeRequest(session, action, parameters);
  await writeJsonAtomic(requestPath(session, request.requestId), request);
  const response = waitForJson(responsePath(session, request.requestId), 45_000).then((value) =>
    validateSpikeResponse(value, request),
  );
  return { request, response };
}

async function callRaycast(
  session: SpikeSession,
  action: Parameters<typeof createSpikeRequest>[1],
  parameters: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const dispatched = await dispatchRaycast(session, action, parameters);
  const response = await dispatched.response;
  if (response.status === "error") {
    throw new Error(`Raycast ${action} failed: ${response.error?.message ?? "unknown error"}`);
  }
  return requireRecord(response.output, `Raycast ${action} output`);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function runValidation(): Promise<SpikeReport> {
  const session = await createSpikeSession();
  const startedAt = new Date().toISOString();
  const checks: SpikeCheck[] = [];
  let raycastStarted = false;
  let raycastFinished = false;
  let nodeRuntime: Record<string, unknown> = {};
  let raycastRuntime: Record<string, unknown> = {};
  let failure: string | undefined;

  async function check(name: string, operation: () => Promise<Record<string, unknown>>): Promise<void> {
    const checkStartedAt = performance.now();
    try {
      const details = await operation();
      checks.push({ name, status: "pass", durationMs: performance.now() - checkStartedAt, details });
      console.log(`PASS ${name}`);
    } catch (error) {
      checks.push({
        name,
        status: "fail",
        durationMs: performance.now() - checkStartedAt,
        details: { error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }

  try {
    initializeSyntheticSchema(session.databasePath);
    console.log(`SQLite spike session: ${session.sessionId}`);
    console.log(`Detailed result: ${reportPath(session)}`);
    console.log("Opening Worktodo's SQLite Runtime Validation command in Raycast...");
    await launchRaycastCommand();
    const ready = requireRecord(await waitForJson(readyPath(session), 45_000), "Raycast readiness evidence");
    assertCondition(ready.sessionId === session.sessionId, "Raycast joined a different SQLite spike session");
    raycastStarted = true;

    await check("runtime and connection policy", async () => {
      const nodeDb = openSpikeDatabase(session.databasePath);
      try {
        nodeRuntime = { ...getRuntimeInfo(), pragmas: readSpikePragmas(nodeDb) };
      } finally {
        nodeDb.close();
      }
      raycastRuntime = await callRaycast(session, "runtime");

      const nodeVersions = requireRecord(nodeRuntime.runtime, "Node 24 runtime versions");
      const raycastVersions = requireRecord(raycastRuntime.runtime, "Raycast runtime versions");
      assertCondition(nodeVersions.node === "24.18.0", `Expected Node 24.18.0, observed ${String(nodeVersions.node)}`);
      assertCondition(
        nodeVersions.sqlite === "3.53.1",
        `Expected local SQLite 3.53.1, observed ${String(nodeVersions.sqlite)}`,
      );
      assertCondition(
        raycastVersions.node === "22.22.2",
        `Expected Raycast Node 22.22.2, observed ${String(raycastVersions.node)}`,
      );
      assertCondition(
        raycastVersions.sqlite === "3.51.2",
        `Expected Raycast SQLite 3.51.2, observed ${String(raycastVersions.sqlite)}`,
      );

      for (const [runtimeName, runtime] of [
        ["Node 24", nodeRuntime],
        ["Raycast", raycastRuntime],
      ] as const) {
        const pragmas = requireRecord(runtime.pragmas, `${runtimeName} pragmas`);
        assertCondition(pragmas.journalMode === SPIKE_JOURNAL_MODE, `${runtimeName} did not use rollback journal`);
        assertCondition(pragmas.synchronous === SPIKE_SYNCHRONOUS_LEVEL, `${runtimeName} did not use synchronous FULL`);
        assertCondition(pragmas.foreignKeys === 1, `${runtimeName} did not enable foreign keys`);
        assertCondition(
          pragmas.busyTimeout === SPIKE_BUSY_TIMEOUT_MS,
          `${runtimeName} did not use a 2-second busy timeout`,
        );
      }
      return { node24: nodeRuntime, raycast: raycastRuntime };
    });

    await check("reader sees only committed data", async () => {
      const label = "node-uncommitted-reader-probe";
      const db = openSpikeDatabase(session.databasePath);
      db.exec("BEGIN IMMEDIATE");
      try {
        insertMarker(db, "node24", label);
        const output = await callRaycast(session, "read-marker", { label });
        assertCondition(output.count === 0, "Raycast observed Node 24's uncommitted row");
        return output;
      } finally {
        if (db.isTransaction) {
          db.exec("ROLLBACK");
        }
        db.close();
      }
    });

    await check("Raycast waits for a short Node 24 write", async () => {
      const db = openSpikeDatabase(session.databasePath);
      db.exec("BEGIN IMMEDIATE");
      insertMarker(db, "node24", "node-short-holder");
      const release = setTimeout(() => db.exec("COMMIT"), 350);
      try {
        const output = await callRaycast(session, "write-marker", { label: "raycast-after-node-short" });
        const elapsedMs = requireNumber(output, "elapsedMs");
        assertCondition(output.outcome === "committed", "Raycast did not commit after the Node 24 lock was released");
        assertCondition(
          elapsedMs >= 200 && elapsedMs < SPIKE_BUSY_TIMEOUT_MS,
          "Raycast wait was outside the expected window",
        );
        return output;
      } finally {
        clearTimeout(release);
        if (db.isTransaction) {
          db.exec("ROLLBACK");
        }
        db.close();
      }
    });

    await check("Raycast times out on a long Node 24 write", async () => {
      const db = openSpikeDatabase(session.databasePath);
      db.exec("BEGIN IMMEDIATE");
      insertMarker(db, "node24", "node-long-holder");
      try {
        const output = await callRaycast(session, "write-marker", { label: "raycast-node-timeout" });
        const elapsedMs = requireNumber(output, "elapsedMs");
        assertCondition(
          output.outcome === "error" && output.code === "SQLITE_BUSY",
          "Raycast did not report SQLITE_BUSY",
        );
        assertCondition(elapsedMs >= 1_800 && elapsedMs < 3_500, "Raycast busy timeout was outside tolerance");
        return output;
      } finally {
        db.exec("ROLLBACK");
        db.close();
      }
    });

    await check("Node 24 waits for a short Raycast write", async () => {
      const dispatched = await dispatchRaycast(session, "hold-write", { label: "raycast-short-holder" });
      await waitForSessionMarker(session, eventPath(session, dispatched.request.requestId, "started"));
      const reader = openSpikeDatabase(session.databasePath);
      let uncommittedCount;
      try {
        uncommittedCount = Number(
          reader.prepare("SELECT COUNT(*) AS count FROM spike_marker WHERE label = ?").get("raycast-short-holder")
            ?.count,
        );
        assertCondition(uncommittedCount === 0, "Node 24 observed Raycast's uncommitted row");
      } finally {
        reader.close();
      }
      const worker = startWorker(["write-marker", session.databasePath, "node-after-raycast-short"]);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 350));
      await writeSessionMarker(session, eventPath(session, dispatched.request.requestId, "release"), { commit: true });
      const [workerOutput, response] = await Promise.all([worker.result, dispatched.response]);
      assertCondition(response.status === "ok", "Raycast short lock holder failed");
      const elapsedMs = requireNumber(workerOutput, "elapsedMs");
      assertCondition(
        workerOutput.outcome === "committed",
        "Node 24 did not commit after the Raycast lock was released",
      );
      assertCondition(
        elapsedMs >= 200 && elapsedMs < SPIKE_BUSY_TIMEOUT_MS,
        "Node 24 wait was outside the expected window",
      );
      return { uncommittedCount, worker: workerOutput, raycast: response.output ?? {} };
    });

    await check("Node 24 times out on a long Raycast write", async () => {
      const dispatched = await dispatchRaycast(session, "hold-write", { label: "raycast-long-holder" });
      await waitForSessionMarker(session, eventPath(session, dispatched.request.requestId, "started"));
      const worker = startWorker(["write-marker", session.databasePath, "node-raycast-timeout"]);
      const workerOutput = await worker.result;
      await writeSessionMarker(session, eventPath(session, dispatched.request.requestId, "release"), { commit: false });
      const response = await dispatched.response;
      assertCondition(response.status === "ok", "Raycast long lock holder failed");
      const elapsedMs = requireNumber(workerOutput, "elapsedMs");
      assertCondition(
        workerOutput.outcome === "error" && workerOutput.code === "SQLITE_BUSY",
        "Node 24 did not report SQLITE_BUSY",
      );
      assertCondition(elapsedMs >= 1_800 && elapsedMs < 3_500, "Node 24 busy timeout was outside tolerance");
      return { worker: workerOutput, raycast: response.output ?? {} };
    });

    await check("migration lock applies the migration exactly once", async () => {
      const dispatched = await dispatchRaycast(session, "migrate");
      const worker = startWorker([
        "migrate",
        session.databasePath,
        "node24-worker",
        sessionDescriptorPath(session),
        "waiter",
      ]);
      const synchronization = await coordinateMigrationRace(session);
      const [workerOutput, response] = await Promise.all([worker.result, dispatched.response]);
      assertCondition(response.status === "ok", "Raycast migration failed");
      const nodeMigration = requireRecord(workerOutput.migration, "Node 24 migration result");
      const raycastMigration = requireRecord(
        requireRecord(response.output, "Raycast migration output").migration,
        "Raycast migration result",
      );
      validateMigrationContention(raycastMigration, nodeMigration, synchronization.released);
      return { node24: nodeMigration, raycast: raycastMigration, synchronization };
    });

    await check("foreign keys are enforced in both runtimes", async () => {
      const db = openSpikeDatabase(session.databasePath);
      let nodeCode: string | null = null;
      try {
        db.prepare("INSERT INTO spike_child(id, parent_id) VALUES (?, ?)").run(10_002, 99_999);
      } catch (error) {
        nodeCode = sqliteErrorCode(error);
      } finally {
        db.close();
      }
      const raycast = await callRaycast(session, "foreign-key");
      assertCondition(nodeCode === "SQLITE_CONSTRAINT_FOREIGNKEY", "Node 24 did not reject the foreign-key violation");
      assertCondition(
        raycast.rejected === true && raycast.code === "SQLITE_CONSTRAINT_FOREIGNKEY",
        "Raycast did not reject the foreign-key violation",
      );
      return { node24: { rejected: true, code: nodeCode }, raycast };
    });

    await check("Raycast rolls back an interrupted operation", async () => {
      const output = await callRaycast(session, "rollback-exception", { label: "raycast-exception-rollback" });
      assertCondition(
        output.caught === true && output.count === 0 && output.inTransaction === false,
        "Raycast rollback did not restore a clean transaction state",
      );
      return output;
    });

    await check("SQLite recovers after a killed Node 24 writer", async () => {
      const label = "node-killed-transaction";
      const startedPath = join(session.sessionDirectory, "events", "crash-worker.started.json");
      const worker = startWorker(["crash-hold", session.databasePath, label, startedPath]);
      worker.result.catch(() => undefined);
      const started = requireRecord(await waitForJson(startedPath), "crash writer evidence");
      assertCondition(started.journalHeader === "d9d505f920a163d7", "Crash probe did not flush a recoverable journal");
      worker.child.kill("SIGKILL");
      await new Promise<void>((resolvePromise) => worker.child.once("exit", () => resolvePromise()));

      const db = openSpikeDatabase(session.databasePath);
      try {
        const count = Number(
          db.prepare("SELECT COUNT(*) AS count FROM spike_marker WHERE label = ?").get(label)?.count ?? 0,
        );
        const verification = verifySpikeDatabase(db);
        assertCondition(count === 0, "Killed writer's uncommitted row survived recovery");
        assertCondition(
          verification.integrity === "ok" && verification.foreignKeyViolations === 0,
          "Database failed recovery checks",
        );
        assertCondition(
          !(await fileExists(`${session.databasePath}-journal`)),
          "Recovery did not remove the hot journal",
        );
        return { count, verification, journalHeaderBeforeKill: started.journalHeader };
      } finally {
        db.close();
      }
    });

    await check("online backup remains valid with an active Raycast reader", async () => {
      const backupPath = join(session.sessionDirectory, "verified-backup.sqlite");
      const dispatched = await dispatchRaycast(session, "hold-read");
      await waitForSessionMarker(session, eventPath(session, dispatched.request.requestId, "started"));
      const nodeVerification = await createVerifiedBackup(session.databasePath, backupPath);
      await writeSessionMarker(session, eventPath(session, dispatched.request.requestId, "release"), { release: true });
      const holdResponse = await dispatched.response;
      assertCondition(holdResponse.status === "ok", "Raycast reader failed during backup");
      const raycastVerification = await callRaycast(session, "verify-backup", { backupPath });
      const verification = requireRecord(raycastVerification.verification, "Raycast backup verification");
      assertCondition(
        verification.integrity === "ok" && verification.foreignKeyViolations === 0,
        "Raycast rejected the verified backup",
      );
      return { node24: nodeVerification, raycast: raycastVerification };
    });

    await check("final integrity and rollback-journal cleanup", async () => {
      const nodeDb = openSpikeDatabase(session.databasePath);
      let nodeVerification;
      try {
        nodeVerification = verifySpikeDatabase(nodeDb);
      } finally {
        nodeDb.close();
      }
      const raycast = await callRaycast(session, "verify");
      assertCondition(
        nodeVerification.integrity === "ok" && nodeVerification.foreignKeyViolations === 0,
        "Node 24 final integrity check failed",
      );
      const raycastVerification = requireRecord(raycast.verification, "Raycast final verification");
      assertCondition(
        raycastVerification.integrity === "ok" && raycastVerification.foreignKeyViolations === 0,
        "Raycast final integrity check failed",
      );

      const sidecars = ["-wal", "-shm", "-journal"];
      const existingSidecars = [];
      for (const suffix of sidecars) {
        if (await fileExists(`${session.databasePath}${suffix}`)) {
          existingSidecars.push(suffix);
        }
      }
      assertCondition(
        existingSidecars.length === 0,
        `Unexpected SQLite sidecars remain: ${existingSidecars.join(", ")}`,
      );
      return { node24: nodeVerification, raycast, existingSidecars };
    });
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  } finally {
    if (raycastStarted && !raycastFinished) {
      try {
        await callRaycast(session, "finish");
        raycastFinished = true;
      } catch (error) {
        failure ??= `Could not stop the Raycast peer: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  }

  const report: SpikeReport = {
    protocolVersion: session.protocolVersion,
    sessionId: session.sessionId,
    status: failure ? "fail" : "pass",
    startedAt,
    finishedAt: new Date().toISOString(),
    runtimes: { node24: nodeRuntime, raycast: raycastRuntime },
    checks,
    ...(failure ? { failure } : {}),
  };
  validateSpikeReport(report);
  await writeJsonAtomic(reportPath(session), report);
  await clearActiveSpikeSession(session);
  return report;
}

runValidation()
  .then((report) => {
    console.log(`SQLite cross-runtime validation: ${report.status.toUpperCase()}`);
    console.log(
      `Passed checks: ${report.checks.filter((check) => check.status === "pass").length}/${report.checks.length}`,
    );
    if (report.failure) {
      throw new Error(report.failure);
    }
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
