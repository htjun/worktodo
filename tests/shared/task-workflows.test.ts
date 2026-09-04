import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DELAYED_COMPLETION_POLICY,
  TaskLifecycleInteraction,
} from "../../src/shared/application/task-lifecycle-interaction";
import {
  loadTaskView,
  normalizeTaskView,
  resolveTaskView,
  tasksInTaskView,
  type TaskView,
} from "../../src/shared/application/task-views";
import { createQuickTask, moveTaskFromForm, saveTaskFromForm } from "../../src/shared/application/task-workflows";
import { openWorktodoAtPath } from "../../src/shared/application/worktodo";
import {
  buildTaskViewSections,
  initialPlacementForTaskView,
  taskViewContent,
  taskViewFromKey,
  taskViewKey,
} from "../../src/shared/presentation/task-views";

const temporaryDirectories: string[] = [];
const viewerTimeZone = "Australia/Melbourne";
const evaluationInstantMs = Date.parse("2026-08-31T02:00:00.000Z");

function id(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("main task workflows", () => {
  it("runs Quick Add through completion, undo, redo, trash, and restore against one real store", async () => {
    vi.useFakeTimers();
    const directory = await mkdtemp(join(tmpdir(), "worktodo-task-workflow-test-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "worktodo.sqlite");
    let nextId = 1;
    let now = 1_000;
    const options = {
      createId: () => id(nextId++),
      now: () => now,
      recoveryDirectory: join(directory, "recovery"),
    };
    const session = openWorktodoAtPath(databasePath, options);

    try {
      const project = session.service.createProject("Work");
      const section = session.service.createSection(project.id, "Next");
      const buildSections = (view: TaskView) =>
        buildTaskViewSections(
          loadTaskView(session.service, view, { evaluationInstantMs, viewerTimeZone }),
          session.service.listProjects(),
          session.service.listSections(),
        );
      const events: string[] = [];
      let quickSessionCloseCount = 0;
      const quickTask = createQuickTask(
        () => {
          const quickSession = openWorktodoAtPath(databasePath, options);
          return {
            service: quickSession.service,
            close: () => {
              quickSession.close();
              quickSessionCloseCount += 1;
              events.push("quick session closed");
            },
          };
        },
        {
          title: "Refactor safely",
          notes: "Protect the user workflow",
          dueDatePreset: "today",
          customDueAtMs: null,
          referenceInstantMs: evaluationInstantMs,
          viewerTimeZone,
        },
        { selectedPlacement: "inbox", projects: [project], sections: [section] },
        () => events.push("menu refreshed"),
      );

      expect(events).toEqual(["quick session closed", "menu refreshed"]);
      expect(quickSessionCloseCount).toBe(1);
      expect(session.service.getTask(quickTask.id)).toMatchObject({
        notes: "Protect the user workflow",
        priority: "none",
        projectId: null,
        due: { kind: "allDay", date: "2026-08-31" },
      });
      expect(buildSections({ kind: "today" })[0].items).toEqual([expect.objectContaining({ id: quickTask.id })]);

      now = 2_000;
      const saved = saveTaskFromForm(
        session.service,
        quickTask,
        {
          title: "Refactor Worktodo safely",
          notes: "Keep behavior stable",
          priority: "high",
          dueDatePreset: "tomorrow",
          customDueAtMs: null,
          referenceInstantMs: evaluationInstantMs,
          viewerTimeZone,
        },
        { selectedPlacement: "inbox", projects: [project], sections: [section] },
        () => events.push("task saved"),
      );
      now = 3_000;
      const moved = moveTaskFromForm(
        session.service,
        saved.id,
        { selectedPlacement: `section:${section.id}`, projects: [project], sections: [section] },
        () => events.push("task moved"),
      );
      expect(moved).toMatchObject({
        title: "Refactor Worktodo safely",
        notes: "Keep behavior stable",
        priority: "high",
        projectId: project.id,
        sectionId: section.id,
        due: { kind: "allDay", date: "2026-09-01" },
      });
      expect(buildSections({ kind: "inbox" })[0].items).toEqual([]);
      expect(
        buildSections({ kind: "section", projectId: project.id, sectionId: section.id })[0].items.map(
          (item) => item.id,
        ),
      ).toEqual([quickTask.id]);
      expect(buildSections({ kind: "upcoming" })).toMatchObject([
        { key: "upcoming:2026-09-01", title: "Tomorrow", items: [{ id: quickTask.id }] },
      ]);

      const acknowledgementSizes: number[] = [];
      const historyStates: Array<string | null> = [];
      const menuRefresh = vi.fn();
      const listRefresh = vi.fn();
      const lifecycle = new TaskLifecycleInteraction({
        mutations: session.service,
        policy: DELAYED_COMPLETION_POLICY,
        refresh: { refreshView: listRefresh, refreshRelated: menuRefresh },
        onAcknowledgementsChanged: (tasks) => acknowledgementSizes.push(tasks.size),
        onHistoryChanged: (state) => historyStates.push(state?.direction ?? null),
      });
      now = 4_000;
      const completed = lifecycle.runMutation("complete", quickTask.id);
      expect(completed.status).toBe("succeeded");
      expect(lifecycle.runMutation("complete", quickTask.id).status).toBe("duplicate");
      if (completed.status !== "succeeded" || !completed.history) {
        throw new Error("Expected completed lifecycle action");
      }
      expect(session.service.listCompleted().map((task) => task.id)).toEqual([quickTask.id]);
      expect(menuRefresh).toHaveBeenCalledOnce();

      vi.advanceTimersByTime(1_000);
      expect(acknowledgementSizes).toEqual([1, 0]);
      expect(listRefresh).toHaveBeenCalledOnce();

      now = 5_000;
      const undone = lifecycle.runHistory(completed.history);
      expect(undone).toMatchObject({ status: "succeeded", history: { direction: "redo" } });
      expect(session.service.getTask(quickTask.id).completedAtMs).toBeNull();

      now = 6_000;
      const redone = undone.status === "succeeded" && undone.history ? lifecycle.runHistory(undone.history) : undone;
      expect(redone).toMatchObject({ status: "succeeded", history: { direction: "undo" } });
      expect(session.service.getTask(quickTask.id).completedAtMs).toBe(6_000);

      now = 7_000;
      const trashed = lifecycle.runMutation("trash", quickTask.id);
      if (trashed.status !== "succeeded" || !trashed.history) {
        throw new Error("Expected trashed lifecycle action");
      }
      expect(buildSections({ kind: "trash" })[0].items).toEqual([expect.objectContaining({ id: quickTask.id })]);
      now = 8_000;
      expect(lifecycle.runHistory(trashed.history)).toMatchObject({
        status: "succeeded",
        history: { direction: "redo" },
      });
      expect(session.service.getTask(quickTask.id)).toMatchObject({ completedAtMs: 6_000, trashedAtMs: null });
      expect(historyStates).toEqual(["undo", "redo", "undo", "undo", "redo"]);
      expect(events).toEqual(["quick session closed", "menu refreshed", "task saved", "task moved"]);
      lifecycle.dispose();
    } finally {
      session.close();
    }
  });

  it("loads every canonical view and normalizes deleted containers without adapter values", async () => {
    const directory = await mkdtemp(join(tmpdir(), "worktodo-task-view-test-"));
    temporaryDirectories.push(directory);
    let nextId = 1;
    const session = openWorktodoAtPath(join(directory, "worktodo.sqlite"), {
      createId: () => id(nextId++),
      now: () => 1_000,
      recoveryDirectory: join(directory, "recovery"),
    });
    try {
      const project = session.service.createProject("Work");
      const section = session.service.createSection(project.id, "Next");
      const inbox = session.service.createTask({ title: "Inbox", placement: { kind: "inbox" } });
      const today = session.service.createTask({
        title: "Today",
        placement: { kind: "project", projectId: project.id },
        due: { kind: "allDay", date: "2026-08-31" },
      });
      const upcoming = session.service.createTask({
        title: "Tomorrow",
        placement: { kind: "section", projectId: project.id, sectionId: section.id },
        due: { kind: "allDay", date: "2026-09-01" },
      });
      session.service.completeTask(today.id);
      session.service.trashTask(inbox.id);

      const views: TaskView[] = [
        { kind: "all" },
        { kind: "today" },
        { kind: "upcoming" },
        { kind: "inbox" },
        { kind: "completed" },
        { kind: "trash" },
        { kind: "project", projectId: project.id },
        { kind: "section", projectId: project.id, sectionId: section.id },
      ];
      const idsFor = (view: TaskView) =>
        tasksInTaskView(loadTaskView(session.service, view, { evaluationInstantMs, viewerTimeZone })).map(
          (task) => task.id,
        );

      expect(views.map((view) => [taskViewKey(view), idsFor(view)])).toEqual([
        ["all", [upcoming.id]],
        ["today", []],
        ["upcoming", [upcoming.id]],
        ["inbox", []],
        ["completed", [today.id]],
        ["trash", [inbox.id]],
        [`project:${project.id}`, [upcoming.id]],
        [`section:${section.id}`, [upcoming.id]],
      ]);
      expect(taskViewFromKey(`section:${section.id}`, [project], [section])).toEqual({
        kind: "section",
        projectId: project.id,
        sectionId: section.id,
      });
      expect(
        normalizeTaskView({ kind: "section", projectId: project.id, sectionId: section.id }, [project], []),
      ).toEqual({ kind: "project", projectId: project.id });
      expect(normalizeTaskView({ kind: "project", projectId: project.id }, [], [])).toEqual({ kind: "all" });
      expect(
        normalizeTaskView({ kind: "section", projectId: id(999), sectionId: section.id }, [project], [section]),
      ).toEqual({ kind: "section", projectId: project.id, sectionId: section.id });
      expect(initialPlacementForTaskView({ kind: "section", projectId: project.id, sectionId: section.id })).toEqual({
        kind: "section",
        projectId: project.id,
        sectionId: section.id,
      });
      expect(
        taskViewContent({ kind: "section", projectId: project.id, sectionId: section.id }, [project], [section]),
      ).toMatchObject({ title: "Work / Next", searchPlaceholder: "Search Next" });
    } finally {
      session.close();
    }
  });

  it("preserves Today status, Upcoming local date, and canonical input validation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "worktodo-task-view-context-test-"));
    temporaryDirectories.push(directory);
    let nextId = 1;
    const session = openWorktodoAtPath(join(directory, "worktodo.sqlite"), {
      createId: () => id(nextId++),
      now: () => 1_000,
      recoveryDirectory: join(directory, "recovery"),
    });
    try {
      const project = session.service.createProject("Work");
      const section = session.service.createSection(project.id, "Next");
      const overdue = session.service.createTask({
        title: "Overdue",
        placement: { kind: "inbox" },
        due: { kind: "allDay", date: "2026-08-30" },
      });
      const today = session.service.createTask({
        title: "Today",
        placement: { kind: "project", projectId: project.id },
        due: { kind: "allDay", date: "2026-08-31" },
      });
      const upcoming = session.service.createTask({
        title: "Tomorrow",
        placement: { kind: "section", projectId: project.id, sectionId: section.id },
        due: { kind: "allDay", date: "2026-09-01" },
      });
      const context = { evaluationInstantMs, viewerTimeZone: "Australia/Victoria" };

      const todayView = loadTaskView(session.service, { kind: "today" }, context);
      expect(todayView).toMatchObject({
        evaluatedAtMs: evaluationInstantMs,
        viewerTimeZone,
        result: {
          tasks: [
            { task: { id: overdue.id }, status: "overdue" },
            { task: { id: today.id }, status: "dueToday" },
          ],
        },
      });
      const upcomingView = loadTaskView(session.service, { kind: "upcoming" }, context);
      expect(upcomingView).toMatchObject({
        viewerTimeZone,
        result: { tasks: [{ task: { id: upcoming.id }, localDate: "2026-09-01" }] },
      });

      const boundaryInstantMs = Date.parse("2026-08-31T14:30:00.000Z");
      const utcToday = loadTaskView(
        session.service,
        { kind: "today" },
        {
          evaluationInstantMs: boundaryInstantMs,
          viewerTimeZone: "UTC",
        },
      );
      const melbourneToday = loadTaskView(
        session.service,
        { kind: "today" },
        {
          evaluationInstantMs: boundaryInstantMs,
          viewerTimeZone,
        },
      );
      expect(utcToday.result.tasks.find((entry) => entry.task.id === today.id)?.status).toBe("dueToday");
      expect(melbourneToday.result.tasks.find((entry) => entry.task.id === today.id)?.status).toBe("overdue");
      expect(melbourneToday.result.tasks.find((entry) => entry.task.id === upcoming.id)?.status).toBe("dueToday");

      expect(resolveTaskView(session.service, "project", project.id, undefined)).toEqual({
        kind: "project",
        projectId: project.id,
      });
      expect(resolveTaskView(session.service, "section", undefined, section.id)).toEqual({
        kind: "section",
        projectId: project.id,
        sectionId: section.id,
      });
      expect(() => resolveTaskView(session.service, "project", undefined, undefined)).toThrow(
        "The project view requires only projectId",
      );
      expect(() => resolveTaskView(session.service, "section", undefined, id(999))).toThrow("Section not found");
      expect(() => resolveTaskView(session.service, "inbox", project.id, undefined)).toThrow(
        "projectId and sectionId are valid only for their matching views",
      );
      expect(() => loadTaskView(session.service, { kind: "inbox" }, { ...context, evaluationInstantMs: -1 })).toThrow(
        "Evaluation instant must be a non-negative safe integer",
      );
    } finally {
      session.close();
    }
  });
});
