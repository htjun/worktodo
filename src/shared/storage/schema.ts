import type { DatabaseSync } from "node:sqlite";

export const WORKTODO_SCHEMA_VERSION = 1;

export const PRODUCTION_SCHEMA_SQL = `BEGIN IMMEDIATE;

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  position INTEGER NOT NULL CHECK (position >= 0),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= created_at_ms)
) STRICT;

CREATE TABLE sections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  position INTEGER NOT NULL CHECK (position >= 0),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= created_at_ms),
  FOREIGN KEY (project_id) REFERENCES projects (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  UNIQUE (id, project_id)
) STRICT;

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  notes TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'none'
    CHECK (priority IN ('none', 'low', 'medium', 'high')),
  position INTEGER NOT NULL CHECK (position >= 0),
  project_id TEXT,
  section_id TEXT,
  due_kind TEXT NOT NULL DEFAULT 'none'
    CHECK (due_kind IN ('none', 'all_day', 'timed')),
  due_date TEXT,
  due_at_ms INTEGER,
  due_timezone TEXT,
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= created_at_ms),
  completed_at_ms INTEGER CHECK (
    completed_at_ms IS NULL OR
    (completed_at_ms >= created_at_ms AND completed_at_ms <= updated_at_ms)
  ),
  trashed_at_ms INTEGER CHECK (
    trashed_at_ms IS NULL OR
    (trashed_at_ms >= created_at_ms AND trashed_at_ms <= updated_at_ms)
  ),
  CHECK (section_id IS NULL OR project_id IS NOT NULL),
  CHECK (
    (due_kind = 'none' AND due_date IS NULL AND due_at_ms IS NULL AND due_timezone IS NULL) OR
    (
      due_kind = 'all_day' AND
      due_date IS NOT NULL AND
      due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND
      length(due_date) = 10 AND
      due_at_ms IS NULL AND
      due_timezone IS NULL
    ) OR
    (
      due_kind = 'timed' AND
      due_date IS NULL AND
      due_at_ms IS NOT NULL AND
      due_at_ms >= 0 AND
      due_timezone IS NOT NULL AND
      length(trim(due_timezone)) > 0
    )
  ),
  FOREIGN KEY (project_id) REFERENCES projects (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (section_id, project_id)
    REFERENCES sections (id, project_id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE INDEX projects_order_idx
  ON projects (position, created_at_ms, id);
CREATE INDEX sections_project_order_idx
  ON sections (project_id, position, created_at_ms, id);
CREATE INDEX tasks_project_fk_idx
  ON tasks (project_id);
CREATE INDEX tasks_section_project_fk_idx
  ON tasks (section_id, project_id);
CREATE INDEX tasks_inbox_order_idx
  ON tasks (position, created_at_ms, id)
  WHERE project_id IS NULL AND section_id IS NULL AND trashed_at_ms IS NULL;
CREATE INDEX tasks_all_day_today_idx
  ON tasks (due_date, position, created_at_ms, id)
  WHERE due_kind = 'all_day' AND completed_at_ms IS NULL AND trashed_at_ms IS NULL;
CREATE INDEX tasks_timed_today_idx
  ON tasks (due_at_ms, position, created_at_ms, id)
  WHERE due_kind = 'timed' AND completed_at_ms IS NULL AND trashed_at_ms IS NULL;
CREATE INDEX tasks_completed_idx
  ON tasks (completed_at_ms DESC, id)
  WHERE completed_at_ms IS NOT NULL AND trashed_at_ms IS NULL;
CREATE INDEX tasks_trashed_idx
  ON tasks (trashed_at_ms DESC, id)
  WHERE trashed_at_ms IS NOT NULL;

PRAGMA user_version = 1;
COMMIT;
`;

export class UnsupportedSchemaVersionError extends Error {
  readonly version: number;

  constructor(version: number) {
    super(`Unsupported Worktodo schema version: ${version}`);
    this.name = "UnsupportedSchemaVersionError";
    this.version = version;
  }
}

export type MigrationResult = {
  applied: boolean;
  previousVersion: number;
  currentVersion: number;
};

type MigrationOptions = {
  beforeVersionSet?: () => void;
};

function schemaBody(): string {
  const prefix = "BEGIN IMMEDIATE;";
  const suffix = `PRAGMA user_version = ${WORKTODO_SCHEMA_VERSION};\nCOMMIT;\n`;

  if (!PRODUCTION_SCHEMA_SQL.startsWith(prefix) || !PRODUCTION_SCHEMA_SQL.endsWith(suffix)) {
    throw new Error("The production schema does not contain the expected transaction boundary");
  }

  return PRODUCTION_SCHEMA_SQL.slice(prefix.length, -suffix.length);
}

function userVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get();
  return Number(row ? Object.values(row)[0] : Number.NaN);
}

export function applyMigrations(db: DatabaseSync, options: MigrationOptions = {}): MigrationResult {
  db.exec("BEGIN IMMEDIATE");

  try {
    const previousVersion = userVersion(db);
    if (previousVersion > WORKTODO_SCHEMA_VERSION || previousVersion < 0) {
      throw new UnsupportedSchemaVersionError(previousVersion);
    }

    if (previousVersion === WORKTODO_SCHEMA_VERSION) {
      db.exec("COMMIT");
      return { applied: false, previousVersion, currentVersion: previousVersion };
    }

    db.exec(schemaBody());
    options.beforeVersionSet?.();
    db.exec(`PRAGMA user_version = ${WORKTODO_SCHEMA_VERSION}`);
    db.exec("COMMIT");
    return {
      applied: true,
      previousVersion,
      currentVersion: WORKTODO_SCHEMA_VERSION,
    };
  } catch (error) {
    if (db.isTransaction) {
      db.exec("ROLLBACK");
    }
    throw error;
  }
}
