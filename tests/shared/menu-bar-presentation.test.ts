import { describe, expect, it } from "vitest";
import type { Priority, Project, Task } from "../../src/shared/domain/model";
import type { TodayResult, UpcomingResult } from "../../src/shared/domain/queries";
import {
  buildMenuBarModel,
  buildMenuBarTaskHistoryItem,
  menuBarTaskTitle,
  resolveMenuBarLaunchAction,
  resolveMenuBarVisibility,
} from "../../src/shared/presentation/menu-bar";
import { parseMyTasksLaunchContext } from "../../src/shared/presentation/task-launch";

function task(id: string, title: string, priority: Priority, projectId: string | null = null): Task {
  return {
    id,
    title,
    notes: "",
    priority,
    position: 1_024,
    projectId,
    sectionId: null,
    due: { kind: "allDay", date: "2026-08-30" },
    createdAtMs: 1_000,
    updatedAtMs: 1_000,
    completedAtMs: null,
    trashedAtMs: null,
  };
}

function todayResult(tasks: TodayResult["tasks"], localDate = "2026-08-31"): TodayResult {
  return {
    tasks,
    count: tasks.length,
    localDate,
    startOfDayMs: 1_000,
    startOfNextDayMs: 2_000,
  };
}

function upcomingResult(tasks: UpcomingResult["tasks"], localDate = "2026-08-31"): UpcomingResult {
  return {
    tasks,
    count: tasks.length,
    localDate,
    startOfDayMs: 1_000,
    startOfNextDayMs: 2_000,
  };
}

function project(id: string, name: string): Project {
  return { id, name, position: 1_024, createdAtMs: 1_000, updatedAtMs: 1_000 };
}

