import { DatabaseSync } from "node:sqlite";
import { readSpikePragmas, SPIKE_BUSY_TIMEOUT_MS, SPIKE_JOURNAL_MODE, SPIKE_SYNCHRONOUS_LEVEL } from "./database";

const SCHEMA_PATTERN = /<!-- task-model-schema:start -->\s*```sql\n([\s\S]*?)\n```\s*<!-- task-model-schema:end -->/;

const REQUIRED_INDEXES = [
  "projects_order_idx",
  "sections_project_order_idx",
  "tasks_all_day_today_idx",
  "tasks_completed_idx",
  "tasks_inbox_order_idx",
  "tasks_project_fk_idx",
  "tasks_section_project_fk_idx",
  "tasks_timed_today_idx",
  "tasks_trashed_idx",
] as const;

type RejectedCase =
  | "section without project"
  | "missing project"
  | "cross-project section"
  | "invalid priority"
  | "none due with date"
  | "all-day due without date"
  | "timed due without timezone"
  | "reversed timestamps"
  | "parent deletion with tasks";

type TaskRow = {
  id: string;
  title?: string;
  notes?: string;
  priority?: string;
  position?: number;
  projectId?: string | null;
  sectionId?: string | null;
  dueKind?: string;
  dueDate?: string | null;
  dueAtMs?: number | null;
  dueTimezone?: string | null;
  createdAtMs?: number;
  updatedAtMs?: number;
  completedAtMs?: number | null;
  trashedAtMs?: number | null;
};

export type TaskModelSchemaValidation = {
  schemaVersion: number;
  strictTables: string[];
  requiredIndexes: string[];
  validRoundTrips: number;
  rejectedCases: string[];
  integrity: string;
  foreignKeyViolations: number;
  pragmas: {
    journalMode: string;
    synchronous: number;
    foreignKeys: number;
    busyTimeout: number;
  };
};

function scalarNumber(db: DatabaseSync, sql: string): number {
  const row = db.prepare(sql).get();
  const value = row ? Object.values(row)[0] : undefined;
  if (typeof value !== "number") {
    throw new Error(`Expected numeric result from ${sql}`);
  }
  return value;
}

function expectRejected(label: RejectedCase, operation: () => void, rejected: string[]): void {
  try {
    operation();
  } catch {
    rejected.push(label);
    return;
  }
  throw new Error(`Task model schema accepted invalid case: ${label}`);
}

export function extractTaskModelSchema(markdown: string): string {
  const match = markdown.match(SCHEMA_PATTERN);
  const schema = match?.[1]?.trim();
  if (!schema) {
    throw new Error("Task model documentation does not contain one marked SQL schema block");
  }
  return `${schema}\n`;
}

