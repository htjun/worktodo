import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openWorktodoDatabase } from "../../src/shared/storage/database";
import { applyMigrations, PRODUCTION_SCHEMA_SQL, UnsupportedSchemaVersionError } from "../../src/shared/storage/schema";
import { extractTaskModelSchema } from "../helpers/extract-task-model-schema";

const executeFile = promisify(execFile);
const temporaryDirectories: string[] = [];

async function temporaryDatabasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "worktodo-production-schema-test-"));
  temporaryDirectories.push(directory);
  return join(directory, "worktodo.sqlite");
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("production schema", () => {
  it("matches the approved marked schema exactly", async () => {
    const markdown = await readFile(join(process.cwd(), "docs", "research", "task-model.md"), "utf8");
    expect(PRODUCTION_SCHEMA_SQL).toBe(extractTaskModelSchema(markdown));
  });

  it("migrates a fresh database exactly once with the approved tables and indexes", async () => {
    const databasePath = await temporaryDatabasePath();
    const db = openWorktodoDatabase(databasePath);
    try {
      expect(applyMigrations(db)).toEqual({ applied: true, previousVersion: 0, currentVersion: 1 });
      expect(applyMigrations(db)).toEqual({ applied: false, previousVersion: 1, currentVersion: 1 });
      expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(1);
      expect(
        db
          .prepare("PRAGMA table_list")
          .all()
          .filter((row) => ["projects", "sections", "tasks"].includes(String(row.name)))
          .map((row) => [row.name, row.strict]),
      ).toEqual([
        ["tasks", 1],
        ["sections", 1],
        ["projects", 1],
      ]);
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_schema WHERE type = 'index' AND name NOT LIKE 'sqlite_autoindex_%' ORDER BY name",
          )
          .all()
          .map((row) => row.name),
      ).toEqual([
        "projects_order_idx",
        "sections_project_order_idx",
        "tasks_all_day_today_idx",
        "tasks_completed_idx",
        "tasks_inbox_order_idx",
        "tasks_project_fk_idx",
        "tasks_section_project_fk_idx",
        "tasks_timed_today_idx",
        "tasks_trashed_idx",
      ]);
      expect(db.prepare("PRAGMA integrity_check").get()?.integrity_check).toBe("ok");
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("rolls back every schema change when migration fails", async () => {
    const databasePath = await temporaryDatabasePath();
    const db = openWorktodoDatabase(databasePath);
    try {
      expect(() =>
        applyMigrations(db, {
          beforeVersionSet: () => {
            throw new Error("injected migration failure");
          },
        }),
      ).toThrow("injected migration failure");
      expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(0);
      expect(
        db
          .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN ('projects', 'sections', 'tasks')")
          .all(),
      ).toEqual([]);
      expect(applyMigrations(db)).toMatchObject({ applied: true, currentVersion: 1 });
    } finally {
      db.close();
    }
  });

  it("rejects a future schema version without changing it", async () => {
    const databasePath = await temporaryDatabasePath();
    const db = openWorktodoDatabase(databasePath);
    try {
      db.exec("PRAGMA user_version = 2");
      expect(() => applyMigrations(db)).toThrow(UnsupportedSchemaVersionError);
      expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(2);
      expect(db.isTransaction).toBe(false);
    } finally {
      db.close();
    }
  });

  it("serializes concurrent starters without duplicating the migration", async () => {
    const databasePath = await temporaryDatabasePath();
    const databaseModule = join(process.cwd(), "dist", "src", "shared", "storage", "database.js");
    const schemaModule = join(process.cwd(), "dist", "src", "shared", "storage", "schema.js");
    const script = `
      const { openWorktodoDatabase } = require(${JSON.stringify(databaseModule)});
      const { applyMigrations } = require(${JSON.stringify(schemaModule)});
      const db = openWorktodoDatabase(process.argv[1]);
      try { process.stdout.write(JSON.stringify(applyMigrations(db))); } finally { db.close(); }
    `;

    const results = await Promise.all([
      executeFile(process.execPath, ["-e", script, databasePath]),
      executeFile(process.execPath, ["-e", script, databasePath]),
    ]);
    const migrations = results.map(({ stdout }) => JSON.parse(stdout) as { applied: boolean; currentVersion: number });
    expect(migrations.filter((result) => result.applied)).toHaveLength(1);
    expect(migrations.every((result) => result.currentVersion === 1)).toBe(true);

    const db = openWorktodoDatabase(databasePath);
    try {
      expect(applyMigrations(db)).toEqual({ applied: false, previousVersion: 1, currentVersion: 1 });
      expect(
        db.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' AND name = 'tasks'").get()?.count,
      ).toBe(1);
    } finally {
      db.close();
    }
  });
});
