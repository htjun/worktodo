import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadMenuBarModel } from "../../src/shared/application/menu-bar-workflows";
import { canReorderTask, reorderTaskInView } from "../../src/shared/application/task-ordering";
import { loadTaskView, type TaskView } from "../../src/shared/application/task-views";
import { openWorktodoAtPath } from "../../src/shared/application/worktodo";
import type { TaskRepository } from "../../src/shared/domain/repository";
import { TaskService } from "../../src/shared/domain/task-service";
import { parseBackupJson } from "../../src/shared/portability/backup-contract";
import { buildTaskViewSections } from "../../src/shared/presentation/task-views";
import { openWorktodoDatabase } from "../../src/shared/storage/database";
import { SqliteTaskRepository } from "../../src/shared/storage/sqlite-task-repository";

const directories: string[] = [];
const context = {
  view: { kind: "today" as const },
  evaluationInstantMs: Date.parse("2026-09-30T02:00:00Z"),
  viewerTimeZone: "Australia/Melbourne",
  searchText: "",
  isLoading: false,
};
const due = { kind: "allDay" as const, date: "2026-09-30" };

async function openContext() {
  const directory = await mkdtemp(join(tmpdir(), "worktodo-task-order-test-"));
  directories.push(directory);
  const databasePath = join(directory, "worktodo.sqlite");
  let nextId = 1;
  let now = 1_000;
  const options = {
    createId: () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
    now: () => now++,
    recoveryDirectory: join(directory, "recovery"),
  };
  const session = openWorktodoAtPath(databasePath, options);
  const sections = (view: TaskView = context.view) =>
    buildTaskViewSections(
      loadTaskView(session.service, view, context),
      session.service.listProjects(),
      session.service.listLabels(),
    );
  const ids = () => sections()[0].items.map((item) => item.id);
  const menu = () =>
    loadMenuBarModel(
      () => openWorktodoAtPath(databasePath, options),
      context.viewerTimeZone,
      context.evaluationInstantMs,
    );
  return { directory, databasePath, options, session, ids, sections, menu };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("manual task ordering", () => {
  it("moves cross-project Today tasks one step, retains selection, and persists menu-bar order", async () => {
    const { session, ids, menu, databasePath, options } = await openContext();
    let closed = false;
    try {
      const work = session.service.createProject("Work");
      const home = session.service.createProject("Home");
      const overduePriority = session.service.createTask({
        title: "Overdue priority",
        due: { ...due, date: "2026-09-29" },
        priority: true,
      });
      const overdue = session.service.createTask({
        title: "Overdue",
        due: { ...due, date: "2026-09-29" },
        projectId: work.id,
      });
      const first = session.service.createTask({ title: "First", due, projectId: home.id });
      const second = session.service.createTask({
        title: "Second",
        due: { kind: "timed", instantMs: Date.parse("2026-09-30T01:00:00Z"), timeZone: "UTC" },
        projectId: work.id,
      });
      const priority = session.service.createTask({
        title: "Today priority",
        due: { kind: "timed", instantMs: Date.parse("2026-09-30T03:00:00Z"), timeZone: "UTC" },
        priority: true,
      });
      const last = session.service.createTask({
        title: "Last",
        due: { kind: "timed", instantMs: Date.parse("2026-09-30T04:00:00Z"), timeZone: "UTC" },
        projectId: home.id,
      });
      const original = [overduePriority, overdue, first, second, priority, last];
      expect(ids()).toEqual(original.map((task) => task.id));
      const moved = vi.fn();
      const move = (taskId: string, direction: "up" | "down") =>
        reorderTaskInView(session.service, taskId, direction, context, moved);

      expect(move(overduePriority.id, "up")).toEqual({ status: "unchanged" });
      expect(move(last.id, "down")).toEqual({ status: "unchanged" });
      expect(session.service.listManualTaskOrder()).toEqual([]);
      expect(moved).not.toHaveBeenCalled();
      expect(move(last.id, "up")).toEqual({ status: "moved", selectedTaskId: last.id });
      expect(move(last.id, "up")).toEqual({ status: "moved", selectedTaskId: last.id });
      expect(ids()).toEqual([overduePriority.id, overdue.id, first.id, last.id, second.id, priority.id]);
      expect(move(last.id, "down")).toEqual({ status: "moved", selectedTaskId: last.id });
      expect(ids()).toEqual([overduePriority.id, overdue.id, first.id, second.id, last.id, priority.id]);
      for (let count = 0; count < 5; count++) {
        expect(move(priority.id, "up").status).toBe("moved");
      }
      const expected = [priority.id, overduePriority.id, overdue.id, first.id, second.id, last.id];
      expect(ids()).toEqual(expected);
      expect(moved.mock.calls.slice(0, 3)).toEqual([[last.id], [last.id], [last.id]]);
      const model = menu();
      expect(model.count).toBe(6);
      expect(model.allTasksCount).toBe(6);
      expect(model.sections.map((section) => [section.key, section.tasks.map((task) => task.id)])).toEqual([
        ["priority", [priority.id, overduePriority.id]],
        ["overdue", [overdue.id]],
        ["today", [first.id, second.id, last.id]],
      ]);
      expect(original.map((task) => session.service.getTask(task.id))).toEqual(original);
      session.close();
      closed = true;
      const reopened = openWorktodoAtPath(databasePath, options);
      try {
        const sections = buildTaskViewSections(
          loadTaskView(reopened.service, context.view, context),
          reopened.service.listProjects(),
          [],
        );
        expect(sections[0].items.map((item) => item.id)).toEqual(expected);
        expect(menu()).toEqual(model);
      } finally {
        reopened.close();
      }
    } finally {
      if (!closed) session.close();
    }
  });

  it("blocks search, loading, inactive rows, and other views without refreshing or writing", async () => {
    const { session } = await openContext();
    try {
      const first = session.service.createTask({ title: "First", due });
      const second = session.service.createTask({ title: "Second", due });
      const moved = vi.fn();
      expect(canReorderTask(first, context)).toBe(true);
      for (const blocked of [
        { ...context, searchText: "First" },
        { ...context, isLoading: true },
        { ...context, view: { kind: "completed" as const } },
        { ...context, view: { kind: "trash" as const } },
      ]) {
        expect(canReorderTask(first, blocked)).toBe(false);
        expect(reorderTaskInView(session.service, first.id, "down", blocked, moved)).toEqual({ status: "unavailable" });
      }
      const completed = session.service.completeTask(first.id);
      expect(canReorderTask(completed, context)).toBe(false);
      expect(reorderTaskInView(session.service, first.id, "down", context, moved)).toEqual({ status: "unavailable" });
      const trashed = session.service.trashTask(second.id);
      expect(canReorderTask(trashed, context)).toBe(false);
      expect(reorderTaskInView(session.service, second.id, "up", context, moved)).toEqual({ status: "unavailable" });
      expect(session.service.listManualTaskOrder()).toEqual([]);
      expect(moved).not.toHaveBeenCalled();
    } finally {
      session.close();
    }
  });

  it("preserves saved non-members, uses fallback for new tasks, and retains ranks through lifecycle changes", async () => {
    const { session, ids } = await openContext();
    try {
      const outside = session.service.createTask({ title: "Outside" });
      const other = session.service.createTask({ title: "Other" });
      session.service.reorderTask(other.id, "up", [outside.id, other.id]);
      const first = session.service.createTask({ title: "First", due });
      const second = session.service.createTask({ title: "Second", due });
      session.service.reorderTask(second.id, "up", [first.id, second.id]);
      expect(session.service.listManualTaskOrder()).toEqual([other.id, outside.id, second.id, first.id]);
      const added = session.service.createTask({ title: "New", due });
      expect(ids()).toEqual([second.id, first.id, added.id]);
      session.service.reorderTask(added.id, "up", ids());
      expect(ids()).toEqual([second.id, added.id, first.id]);
      expect(session.service.listManualTaskOrder().slice(0, 2)).toEqual([other.id, outside.id]);
      session.service.completeTask(second.id);
      session.service.trashTask(first.id);
      expect(ids()).toEqual([added.id]);
      session.service.reopenTask(second.id);
      session.service.restoreTask(first.id);
      expect(ids()).toEqual([second.id, added.id, first.id]);
    } finally {
      session.close();
    }
  });

  it("rejects invalid groups and rolls back a failed saved-order replacement", async () => {
    const { session, databasePath } = await openContext();
    const db = openWorktodoDatabase(databasePath);
    try {
      const first = session.service.createTask({ title: "First", due });
      const second = session.service.createTask({ title: "Second", due });
      session.service.reorderTask(second.id, "up", [first.id, second.id]);
      const before = session.service.listManualTaskOrder();
      expect(() => session.service.reorderTask(first.id, "up", [first.id, first.id])).toThrow("unique group IDs");
      expect(() => session.service.reorderTask(first.id, "up", [])).toThrow("current group");
      expect(() => session.service.reorderTask(first.id, "up", [first.id, "invalid"])).toThrow();
      const completed = session.service.createTask({ title: "Completed", due });
      session.service.completeTask(completed.id);
      expect(() => session.service.reorderTask(first.id, "up", [first.id, completed.id])).toThrow("active task");
      const trashed = session.service.createTask({ title: "Trash", due });
      session.service.trashTask(trashed.id);
      expect(() => session.service.reorderTask(first.id, "up", [first.id, trashed.id])).toThrow("Restore");
      const repository = new SqliteTaskRepository(db);
      const failing = new Proxy(repository, {
        get(target, property) {
          const value = target[property as keyof TaskRepository];
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            const result = Reflect.apply(value, target, args);
            if (property === "replaceManualTaskOrder") throw new Error("Injected order failure");
            return result;
          };
        },
      });
      const service = new TaskService(failing, { createId: () => first.id, now: () => 1_000 });
      const moved = vi.fn();
      expect(reorderTaskInView(service, first.id, "up", context, moved)).toMatchObject({
        status: "failed",
        error: new Error("Injected order failure"),
      });
      expect(session.service.listManualTaskOrder()).toEqual(before);
      expect(moved).not.toHaveBeenCalled();
      expect(db.isTransaction).toBe(false);
    } finally {
      db.close();
      session.close();
    }
  });

  it("restores order, exports recovery order, rejects stale previews, and imports version 3 without ranks", async () => {
    const { session, directory, ids } = await openContext();
    try {
      const first = session.service.createTask({ title: "First", due });
      const second = session.service.createTask({ title: "Second", due });
      const third = session.service.createTask({ title: "Third", due });
      session.service.reorderTask(third.id, "up", ids());
      const exportDirectory = join(directory, "exports");
      await mkdir(exportDirectory);
      const exported = session.portability.exportTo(exportDirectory);
      expect(exported.document.version).toBe(4);
      expect(exported.document.manualTaskOrder).toEqual([first.id, third.id, second.id]);
      const prepared = session.portability.prepare(exported.path);
      session.service.reorderTask(third.id, "up", ids());
      expect(() => session.portability.replace(prepared)).toThrowError(
        expect.objectContaining({ code: "STALE_PREVIEW" }),
      );
      expect(ids()).toEqual([third.id, first.id, second.id]);
      const restored = session.portability.replace(session.portability.prepare(exported.path));
      expect(ids()).toEqual([first.id, third.id, second.id]);
      expect(parseBackupJson(await readFile(restored.recoveryPath, "utf8")).manualTaskOrder).toEqual([
        third.id,
        first.id,
        second.id,
      ]);
      const legacy: Record<string, unknown> = { ...exported.document, version: 3 };
      delete legacy.manualTaskOrder;
      const legacyPath = join(directory, "legacy.json");
      await writeFile(legacyPath, JSON.stringify(legacy));
      session.portability.replace(session.portability.prepare(legacyPath));
      expect(session.service.listManualTaskOrder()).toEqual([]);
      expect(ids()).toEqual([first.id, second.id, third.id]);
    } finally {
      session.close();
    }
  });

  it("reorders project sections and overlapping labels without crossing All tasks groups", async () => {
    const { session, sections } = await openContext();
    try {
      const work = session.service.createProject("Work");
      const home = session.service.createProject("Home");
      const next = session.service.createLabel("Next");
      const shared = session.service.createLabel("Shared");
      const noProject = [
        session.service.createTask({ title: "No project first", due }),
        session.service.createTask({ title: "No project second", due }),
      ];
      const workTasks = [
        session.service.createTask({ title: "Work first", due, projectId: work.id, labelIds: [next.id, shared.id] }),
        session.service.createTask({ title: "Work second", due, projectId: work.id, labelIds: [next.id] }),
      ];
      const homeTasks = [
        session.service.createTask({ title: "Home first", due, projectId: home.id, labelIds: [next.id, shared.id] }),
        session.service.createTask({ title: "Home second", due, projectId: home.id, labelIds: [next.id] }),
      ];
      const all: TaskView = { kind: "all" };
      const project: TaskView = { kind: "project", projectId: work.id };
      const label: TaskView = { kind: "label", labelId: next.id };
      const moved = vi.fn();
      const move = (view: TaskView, taskId: string, direction: "up" | "down") =>
        reorderTaskInView(session.service, taskId, direction, { ...context, view }, moved);
      const groupIds = () => sections(all).map((section) => section.items.map((item) => item.id));
      const headings = sections(all).map((section) => [section.key, section.title]);
      expect(move(all, workTasks[1].id, "up").status).toBe("moved");
      expect(groupIds()).toEqual([
        noProject.map((task) => task.id),
        [workTasks[1].id, workTasks[0].id],
        homeTasks.map((task) => task.id),
      ]);
      expect(move(all, workTasks[1].id, "up")).toEqual({ status: "unchanged" });
      expect(sections(project)[0].items.map((item) => item.id)).toEqual([workTasks[1].id, workTasks[0].id]);
      expect(move(project, workTasks[1].id, "down").status).toBe("moved");
      expect(sections(project)[0].items.map((item) => item.id)).toEqual(workTasks.map((task) => task.id));
      expect(move(label, homeTasks[0].id, "up")).toEqual({ status: "moved", selectedTaskId: homeTasks[0].id });
      expect(move(label, homeTasks[0].id, "up")).toEqual({ status: "moved", selectedTaskId: homeTasks[0].id });
      const sharedView: TaskView = { kind: "label", labelId: shared.id };
      expect(sections(sharedView)[0].items.map((item) => item.id)).toEqual([homeTasks[0].id, workTasks[0].id]);
      expect(move(all, noProject[1].id, "up").status).toBe("moved");
      expect(groupIds()[0]).toEqual([noProject[1].id, noProject[0].id]);
      expect(sections(all).map((section) => [section.key, section.title])).toEqual(headings);
      expect([...workTasks, ...homeTasks, ...noProject].map((task) => session.service.getTask(task.id))).toEqual([
        ...workTasks,
        ...homeTasks,
        ...noProject,
      ]);
      session.service.completeTask(workTasks[0].id);
      session.service.completeTask(workTasks[1].id);
      expect(sections({ kind: "completed" })[0].items.map((item) => item.id)).toEqual(workTasks.map((task) => task.id));
      session.service.trashTask(workTasks[0].id);
      session.service.trashTask(workTasks[1].id);
      expect(sections({ kind: "trash" })[0].items.map((item) => item.id)).toEqual(workTasks.map((task) => task.id));
    } finally {
      session.close();
    }
  });

  it("keeps This week date boundaries and headings while updating every menu-bar group", async () => {
    const { session, sections, menu } = await openContext();
    try {
      const dates = ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"];
      const groups = dates.map((date, index) => [
        session.service.createTask({ title: `First ${date}`, due: { ...due, date }, priority: index === 4 }),
        session.service.createTask({ title: `Second ${date}`, due: { ...due, date }, priority: index === 3 }),
      ]);
      const view: TaskView = { kind: "thisWeek" };
      const headings = sections(view).map((section) => [section.key, section.title]);
      const selected: string[] = [];
      const move = (taskId: string, direction: "up" | "down") =>
        reorderTaskInView(session.service, taskId, direction, { ...context, view }, (id) => selected.push(id));
      for (const [first, second] of groups) {
        expect(move(first.id, "up")).toEqual({ status: "unchanged" });
        expect(move(second.id, "up")).toEqual({ status: "moved", selectedTaskId: second.id });
        expect(move(second.id, "up")).toEqual({ status: "unchanged" });
        expect(move(first.id, "down")).toEqual({ status: "unchanged" });
      }
      expect(selected).toEqual(groups.map((tasks) => tasks[1].id));
      expect(sections(view).map((section) => [section.key, section.title])).toEqual(headings);
      expect(sections(view).map((section) => section.items.map((item) => item.id))).toEqual(
        groups.map(([first, second]) => [second.id, first.id]),
      );
      expect(menu().count).toBe(4);
      expect(menu().allTasksCount).toBe(10);
      expect(menu().sections.map((section) => [section.key, section.tasks.map((task) => task.id)])).toEqual([
        ["priority", [groups[3][1].id, groups[4][0].id]],
        ["overdue", [groups[0][1].id, groups[0][0].id]],
        ["today", [groups[1][1].id, groups[1][0].id]],
        ["tomorrow", [groups[2][1].id, groups[2][0].id]],
        ["laterThisWeek", [groups[3][0].id, groups[4][1].id]],
      ]);
      for (const task of groups.flat()) {
        expect(session.service.getTask(task.id)).toEqual(task);
      }
    } finally {
      session.close();
    }
  });
});
