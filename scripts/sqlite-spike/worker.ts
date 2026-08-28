import {
  openSpikeDatabase,
  applySyntheticMigration,
  insertMarker,
  sqliteErrorCode,
  withImmediateTransaction,
} from "../../src/shared/sqlite-spike/database";
import { waitForJson, writeJsonAtomic } from "../../src/shared/sqlite-spike/protocol";

type WorkerOutput = Record<string, unknown>;

function requiredArgument(index: number, label: string): string {
  const value = process.argv[index];
  if (!value) {
    throw new Error(`Missing worker argument: ${label}`);
  }
  return value;
}

function writeOutput(output: WorkerOutput): void {
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

async function run(): Promise<void> {
  const action = requiredArgument(2, "action");
  const databasePath = requiredArgument(3, "database path");

  if (action === "write-marker") {
    const label = requiredArgument(4, "marker label");
    const startedAt = performance.now();
    const db = openSpikeDatabase(databasePath);
    try {
      withImmediateTransaction(db, () => insertMarker(db, "node24-worker", label));
      writeOutput({ outcome: "committed", elapsedMs: performance.now() - startedAt, label });
    } catch (error) {
      writeOutput({
        outcome: "error",
        elapsedMs: performance.now() - startedAt,
        label,
        code: sqliteErrorCode(error),
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      db.close();
    }
    return;
  }

  if (action === "migrate") {
    const actor = requiredArgument(4, "actor");
    const gate = requiredArgument(5, "gate path");
    await waitForJson(gate);
    const db = openSpikeDatabase(databasePath);
    try {
      writeOutput({ migration: applySyntheticMigration(db, actor) });
    } finally {
      db.close();
    }
    return;
  }

  if (action === "crash-hold") {
    const label = requiredArgument(4, "marker label");
    const startedPath = requiredArgument(5, "started event path");
    const db = openSpikeDatabase(databasePath);
    db.exec("BEGIN IMMEDIATE");
    db.prepare("INSERT INTO spike_marker(actor, label, payload) VALUES (?, ?, zeroblob(1048576))").run(
      "node24-crash-worker",
      label,
    );
    await writeJsonAtomic(startedPath, { pid: process.pid, startedAt: new Date().toISOString() });
    const keepAlive = setInterval(() => undefined, 1_000);
    await new Promise<void>(() => undefined);
    clearInterval(keepAlive);
    return;
  }

  throw new Error(`Unknown SQLite spike worker action: ${action}`);
}

run().catch((error: unknown) => {
  writeOutput({
    outcome: "fatal",
    code: sqliteErrorCode(error),
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
