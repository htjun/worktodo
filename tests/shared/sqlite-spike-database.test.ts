import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
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
import {
  coordinateMigrationRace,
  migrationMarkerPath,
  validateMigrationContention,
} from "../../src/shared/sqlite-spike/migration";
import {
  createSpikeSession,
  sessionDescriptorPath,
  waitForJson,
  writeSessionMarker,
} from "../../src/shared/sqlite-spike/protocol";

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
    const child = spawn(process.execPath, [workerPath, ...arguments_], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5_000,
    });
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
    const session = await createSpikeSession(Date.now(), false);
    temporaryDirectories.push(session.sessionDirectory);
    const { databasePath } = session;
    initializeSyntheticSchema(databasePath);
    const resultsPromise = Promise.all([
      runWorker(["migrate", databasePath, "worker-a", sessionDescriptorPath(session), "holder"]),
      runWorker(["migrate", databasePath, "worker-b", sessionDescriptorPath(session), "waiter"]),
    ]);
    const synchronization = await coordinateMigrationRace(session);
    const results = await resultsPromise;
    const migrations = results.map((result) => result.migration as Record<string, unknown>);
    expect(() => validateMigrationContention(migrations[0], migrations[1], synchronization.released)).not.toThrow();
    expect(migrations[1]).toMatchObject({
      applied: false,
      versionAfterLock: 1,
      userVersion: 1,
      migrationAuditCount: 1,
    });
    expect(Number(migrations[1].lockWaitMs)).toBeGreaterThanOrEqual(200);
    expect(() =>
      validateMigrationContention(migrations[0], { ...migrations[1], lockWaitMs: 0 }, synchronization.released),
    ).toThrow("overlapping");

    const db = openSpikeDatabase(databasePath);
    try {
      expect(await applySyntheticMigration(db, "third")).toMatchObject({ applied: false, userVersion: 1 });
      expect(verifySpikeDatabase(db)).toMatchObject({ migrationAuditCount: 1, userVersion: 1 });
    } finally {
      db.close();
    }
  });

  it("does not start the migration without both readiness acknowledgements", async () => {
    const session = await createSpikeSession(Date.now(), false);
    temporaryDirectories.push(session.sessionDirectory);
    await writeSessionMarker(session, migrationMarkerPath(session, "holder", "ready"));
    await expect(coordinateMigrationRace(session, 75)).rejects.toThrow("Timed out");
    await expect(readFile(migrationMarkerPath(session, "holder", "start"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("recovers a flushed journal after killing an uncommitted writer", async () => {
    const { databasePath, directory } = await makeDatabase();
    const startedPath = join(directory, "crash-started.json");
    const child = spawn(process.execPath, [workerPath, "crash-hold", databasePath, "crash-probe", startedPath], {
      stdio: "ignore",
      timeout: 5_000,
    });
    const closed = once(child, "close");
    try {
      const started = await waitForJson(startedPath, 2_000);
      expect(started).toMatchObject({ journalHeader: "d9d505f920a163d7" });
      child.kill("SIGKILL");
      await closed;
      const db = openSpikeDatabase(databasePath);
      try {
        expect(verifySpikeDatabase(db)).toMatchObject({ integrity: "ok", foreignKeyViolations: 0, markerCount: 0 });
      } finally {
        db.close();
      }
      await expect(readFile(`${databasePath}-journal`)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      child.kill("SIGKILL");
      await closed;
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

  it("publishes exactly one concurrent backup without replacing the winner", async () => {
    const first = await makeDatabase();
    const second = await makeDatabase();
    for (const [index, source] of [first, second].entries()) {
      const db = openSpikeDatabase(source.databasePath);
      try {
        withImmediateTransaction(db, () => insertMarker(db, "test", `source-${index}`));
      } finally {
        db.close();
      }
    }
    const destination = join(first.directory, "backup.sqlite");
    const results = await Promise.allSettled([
      createVerifiedBackup(first.databasePath, destination),
      createVerifiedBackup(second.databasePath, destination),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((result) => result.status === "rejected");
    expect(loser?.reason).toMatchObject({
      message: expect.stringContaining("Refusing to replace"),
      cause: { code: "EEXIST" },
    });
    const winner = results.findIndex((result) => result.status === "fulfilled");
    const db = openSpikeDatabase(destination, { readOnly: true });
    try {
      expect(verifySpikeDatabase(db)).toMatchObject({ integrity: "ok", foreignKeyViolations: 0, markerCount: 1 });
      expect(db.prepare("SELECT label FROM spike_marker").get()?.label).toBe(`source-${winner}`);
    } finally {
      db.close();
    }
    expect((await readdir(first.directory)).filter((name) => name.endsWith(".partial"))).toEqual([]);
  });

  it("removes a failed backup candidate without publishing it", async () => {
    const { databasePath, directory } = await makeDatabase();
    const db = openSpikeDatabase(databasePath);
    try {
      db.exec("PRAGMA foreign_keys = OFF; INSERT INTO spike_child(id, parent_id) VALUES (1, 999)");
    } finally {
      db.close();
    }
    const destination = join(directory, "backup.sqlite");
    await expect(createVerifiedBackup(databasePath, destination)).rejects.toThrow("Backup verification failed");
    await expect(readFile(destination)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readdir(directory)).filter((name) => name.endsWith(".partial"))).toEqual([]);
  });
});
