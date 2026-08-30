import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DomainError, type DueValue } from "../../src/shared/domain/model";
import { type TaskRepository } from "../../src/shared/domain/repository";
import { TaskService } from "../../src/shared/domain/task-service";
import { openWorktodoDatabase } from "../../src/shared/storage/database";
import { applyMigrations } from "../../src/shared/storage/schema";
import { SqliteTaskRepository } from "../../src/shared/storage/sqlite-task-repository";

const temporaryDirectories: string[] = [];

function id(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

async function createContext() {
  const directory = await mkdtemp(join(tmpdir(), "worktodo-domain-test-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "worktodo.sqlite");
  const db = openWorktodoDatabase(databasePath);
  applyMigrations(db);
  const repository = new SqliteTaskRepository(db);
  let nextId = 1;
  let now = 1_000;
  const dependencies = {
    createId: () => id(nextId++),
    now: () => now,
  };
  return {
    databasePath,
    db,
    repository,
    service: new TaskService(repository, dependencies),
    setNow: (value: number) => {
      now = value;
    },
    dependencies,
  };
}

function expectDomainError(operation: () => unknown, code: DomainError["code"]): void {
  try {
    operation();
    throw new Error("Expected a domain error");
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("shared domain operations", () => {
  it("round-trips every placement, due kind, priority, and combined lifecycle state", async () => {
    const context = await createContext();
    const { service, db, databasePath } = context;
    const project = service.createProject("  Personal  ");
    const section = service.createSection(project.id, "Next");
    const dueValues: DueValue[] = [
      { kind: "none" },
      { kind: "allDay", date: "2026-10-04" },
      { kind: "timed", instantMs: 1_780_551_000_000, timeZone: "Australia/Melbourne" },
    ];
    const inbox = service.createTask({
      title: "Inbox",
      priority: "none",
      placement: { kind: "inbox" },
      due: dueValues[0],
    });
    const direct = service.createTask({
      title: "Project",
      notes: "Plan at https://example.com/roadmap",
      priority: "low",
      placement: { kind: "project", projectId: project.id },
      due: dueValues[1],
    });
    const sectionTask = service.createTask({
      title: "Section",
      notes: "Unicode note: café ☕",
      priority: "medium",
      placement: { kind: "section", projectId: project.id, sectionId: section.id },
      due: dueValues[2],
    });
    service.createTask({ title: "High", priority: "high", placement: { kind: "inbox" } });

    context.setNow(2_000);
    service.completeTask(sectionTask.id);
    context.setNow(3_000);
    const completedAndTrashed = service.trashTask(sectionTask.id);
    db.close();

    const reopened = openWorktodoDatabase(databasePath);
    try {
      expect(applyMigrations(reopened)).toEqual({ applied: false, previousVersion: 1, currentVersion: 1 });
      const repository = new SqliteTaskRepository(reopened);
      expect(repository.getTask(inbox.id)).toMatchObject({
        projectId: null,
        sectionId: null,
        due: { kind: "none" },
        priority: "none",
      });
      expect(repository.getTask(direct.id)).toMatchObject({
        projectId: project.id,
        sectionId: null,
        due: { kind: "allDay", date: "2026-10-04" },
        priority: "low",
      });
      expect(repository.getTask(sectionTask.id)).toEqual(completedAndTrashed);
      expect(
        repository
          .listTasks()
          .map((task) => task.priority)
          .sort(),
      ).toEqual(["high", "low", "medium", "none"]);
    } finally {
      reopened.close();
    }
  });

  it("returns bounded errors for invalid values and placements without partial writes", async () => {
    const { service, repository, db } = await createContext();
    try {
      const firstProject = service.createProject("First");
      const secondProject = service.createProject("Second");
      const section = service.createSection(firstProject.id, "Next");
      const missing = id(999);

      expectDomainError(
        () => service.createTask({ title: "Missing", placement: { kind: "project", projectId: missing } }),
        "INVALID_PLACEMENT",
      );
      expectDomainError(
        () =>
          service.createTask({
            title: "Cross-project",
            placement: { kind: "section", projectId: secondProject.id, sectionId: section.id },
          }),
        "INVALID_PLACEMENT",
      );
      expectDomainError(
        () =>
          service.createTask({
            title: "Bad date",
            placement: { kind: "inbox" },
            due: { kind: "allDay", date: "2026-02-30" },
          }),
        "INVALID_DUE_VALUE",
      );
      expectDomainError(() => service.createTask({ title: "  ", placement: { kind: "inbox" } }), "INVALID_ARGUMENT");
      expectDomainError(() => service.createSection(missing, "No parent"), "NOT_FOUND");
      expect(repository.listTasks()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("enforces lifecycle transitions, monotonic timestamps, and idempotent no-ops", async () => {
    const context = await createContext();
    const { service, db } = context;
    try {
      const task = service.createTask({ title: "Lifecycle", placement: { kind: "inbox" } });
      context.setNow(500);
      const completed = service.completeTask(task.id);
      expect(completed.completedAtMs).toBe(1_001);
      expect(service.listCompleted()).toEqual([completed]);
      expect(service.listTrash()).toEqual([]);
      context.setNow(9_000);
      expect(service.completeTask(task.id)).toEqual(completed);

      context.setNow(500);
      const trashed = service.trashTask(task.id);
      expect(trashed).toMatchObject({ completedAtMs: 1_001, trashedAtMs: 1_002, updatedAtMs: 1_002 });
      expect(service.listCompleted()).toEqual([]);
      expect(service.listTrash()).toEqual([trashed]);
      expect(service.trashTask(task.id)).toEqual(trashed);
      expectDomainError(() => service.updateTask(task.id, { title: "Blocked" }), "TASK_TRASHED");
      expectDomainError(() => service.moveTask(task.id, { kind: "inbox" }), "TASK_TRASHED");
      expectDomainError(() => service.completeTask(task.id), "TASK_TRASHED");
      expectDomainError(() => service.reopenTask(task.id), "TASK_TRASHED");

      const restored = service.restoreTask(task.id);
      expect(restored).toMatchObject({ completedAtMs: 1_001, trashedAtMs: null, updatedAtMs: 1_003 });
      expect(service.listCompleted()).toEqual([restored]);
      expect(service.listTrash()).toEqual([]);
      expect(service.restoreTask(task.id)).toEqual(restored);
      const reopened = service.reopenTask(task.id);
      expect(reopened).toMatchObject({ completedAtMs: null, trashedAtMs: null, updatedAtMs: 1_004 });
      expect(service.listCompleted()).toEqual([]);
      expect(service.listTrash()).toEqual([]);
      expect(service.reopenTask(task.id)).toEqual(reopened);
    } finally {
      db.close();
    }
  });

  it("updates and moves active tasks atomically", async () => {
    const context = await createContext();
    const { service, db } = context;
    try {
      const project = service.createProject("Personal");
      const section = service.createSection(project.id, "Next");
      const task = service.createTask({ title: "Draft", placement: { kind: "inbox" } });
      context.setNow(2_000);
      const updated = service.updateTask(task.id, {
        title: "Final",
        notes: "Details",
        priority: "high",
        due: { kind: "timed", instantMs: 2_000_000, timeZone: "Australia/Melbourne" },
      });
      expect(updated).toMatchObject({ title: "Final", notes: "Details", priority: "high", updatedAtMs: 2_000 });
      context.setNow(3_000);
      const moved = service.moveTask(task.id, { kind: "section", projectId: project.id, sectionId: section.id });
      expect(moved).toMatchObject({
        projectId: project.id,
        sectionId: section.id,
        position: 1_024,
        updatedAtMs: 3_000,
      });
      context.setNow(4_000);
      expect(service.moveTask(task.id, { kind: "section", projectId: project.id, sectionId: section.id })).toEqual(
        moved,
      );
      expect(service.listProjectTasks(project.id)).toEqual([moved]);
      expect(service.listSectionTasks(section.id)).toEqual([moved]);
    } finally {
      db.close();
    }
  });

  it("exposes the shared Upcoming query through the task service", async () => {
    const { service, db } = await createContext();
    try {
      const upcoming = service.createTask({
        title: "Tomorrow",
        placement: { kind: "inbox" },
        due: { kind: "allDay", date: "2026-10-05" },
      });
      service.createTask({
        title: "Today",
        placement: { kind: "inbox" },
        due: { kind: "allDay", date: "2026-10-04" },
      });

      expect(
        service
          .listUpcoming(Date.parse("2026-10-04T01:00:00.000Z"), "Australia/Melbourne")
          .tasks.map(({ task, localDate }) => [task.id, localDate]),
      ).toEqual([[upcoming.id, "2026-10-05"]]);
    } finally {
      db.close();
    }
  });

  it("renumbers a placement before an append would exceed the safe integer range", async () => {
    const context = await createContext();
    const { service, repository, db } = context;
    try {
      const existing = {
        id: id(900),
        name: "Existing",
        position: Number.MAX_SAFE_INTEGER,
        createdAtMs: 500,
        updatedAtMs: 500,
      };
      repository.insertProject(existing);
      const appended = service.createProject("Appended");
      expect(repository.getProject(existing.id)).toMatchObject({ position: 1_024, updatedAtMs: 1_000 });
      expect(appended.position).toBe(2_048);
    } finally {
      db.close();
    }
  });

  it("normalizes every task before removing its section or project", async () => {
    const context = await createContext();
    const { service, repository, db } = context;
    try {
      const inbox = service.createTask({ title: "Existing inbox", placement: { kind: "inbox" } });
      const project = service.createProject("Project");
      const firstSection = service.createSection(project.id, "First");
      const secondSection = service.createSection(project.id, "Second");
      const directFirst = service.createTask({
        title: "Direct first",
        priority: "low",
        placement: { kind: "project", projectId: project.id },
      });
      const directSecond = service.createTask({
        title: "Direct second",
        priority: "high",
        placement: { kind: "project", projectId: project.id },
      });
      const sectionFirst = service.createTask({
        title: "Section first",
        placement: { kind: "section", projectId: project.id, sectionId: firstSection.id },
      });
      const sectionSecond = service.createTask({
        title: "Section second",
        placement: { kind: "section", projectId: project.id, sectionId: secondSection.id },
      });
      context.setNow(2_000);
      service.completeTask(sectionFirst.id);
      context.setNow(3_000);
      service.trashTask(sectionSecond.id);
      repository.updateTask({ ...service.getTask(inbox.id), position: Number.MAX_SAFE_INTEGER });
      context.setNow(4_000);
      service.removeProject(project.id);

      expectDomainError(() => service.removeProject(project.id), "NOT_FOUND");
      expect(service.listProjects()).toEqual([]);
      expect(service.listSections()).toEqual([]);
      expect([directFirst, directSecond, sectionFirst, sectionSecond].map((task) => service.getTask(task.id))).toEqual(
        [directFirst, directSecond, sectionFirst, sectionSecond].map((task, index) =>
          expect.objectContaining({
            id: task.id,
            projectId: null,
            sectionId: null,
            position: (index + 2) * 1_024,
          }),
        ),
      );
      expect(service.getTask(sectionFirst.id).completedAtMs).toBe(2_000);
      expect(service.getTask(sectionSecond.id).trashedAtMs).toBe(3_000);
      expect(service.getTask(inbox.id).position).toBe(1_024);

      const nextProject = service.createProject("Next project");
      const nextSection = service.createSection(nextProject.id, "Next section");
      const direct = service.createTask({ title: "Direct", placement: { kind: "project", projectId: nextProject.id } });
      const nested = service.createTask({
        title: "Nested",
        placement: { kind: "section", projectId: nextProject.id, sectionId: nextSection.id },
      });
      context.setNow(5_000);
      service.removeSection(nextSection.id);
      expect(service.getTask(direct.id).position).toBe(1_024);
      expect(service.getTask(nested.id)).toMatchObject({ projectId: nextProject.id, sectionId: null, position: 2_048 });
    } finally {
      db.close();
    }
  });

  it("rolls back earlier writes when a later storage operation fails", async () => {
    const context = await createContext();
    const { service, repository, dependencies, db } = context;
    try {
      const project = service.createProject("Rollback");
      const task = service.createTask({ title: "Preserved", placement: { kind: "project", projectId: project.id } });
      const failingRepository = new Proxy(repository as TaskRepository, {
        get(target, property, receiver) {
          if (property === "deleteProject") {
            return () => {
              throw new Error("injected storage failure");
            };
          }
          const value = Reflect.get(target, property, receiver) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const failingService = new TaskService(failingRepository, dependencies);
      expect(() => failingService.removeProject(project.id)).toThrow("injected storage failure");
      expect(repository.getProject(project.id)).toEqual(project);
      expect(repository.getTask(task.id)).toEqual(task);
    } finally {
      db.close();
    }
  });
});
