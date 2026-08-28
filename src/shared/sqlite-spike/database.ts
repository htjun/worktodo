import { access, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { backup, DatabaseSync } from "node:sqlite";

export const SPIKE_BUSY_TIMEOUT_MS = 2_000;
export const SPIKE_JOURNAL_MODE = "delete";
export const SPIKE_SYNCHRONOUS_LEVEL = 2;

export type SpikePragmas = {
  journalMode: string;
  synchronous: number;
  foreignKeys: number;
  busyTimeout: number;
};

export type SpikeVerification = {
  integrity: string;
  foreignKeyViolations: number;
  markerCount: number;
  migrationAuditCount: number;
  userVersion: number;
};

export type SpikeMigrationResult = {
  actor: string;
  applied: boolean;
  elapsedMs: number;
  userVersion: number;
};

type OpenSpikeDatabaseOptions = {
  readOnly?: boolean;
};

function pragmaScalar(db: DatabaseSync, sql: string): string | number {
  const row = db.prepare(sql).get();
  const value = row ? Object.values(row)[0] : undefined;

  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`Expected a scalar value from ${sql}`);
  }

  return value;
}

export function openSpikeDatabase(path: string, options: OpenSpikeDatabaseOptions = {}): DatabaseSync {
  const db = new DatabaseSync(path, {
    allowExtension: false,
    enableDoubleQuotedStringLiterals: false,
    enableForeignKeyConstraints: true,
    readOnly: options.readOnly ?? false,
    timeout: SPIKE_BUSY_TIMEOUT_MS,
  });

  try {
    db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = ${SPIKE_BUSY_TIMEOUT_MS};
    `);

    if (!options.readOnly) {
      db.exec("PRAGMA synchronous = FULL;");
    }

    const journalMode = String(pragmaScalar(db, "PRAGMA journal_mode")).toLowerCase();
    if (journalMode !== SPIKE_JOURNAL_MODE) {
      throw new Error(`Unexpected SQLite journal mode: ${journalMode}`);
    }

    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function initializeSyntheticSchema(path: string): void {
  const db = new DatabaseSync(path, {
    allowExtension: false,
    enableDoubleQuotedStringLiterals: false,
    enableForeignKeyConstraints: true,
    timeout: SPIKE_BUSY_TIMEOUT_MS,
  });

  try {
    const journalMode = String(pragmaScalar(db, "PRAGMA journal_mode = DELETE")).toLowerCase();
    if (journalMode !== SPIKE_JOURNAL_MODE) {
      throw new Error(`Could not establish rollback-journal mode: ${journalMode}`);
    }

    db.exec(`
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = ${SPIKE_BUSY_TIMEOUT_MS};

      CREATE TABLE IF NOT EXISTS spike_parent (
        id INTEGER PRIMARY KEY
      ) STRICT;

      CREATE TABLE IF NOT EXISTS spike_child (
        id INTEGER PRIMARY KEY,
        parent_id INTEGER NOT NULL REFERENCES spike_parent(id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS spike_marker (
        id INTEGER PRIMARY KEY,
        actor TEXT NOT NULL,
        label TEXT NOT NULL UNIQUE,
        payload BLOB
      ) STRICT;

      CREATE TABLE IF NOT EXISTS spike_migration_audit (
        target_version INTEGER PRIMARY KEY,
        actor TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;

      INSERT OR IGNORE INTO spike_parent(id) VALUES (1);
    `);
  } finally {
    db.close();
  }
}

export function readSpikePragmas(db: DatabaseSync): SpikePragmas {
  return {
    journalMode: String(pragmaScalar(db, "PRAGMA journal_mode")).toLowerCase(),
    synchronous: Number(pragmaScalar(db, "PRAGMA synchronous")),
    foreignKeys: Number(pragmaScalar(db, "PRAGMA foreign_keys")),
    busyTimeout: Number(pragmaScalar(db, "PRAGMA busy_timeout")),
  };
}

export function withImmediateTransaction<T>(db: DatabaseSync, operation: () => T): T {
  db.exec("BEGIN IMMEDIATE");

  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    if (db.isTransaction) {
      db.exec("ROLLBACK");
    }
    throw error;
  }
}

export function insertMarker(db: DatabaseSync, actor: string, label: string): void {
  db.prepare("INSERT INTO spike_marker(actor, label) VALUES (?, ?)").run(actor, label);
}

export function countMarker(db: DatabaseSync, label: string): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM spike_marker WHERE label = ?").get(label);
  return Number(row?.count ?? 0);
}

export function applySyntheticMigration(db: DatabaseSync, actor: string): SpikeMigrationResult {
  const startedAt = performance.now();
  let applied = false;

  withImmediateTransaction(db, () => {
    const currentVersion = Number(pragmaScalar(db, "PRAGMA user_version"));
    if (currentVersion >= 1) {
      return;
    }

    db.exec(`
      CREATE TABLE spike_migrated_probe (
        id INTEGER PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
    `);
    db.prepare("INSERT INTO spike_migration_audit(target_version, actor, applied_at) VALUES (1, ?, ?)").run(
      actor,
      new Date().toISOString(),
    );
    db.exec("PRAGMA user_version = 1");
    applied = true;
  });

  return {
    actor,
    applied,
    elapsedMs: performance.now() - startedAt,
    userVersion: Number(pragmaScalar(db, "PRAGMA user_version")),
  };
}

export function verifySpikeDatabase(db: DatabaseSync): SpikeVerification {
  const integrity = String(pragmaScalar(db, "PRAGMA integrity_check"));
  const foreignKeyViolations = db.prepare("PRAGMA foreign_key_check").all().length;
  const markerCount = Number(db.prepare("SELECT COUNT(*) AS count FROM spike_marker").get()?.count ?? 0);
  const migrationAuditCount = Number(
    db.prepare("SELECT COUNT(*) AS count FROM spike_migration_audit").get()?.count ?? 0,
  );

  return {
    integrity,
    foreignKeyViolations,
    markerCount,
    migrationAuditCount,
    userVersion: Number(pragmaScalar(db, "PRAGMA user_version")),
  };
}

export function sqliteErrorCode(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "errcode" in error && typeof error.errcode === "number") {
    if (error.errcode === 787) {
      return "SQLITE_CONSTRAINT_FOREIGNKEY";
    }
    if ((error.errcode & 0xff) === 5) {
      return "SQLITE_BUSY";
    }
  }
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return null;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function createVerifiedBackup(sourcePath: string, destinationPath: string): Promise<SpikeVerification> {
  if (await pathExists(destinationPath)) {
    throw new Error(`Refusing to replace an existing verified backup: ${destinationPath}`);
  }

  const partialPath = `${destinationPath}.${randomUUID()}.partial`;
  const source = openSpikeDatabase(sourcePath);

  try {
    await backup(source, partialPath, { rate: 1 });
  } finally {
    source.close();
  }

  try {
    const candidate = openSpikeDatabase(partialPath, { readOnly: true });
    let verification: SpikeVerification;
    try {
      verification = verifySpikeDatabase(candidate);
    } finally {
      candidate.close();
    }

    if (verification.integrity !== "ok" || verification.foreignKeyViolations !== 0) {
      throw new Error(`Backup verification failed: ${JSON.stringify(verification)}`);
    }

    await rename(partialPath, destinationPath);
    return verification;
  } catch (error) {
    await rm(partialPath, { force: true });
    throw error;
  }
}
