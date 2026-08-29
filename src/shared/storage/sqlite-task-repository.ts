import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { DueValue, Priority, Project, Section, Task } from "../domain/model";
import type { TaskRepository } from "../domain/repository";

type Row = Record<string, unknown>;

function requiredString(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new Error(`Invalid text in ${column}`);
  }
  return value;
}

function requiredInteger(row: Row, column: string): number {
  const value = row[column];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`Invalid integer in ${column}`);
  }
  return value;
}

function nullableString(row: Row, column: string): string | null {
  return row[column] === null ? null : requiredString(row, column);
}

function nullableInteger(row: Row, column: string): number | null {
  return row[column] === null ? null : requiredInteger(row, column);
}

function priority(row: Row): Priority {
  const value = requiredString(row, "priority");
  if (value === "none" || value === "low" || value === "medium" || value === "high") {
    return value;
  }
  throw new Error("Invalid stored priority");
}

function dueValue(row: Row): DueValue {
  const kind = requiredString(row, "due_kind");
  if (kind === "none") {
    return { kind: "none" };
  }
  if (kind === "all_day") {
    return { kind: "allDay", date: requiredString(row, "due_date") };
  }
  if (kind === "timed") {
    return {
      kind: "timed",
      instantMs: requiredInteger(row, "due_at_ms"),
      timeZone: requiredString(row, "due_timezone"),
    };
  }
  throw new Error("Invalid stored due kind");
}

function dueColumns(due: DueValue): [string, string | null, number | null, string | null] {
  if (due.kind === "none") {
    return ["none", null, null, null];
  }
  if (due.kind === "allDay") {
    return ["all_day", due.date, null, null];
  }
  return ["timed", null, due.instantMs, due.timeZone];
}

function projectFromRow(row: Row): Project {
  return {
    id: requiredString(row, "id"),
    name: requiredString(row, "name"),
    position: requiredInteger(row, "position"),
    createdAtMs: requiredInteger(row, "created_at_ms"),
    updatedAtMs: requiredInteger(row, "updated_at_ms"),
  };
}

function sectionFromRow(row: Row): Section {
  return {
    id: requiredString(row, "id"),
    projectId: requiredString(row, "project_id"),
    name: requiredString(row, "name"),
    position: requiredInteger(row, "position"),
    createdAtMs: requiredInteger(row, "created_at_ms"),
    updatedAtMs: requiredInteger(row, "updated_at_ms"),
  };
}

function taskFromRow(row: Row): Task {
  return {
    id: requiredString(row, "id"),
    title: requiredString(row, "title"),
    notes: requiredString(row, "notes"),
    priority: priority(row),
    position: requiredInteger(row, "position"),
    projectId: nullableString(row, "project_id"),
    sectionId: nullableString(row, "section_id"),
    due: dueValue(row),
    createdAtMs: requiredInteger(row, "created_at_ms"),
    updatedAtMs: requiredInteger(row, "updated_at_ms"),
    completedAtMs: nullableInteger(row, "completed_at_ms"),
    trashedAtMs: nullableInteger(row, "trashed_at_ms"),
  };
}

function first<T>(statement: StatementSync, id: string, map: (row: Row) => T): T | null {
  const row = statement.get(id) as Row | undefined;
  return row ? map(row) : null;
}

export class SqliteTaskRepository implements TaskRepository {
  constructor(private readonly db: DatabaseSync) {}

  transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      if (this.db.isTransaction) {
        this.db.exec("ROLLBACK");
      }
      throw error;
    }
  }

  getProject(id: string): Project | null {
    return first(this.db.prepare("SELECT * FROM projects WHERE id = ?"), id, projectFromRow);
  }

  listProjects(): Project[] {
    return (this.db.prepare("SELECT * FROM projects").all() as Row[]).map(projectFromRow);
  }

  insertProject(project: Project): void {
    this.db
      .prepare("INSERT INTO projects(id, name, position, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?)")
      .run(project.id, project.name, project.position, project.createdAtMs, project.updatedAtMs);
  }

  updateProject(project: Project): void {
    this.db
      .prepare("UPDATE projects SET name = ?, position = ?, updated_at_ms = ? WHERE id = ?")
      .run(project.name, project.position, project.updatedAtMs, project.id);
  }

  deleteProject(id: string): void {
    this.db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  }

  getSection(id: string): Section | null {
    return first(this.db.prepare("SELECT * FROM sections WHERE id = ?"), id, sectionFromRow);
  }

  listSections(): Section[] {
    return (this.db.prepare("SELECT * FROM sections").all() as Row[]).map(sectionFromRow);
  }

  insertSection(section: Section): void {
    this.db
      .prepare(
        "INSERT INTO sections(id, project_id, name, position, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(section.id, section.projectId, section.name, section.position, section.createdAtMs, section.updatedAtMs);
  }

  updateSection(section: Section): void {
    this.db
      .prepare("UPDATE sections SET name = ?, position = ?, updated_at_ms = ? WHERE id = ?")
      .run(section.name, section.position, section.updatedAtMs, section.id);
  }

  deleteSection(id: string): void {
    this.db.prepare("DELETE FROM sections WHERE id = ?").run(id);
  }

  getTask(id: string): Task | null {
    return first(this.db.prepare("SELECT * FROM tasks WHERE id = ?"), id, taskFromRow);
  }

  listTasks(): Task[] {
    return (this.db.prepare("SELECT * FROM tasks").all() as Row[]).map(taskFromRow);
  }

  insertTask(task: Task): void {
    const due = dueColumns(task.due);
    this.db
      .prepare(
        `
        INSERT INTO tasks(
          id, title, notes, priority, position, project_id, section_id,
          due_kind, due_date, due_at_ms, due_timezone,
          created_at_ms, updated_at_ms, completed_at_ms, trashed_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        task.id,
        task.title,
        task.notes,
        task.priority,
        task.position,
        task.projectId,
        task.sectionId,
        ...due,
        task.createdAtMs,
        task.updatedAtMs,
        task.completedAtMs,
        task.trashedAtMs,
      );
  }

  updateTask(task: Task): void {
    const due = dueColumns(task.due);
    this.db
      .prepare(
        `
        UPDATE tasks SET
          title = ?, notes = ?, priority = ?, position = ?, project_id = ?, section_id = ?,
          due_kind = ?, due_date = ?, due_at_ms = ?, due_timezone = ?,
          updated_at_ms = ?, completed_at_ms = ?, trashed_at_ms = ?
        WHERE id = ?
      `,
      )
      .run(
        task.title,
        task.notes,
        task.priority,
        task.position,
        task.projectId,
        task.sectionId,
        ...due,
        task.updatedAtMs,
        task.completedAtMs,
        task.trashedAtMs,
        task.id,
      );
  }
}