describe("menu-bar presentation", () => {
  it("groups tasks through Sunday and preserves query order, priorities, and project names", () => {
    const work = project("project-1", "Work");
    const overdueHigh = task("1", "Submit report", "high", work.id);
    const overdueLow = task("2", "Book appointment", "low");
    const dueToday = task("3", "Buy groceries", "none");
    const dueTomorrow = task("4", "Review proposal", "medium", work.id);
    const dueFriday = task("5", "Plan launch", "high", work.id);
    const dueNextWeek = task("6", "Write follow-up", "none");

    expect(
      buildMenuBarModel(
        todayResult([
          { task: overdueHigh, status: "overdue", effectiveDueAtMs: 1_000 },
          { task: overdueLow, status: "overdue", effectiveDueAtMs: 1_100 },
          { task: dueToday, status: "dueToday", effectiveDueAtMs: 1_200 },
        ]),
        upcomingResult([
          { task: dueTomorrow, localDate: "2026-09-01", effectiveDueAtMs: 2_000 },
          { task: dueFriday, localDate: "2026-09-04", effectiveDueAtMs: 3_000 },
          { task: dueNextWeek, localDate: "2026-09-07", effectiveDueAtMs: 4_000 },
        ]),
        [work],
      ),
    ).toEqual({
      count: 3,
      title: "3",
      sections: [
        {
          key: "overdue",
          title: "Overdue",
          tasks: [
            {
              id: "1",
              title: "Submit report",
              priority: "high",
              projectName: "Work",
              view: "today",
            },
            {
              id: "2",
              title: "Book appointment",
              priority: "low",
              projectName: null,
              view: "today",
            },
          ],
        },
        {
          key: "today",
          title: "Today",
          tasks: [
            {
              id: "3",
              title: "Buy groceries",
              priority: "none",
              projectName: null,
              view: "today",
            },
          ],
        },
        {
          key: "tomorrow",
          title: "Tomorrow",
          tasks: [
            {
              id: "4",
              title: "Review proposal",
              priority: "medium",
              projectName: "Work",
              view: "upcoming",
            },
          ],
        },
        {
          key: "laterThisWeek",
          title: "Later This Week",
          tasks: [
            {
              id: "5",
              title: "Plan launch",
              priority: "high",
              projectName: "Work",
              view: "upcoming",
            },
          ],
        },
      ],
    });
  });

  it("hides the menu title and task sections when nothing is due", () => {
    expect(buildMenuBarModel(todayResult([]), upcomingResult([]), [])).toEqual({
      count: 0,
      title: undefined,
      sections: [],
    });
  });

  it("does not include upcoming tasks in the menu title count", () => {
    const tomorrow = task("1", "Review proposal", "medium");

    expect(
      buildMenuBarModel(
        todayResult([]),
        upcomingResult([{ task: tomorrow, localDate: "2026-09-01", effectiveDueAtMs: 2_000 }]),
        [],
      ),
    ).toEqual({
      count: 0,
      title: undefined,
      sections: [
        {
          key: "tomorrow",
          title: "Tomorrow",
          tasks: [
            {
              id: "1",
              title: "Review proposal",
              priority: "medium",
              projectName: null,
              view: "upcoming",
            },
          ],
        },
      ],
    });
  });

  it("shows the project as a compact suffix while leaving Inbox task titles unchanged", () => {
    const baseTask = {
      id: "task-1",
      title: "Submit report",
      priority: "high" as const,
      view: "today" as const,
    };
    expect(menuBarTaskTitle({ ...baseTask, projectName: "Work" })).toBe("Submit report · Work");
    expect(menuBarTaskTitle({ ...baseTask, projectName: null })).toBe("Submit report");
  });

  it("accepts only supported My Tasks launch context values", () => {
    expect(parseMyTasksLaunchContext({ view: "all" })).toEqual({
      view: "all",
      selectedTaskId: undefined,
      createTask: false,
      isShowingDetail: false,
    });
    expect(parseMyTasksLaunchContext({ view: "upcoming", selectedTaskId: "task-1", createTask: true })).toEqual({
      view: "upcoming",
      selectedTaskId: "task-1",
      createTask: true,
      isShowingDetail: true,
    });
    expect(parseMyTasksLaunchContext({ view: "project", selectedTaskId: "", createTask: "yes" })).toEqual({
      view: "all",
      selectedTaskId: undefined,
      createTask: false,
      isShowingDetail: false,
    });
    expect(parseMyTasksLaunchContext(null)).toEqual({
      view: "all",
      selectedTaskId: undefined,
      createTask: false,
      isShowingDetail: false,
    });
  });

  it("keeps a stored hidden state during background refresh", () => {
    expect(resolveMenuBarVisibility(true, false)).toEqual({ hidden: true, clearStoredHidden: false });
  });

  it("restores a hidden item when the user launches the command", () => {
    expect(resolveMenuBarVisibility(true, true)).toEqual({ hidden: false, clearStoredHidden: true });
    expect(resolveMenuBarVisibility(false, true)).toEqual({ hidden: false, clearStoredHidden: false });
  });

  it("accepts menu actions only once in a user-initiated launch", () => {
    expect(resolveMenuBarLaunchAction({ action: "complete-task", taskId: "task-1" }, true, false)).toEqual({
      action: "complete-task",
      taskId: "task-1",
    });
    expect(resolveMenuBarLaunchAction({ action: "hide-menu-bar" }, true, false)).toEqual({
      action: "hide-menu-bar",
    });
    expect(resolveMenuBarLaunchAction({ action: "complete-task", taskId: "task-1" }, false, false)).toBeNull();
    expect(resolveMenuBarLaunchAction({ action: "complete-task", taskId: "task-1" }, true, true)).toBeNull();
  });

  it("rejects malformed menu action launch contexts", () => {
    expect(resolveMenuBarLaunchAction(null, true, false)).toBeNull();
    expect(resolveMenuBarLaunchAction({ action: "complete-task", taskId: "  " }, true, false)).toBeNull();
    expect(resolveMenuBarLaunchAction({ action: "complete-task" }, true, false)).toBeNull();
    expect(resolveMenuBarLaunchAction({ action: "archive-task", taskId: "task-1" }, true, false)).toBeNull();
  });

  it("presents the current menu-bar Undo or Redo with its task title", () => {
    expect(
      buildMenuBarTaskHistoryItem({
        direction: "undo",
        kind: "complete",
        taskId: "task-1",
        taskTitle: "Submit report",
      }),
    ).toEqual({ direction: "undo", title: "Undo Complete Task", subtitle: "Submit report" });
    expect(
      buildMenuBarTaskHistoryItem({
        direction: "redo",
        kind: "complete",
        taskId: "task-1",
        taskTitle: "Submit report",
      }),
    ).toEqual({ direction: "redo", title: "Redo Complete Task", subtitle: "Submit report" });
  });
});