export function validateTaskModelSchema(databasePath: string, schema: string): TaskModelSchemaValidation {
  const db = new DatabaseSync(databasePath, {
    allowExtension: false,
    enableDoubleQuotedStringLiterals: false,
    enableForeignKeyConstraints: true,
    timeout: SPIKE_BUSY_TIMEOUT_MS,
  });

  try {
    db.exec(`
      PRAGMA journal_mode = DELETE;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = ${SPIKE_BUSY_TIMEOUT_MS};
    `);
    db.exec(schema);

    const projectInsert = db.prepare(
      "INSERT INTO projects(id, name, position, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?)",
    );
    const sectionInsert = db.prepare(
      "INSERT INTO sections(id, project_id, name, position, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const taskInsert = db.prepare(`
      INSERT INTO tasks(
        id, title, notes, priority, position, project_id, section_id,
        due_kind, due_date, due_at_ms, due_timezone,
        created_at_ms, updated_at_ms, completed_at_ms, trashed_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertTask = (row: TaskRow): void => {
      taskInsert.run(
        row.id,
        row.title ?? "Invalid",
        row.notes ?? "",
        row.priority ?? "none",
        row.position ?? 1_024,
        row.projectId ?? null,
        row.sectionId ?? null,
        row.dueKind ?? "none",
        row.dueDate ?? null,
        row.dueAtMs ?? null,
        row.dueTimezone ?? null,
        row.createdAtMs ?? 1_000,
        row.updatedAtMs ?? 1_000,
        row.completedAtMs ?? null,
        row.trashedAtMs ?? null,
      );
    };

    const projectOne = "11111111-1111-4111-8111-111111111111";
    const projectTwo = "22222222-2222-4222-8222-222222222222";
    const sectionOne = "33333333-3333-4333-8333-333333333333";
    projectInsert.run(projectOne, "Personal", 1_024, 1_000, 1_000);
    projectInsert.run(projectTwo, "Work", 2_048, 1_000, 1_000);
    sectionInsert.run(sectionOne, projectOne, "Next", 1_024, 1_000, 1_000);

    insertTask({ id: "44444444-4444-4444-8444-444444444444", title: "Inbox task" });
    insertTask({
      id: "55555555-5555-4555-8555-555555555555",
      title: "Project task",
      notes: "Plan at https://example.com/roadmap",
      priority: "medium",
      projectId: projectOne,
      dueKind: "all_day",
      dueDate: "2026-10-04",
      updatedAtMs: 2_000,
    });
    insertTask({
      id: "66666666-6666-4666-8666-666666666666",
      title: "Section task",
      notes: "Unicode note: café ☕",
      priority: "high",
      projectId: projectOne,
      sectionId: sectionOne,
      dueKind: "timed",
      dueAtMs: 1_780_551_000_000,
      dueTimezone: "Australia/Melbourne",
      updatedAtMs: 4_000,
      completedAtMs: 2_000,
      trashedAtMs: 3_000,
    });

    const rejected: string[] = [];
    expectRejected(
      "section without project",
      () => insertTask({ id: "70000000-0000-4000-8000-000000000001", sectionId: sectionOne }),
      rejected,
    );
    expectRejected(
      "missing project",
      () =>
        insertTask({
          id: "70000000-0000-4000-8000-000000000002",
          projectId: "99999999-9999-4999-8999-999999999999",
        }),
      rejected,
    );
    expectRejected(
      "cross-project section",
      () =>
        insertTask({
          id: "70000000-0000-4000-8000-000000000003",
          projectId: projectTwo,
          sectionId: sectionOne,
        }),
      rejected,
    );
    expectRejected(
      "invalid priority",
      () => insertTask({ id: "70000000-0000-4000-8000-000000000004", priority: "urgent" }),
      rejected,
    );
    expectRejected(
      "none due with date",
      () => insertTask({ id: "70000000-0000-4000-8000-000000000005", dueDate: "2026-10-04" }),
      rejected,
    );
    expectRejected(
      "all-day due without date",
      () => insertTask({ id: "70000000-0000-4000-8000-000000000006", dueKind: "all_day" }),
      rejected,
    );
    expectRejected(
      "timed due without timezone",
      () =>
        insertTask({
          id: "70000000-0000-4000-8000-000000000007",
          dueKind: "timed",
          dueAtMs: 1_780_551_000_000,
        }),
      rejected,
    );
    expectRejected(
      "reversed timestamps",
      () =>
        insertTask({
          id: "70000000-0000-4000-8000-000000000008",
          createdAtMs: 2_000,
          updatedAtMs: 1_000,
        }),
      rejected,
    );
    expectRejected(
      "parent deletion with tasks",
      () => db.prepare("DELETE FROM projects WHERE id = ?").run(projectOne),
      rejected,
    );

    const rows = db
      .prepare(
        `SELECT id, notes, project_id, section_id, due_kind, due_date, due_at_ms, due_timezone,
                completed_at_ms, trashed_at_ms
           FROM tasks
          ORDER BY id`,
      )
      .all();
    if (rows.length !== 3) {
      throw new Error(`Expected three valid task round trips, observed ${rows.length}`);
    }
    const sectionTask = rows[2];
    if (
      sectionTask?.notes !== "Unicode note: café ☕" ||
      sectionTask.project_id !== projectOne ||
      sectionTask.section_id !== sectionOne ||
      sectionTask.due_kind !== "timed" ||
      sectionTask.due_at_ms !== 1_780_551_000_000 ||
      sectionTask.due_timezone !== "Australia/Melbourne" ||
      sectionTask.completed_at_ms !== 2_000 ||
      sectionTask.trashed_at_ms !== 3_000
    ) {
      throw new Error("Task model schema lost data during the valid section-task round trip");
    }

    const strictTables = db
      .prepare("PRAGMA table_list")
      .all()
      .filter((row) => row.name === "projects" || row.name === "sections" || row.name === "tasks")
      .map((row) => {
        if (row.strict !== 1 || typeof row.name !== "string") {
          throw new Error(`Task model table is not STRICT: ${String(row.name)}`);
        }
        return row.name;
      })
      .sort();
    const indexes = db
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'index' AND name NOT LIKE 'sqlite_autoindex_%'")
      .all()
      .map((row) => String(row.name))
      .sort();
    for (const index of REQUIRED_INDEXES) {
      if (!indexes.includes(index)) {
        throw new Error(`Task model schema is missing required index: ${index}`);
      }
    }

    const pragmas = readSpikePragmas(db);
    if (
      pragmas.journalMode !== SPIKE_JOURNAL_MODE ||
      pragmas.synchronous !== SPIKE_SYNCHRONOUS_LEVEL ||
      pragmas.foreignKeys !== 1 ||
      pragmas.busyTimeout !== SPIKE_BUSY_TIMEOUT_MS
    ) {
      throw new Error(`Task model validation used unexpected connection pragmas: ${JSON.stringify(pragmas)}`);
    }

    return {
      schemaVersion: scalarNumber(db, "PRAGMA user_version"),
      strictTables,
      requiredIndexes: [...REQUIRED_INDEXES],
      validRoundTrips: rows.length,
      rejectedCases: rejected,
      integrity: String(db.prepare("PRAGMA integrity_check").get()?.integrity_check),
      foreignKeyViolations: db.prepare("PRAGMA foreign_key_check").all().length,
      pragmas,
    };
  } finally {
    db.close();
  }
}
