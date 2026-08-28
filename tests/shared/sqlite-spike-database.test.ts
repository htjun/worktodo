import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applySyntheticMigration,
  createVerifiedBackup,
  initializeSyntheticSchema,
  insertMarker,
  openSpikeDatabase,
  readSpikePragmas,
  SPIKE_BUSY_TIMEOUT_MS,
  verifySpikeDatabase,
  withImmediateTransaction,
} from "../../src/shared/sqlite-spike/database";
import { writeJsonAtomic } from "../../src/shared/sqlite-spike/protocol";

const temporaryDirectories: string[] = [];
const workerPath = join(process.cwd(), "dist", "scripts", "sqlite-spike", "worker.js");

async function makeDatabase(): Promise<{ databasePath: string; directory: string }> {
  const directory = await mkdtemp(join(tmpdir(), "worktodo-sqlite-test-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "test.sqlite");
  initializeSyntheticSchema(databasePath);
  return { databasePath, directory };
}

function runWorker(arguments_: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [workerPath, ...arguments_], { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("exit", (code) => {
      const output = Buffer.concat(stdout).toString("utf8").trim();
      if (code !== 0) {
        reject(new Error(`Worker failed: ${output} ${Buffer.concat(stderr).toString("utf8")}`));
        return;
      }
      try {
        resolvePromise(JSON.parse(output) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
  });
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("SQLite spike database policy", () => {
  it("opens with the required rollback-journal connection policy", async () => {
    const { databasePath } = await makeDatabase();
    const db = openSpikeDatabase(databasePath);
    try {
      expect(readSpikePragmas(db)).toEqual({
        journalMode: "delete",
        synchronous: 2,
        foreignKeys: 1,
        busyTimeout: SPIKE_BUSY_TIMEOUT_MS,
      });
      expect(() => db.prepare('SELECT "double-quoted literal"').get()).toThrow();
      expect(() => db.loadExtension("unreviewed-extension")).toThrow();
    } finally {
      db.close();
    }
  });

  it("rolls back the complete immediate transaction after an exception", async () => {
    const { databasePath } = await makeDatabase();
    const db = openSpikeDatabase(databasePath);
    try {
      expect(() =>
        withImmediateTransaction(db, () => {
          insertMarker(db, "test", "rolled-back");
          throw new Error("stop");
        }),
      ).toThrow("stop");
      expect(db.isTransaction).toBe(false);
      expect(db.prepare("SELECT COUNT(*) AS count FROM spike_marker").get()?.count).toBe(0);
    } finally {
      db.close();
    }
  });

  it("serializes a migration and applies it exactly once across processes", async () => {
    const { databasePath, directory } = await makeDatabase();
    const gate = join(directory, "migration-gate.json");
    const first = runWorker(["migrate", databasePath, "worker-a", gate]);
    const second = runWorker(["migrate", databasePath, "worker-b", gate]);
    await writeJsonAtomic(gate, { open: true });

    const results = await Promise.all([first, second]);
    const migrations = results.map((result) => result.migration as Record<string, unknown>);
    expect(migrations.filter((migration) => migration.applied === true)).toHaveLength(1);
    expect(migrations.every((migration) => migration.userVersion === 1)).toBe(true);

    const db = openSpikeDatabase(databasePath);
    try {
      expect(applySyntheticMigration(db, "third")).toMatchObject({ applied: false, userVersion: 1 });
      expect(verifySpikeDatabase(db)).toMatchObject({ migrationAuditCount: 1, userVersion: 1 });
    } finally {
      db.close();
    }
  });

  it("verifies a new backup and refuses to replace it", async () => {
    const { databasePath, directory } = await makeDatabase();
    const db = openSpikeDatabase(databasePath);
    try {
      withImmediateTransaction(db, () => insertMarker(db, "test", "backed-up"));
    } finally {
      db.close();
    }

    const backupPath = join(directory, "backup.sqlite");
    await expect(createVerifiedBackup(databasePath, backupPath)).resolves.toMatchObject({
      integrity: "ok",
      foreignKeyViolations: 0,
      markerCount: 1,
    });
    const original = await readFile(backupPath);
    await expect(createVerifiedBackup(databasePath, backupPath)).rejects.toThrow("Refusing to replace");
    expect(await readFile(backupPath)).toEqual(original);
  });
});
