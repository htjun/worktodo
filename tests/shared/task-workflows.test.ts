import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompletionFeedbackController } from "../../src/shared/application/completion-feedback";
import { createQuickTask, moveTaskFromForm, saveTaskFromForm } from "../../src/shared/application/task-workflows";
import {
  performTimedTaskHistoryOperation,
  TimedTaskHistoryController,
} from "../../src/shared/application/timed-task-history";
import { openWorktodoAtPath } from "../../src/shared/application/worktodo";
import {
  initialPlacementForTaskView,
  lifecycleActionForTaskView,
  loadTaskViewSections,
  normalizeTaskView,
  taskViewContent,
  taskViewFromKey,
  taskViewKey,
  type TaskView,
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
      expect(loadTaskViewSections(session, { kind: "today" }, viewerTimeZone, evaluationInstantMs)[0].items).toEqual([
        expect.objectContaining({ id: quickTask.id }),
      ]);

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
      expect(loadTaskViewSections(session, { kind: "inbox" }, viewerTimeZone, evaluationInstantMs)[0].items).toEqual(
        [],
      );
      expect(
        loadTaskViewSections(
          session,
          { kind: "section", projectId: project.id, sectionId: section.id },
          viewerTimeZone,
          evaluationInstantMs,
        )[0].items.map((item) => item.id),
      ).toEqual([quickTask.id]);
      expect(loadTaskViewSections(session, { kind: "upcoming" }, viewerTimeZone, evaluationInstantMs)).toMatchObject([
        { key: "upcoming:2026-09-01", title: "Tomorrow", items: [{ id: quickTask.id }] },
      ]);

      const acknowledgementSizes: number[] = [];
      const completion = new CompletionFeedbackController((tasks) => acknowledgementSizes.push(tasks.size));
      const historyStates: Array<string | null> = [];
      const history = new TimedTaskHistoryController((state) => historyStates.push(state?.direction ?? null));
      const menuRefresh = vi.fn();
      const listRefresh = vi.fn();
      now = 4_000;
      const completed = completion.complete(
        quickTask.id,
        () => session.service.completeTask(quickTask.id),
        menuRefresh,
        listRefresh,
      );
      expect(completed.status).toBe("acknowledged");
      expect(
        completion.complete(quickTask.id, () => session.service.completeTask(quickTask.id), menuRefresh, listRefresh)
          .status,
      ).toBe("duplicate");
      const completeHistory = history.record({
        kind: "complete",
        taskId: quickTask.id,
        taskTitle: completed.task.title,
      });
      expect(session.service.listCompleted().map((task) => task.id)).toEqual([quickTask.id]);
      expect(menuRefresh).toHaveBeenCalledOnce();

      vi.advanceTimersByTime(1_000);
      expect(acknowledgementSizes).toEqual([1, 0]);
      expect(listRefresh).toHaveBeenCalledOnce();

      now = 5_000;
      const undone = history.perform(completeHistory, () =>
        performTimedTaskHistoryOperation(completeHistory, {
          complete: () => session.service.completeTask(quickTask.id),
          reopen: () => session.service.reopenTask(quickTask.id),
          trash: () => session.service.trashTask(quickTask.id),
          restore: () => session.service.restoreTask(quickTask.id),
        }),
      );
      expect(undone).toMatchObject({ status: "performed", state: { direction: "redo" } });
      expect(session.service.getTask(quickTask.id).completedAtMs).toBeNull();

      now = 6_000;
      const redone =
        undone.status === "performed"
          ? history.perform(undone.state, () =>
              performTimedTaskHistoryOperation(undone.state, {
                complete: () => session.service.completeTask(quickTask.id),
                reopen: () => session.service.reopenTask(quickTask.id),
                trash: () => session.service.trashTask(quickTask.id),
                restore: () => session.service.restoreTask(quickTask.id),
              }),
            )
          : undone;
      expect(redone).toMatchObject({ status: "performed", state: { direction: "undo" } });
      expect(session.service.getTask(quickTask.id).completedAtMs).toBe(6_000);

      now = 7_000;
      const trashed = session.service.trashTask(quickTask.id);
      const trashHistory = history.record({ kind: "trash", taskId: trashed.id, taskTitle: trashed.title });
      expect(loadTaskViewSections(session, { kind: "trash" }, viewerTimeZone, evaluationInstantMs)[0].items).toEqual([
        expect.objectContaining({ id: quickTask.id }),
      ]);
      now = 8_000;
      expect(
        history.perform(trashHistory, () =>
          performTimedTaskHistoryOperation(trashHistory, {
            complete: () => session.service.completeTask(quickTask.id),
            reopen: () => session.service.reopenTask(quickTask.id),
            trash: () => session.service.trashTask(quickTask.id),
            restore: () => session.service.restoreTask(quickTask.id),
          }),
        ),
      ).toMatchObject({ status: "performed", state: { direction: "redo" } });
      expect(session.service.getTask(quickTask.id)).toMatchObject({ completedAtMs: 6_000, trashedAtMs: null });
      expect(historyStates).toEqual(["undo", "redo", "undo", "undo", "redo"]);
      expect(events).toEqual(["quick session closed", "menu refreshed", "task saved", "task moved"]);
      history.dispose();
      completion.dispose();
    } finally {
      session.close();
    }
  });

  it("loads every view and normalizes deleted containers without Raycast values", async () => {
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
        loadTaskViewSections(session, view, viewerTimeZone, evaluationInstantMs).flatMap((group) =>
          group.items.map((item) => item.id),
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
      expect(initialPlacementForTaskView({ kind: "section", projectId: project.id, sectionId: section.id })).toEqual({
        kind: "section",
        projectId: project.id,
        sectionId: section.id,
      });
      expect(
        taskViewContent({ kind: "section", projectId: project.id, sectionId: section.id }, [project], [section]),
      ).toMatchObject({ title: "Work / Next", searchPlaceholder: "Search Next" });
      expect(lifecycleActionForTaskView({ kind: "completed" }, session.service, today.id)).toMatchObject({
        kind: "reopen",
        title: "Reopen Task",
      });
      expect(lifecycleActionForTaskView({ kind: "trash" }, session.service, inbox.id)).toMatchObject({
        kind: "restore",
        title: "Restore Task",
      });
    } finally {
      session.close();
    }
  });
});
