import { describe, expect, it } from "vitest";
import type { Priority, Project, Task } from "../../src/shared/domain/model";
import type { TodayResult, UpcomingResult } from "../../src/shared/domain/queries";
import {
  buildMenuBarModel,
  buildMenuBarTaskHistoryItem,
  menuBarTaskTitle,
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

  it("keeps task labels at the limit and truncates labels that exceed it", () => {
    const baseTask = {
      id: "task-1",
      priority: "high" as const,
      projectName: null,
      view: "today" as const,
    };
    const exactTitle = "a".repeat(72);

    expect(menuBarTaskTitle({ ...baseTask, title: exactTitle })).toBe(exactTitle);
    expect(menuBarTaskTitle({ ...baseTask, title: `${exactTitle}a` })).toBe(`${"a".repeat(71)}…`);
  });

  it("truncates a long task title while preserving its project suffix", () => {
    expect(
      menuBarTaskTitle({
        id: "task-1",
        title: "a".repeat(100),
        priority: "high",
        projectName: "Work",
        view: "today",
      }),
    ).toBe(`${"a".repeat(64)}… · Work`);
  });

  it("caps long task and project names within the combined label limit", () => {
    expect(
      menuBarTaskTitle({
        id: "task-1",
        title: "a".repeat(100),
        priority: "high",
        projectName: "p".repeat(30),
        view: "today",
      }),
    ).toBe(`${"a".repeat(44)}… · ${"p".repeat(23)}…`);
  });

  it("does not split composed emoji when truncating task labels", () => {
    const family = "👨‍👩‍👧‍👦";

    expect(
      menuBarTaskTitle({
        id: "task-1",
        title: family.repeat(73),
        priority: "high",
        projectName: null,
        view: "today",
      }),
    ).toBe(`${family.repeat(71)}…`);
  });

  it("accepts only supported All Tasks launch context values", () => {
    expect(parseMyTasksLaunchContext({ view: "all" })).toEqual({
      view: "all",
      selectedTaskId: undefined,
      createTask: false,
      editTask: false,
      isShowingDetail: false,
    });
    expect(parseMyTasksLaunchContext({ view: "upcoming", selectedTaskId: "task-1", createTask: true })).toEqual({
      view: "upcoming",
      selectedTaskId: "task-1",
      createTask: true,
      editTask: false,
      isShowingDetail: true,
    });
    expect(
      parseMyTasksLaunchContext({ view: "project", selectedTaskId: "", createTask: "yes", editTask: "yes" }),
    ).toEqual({
      view: "all",
      selectedTaskId: undefined,
      createTask: false,
      editTask: false,
      isShowingDetail: false,
    });
    expect(parseMyTasksLaunchContext(null)).toEqual({
      view: "all",
      selectedTaskId: undefined,
      createTask: false,
      editTask: false,
      isShowingDetail: false,
    });
  });

  it("accepts edit intent only with a selected task and without create intent", () => {
    expect(parseMyTasksLaunchContext({ view: "today", selectedTaskId: "task-1", editTask: true })).toEqual({
      view: "today",
      selectedTaskId: "task-1",
      createTask: false,
      editTask: true,
      isShowingDetail: true,
    });
    expect(parseMyTasksLaunchContext({ view: "today", editTask: true })).toMatchObject({ editTask: false });
    expect(parseMyTasksLaunchContext({ selectedTaskId: "task-1", createTask: true, editTask: true })).toMatchObject({
      createTask: true,
      editTask: false,
    });
  });

  it("keeps a stored hidden state during background refresh", () => {
    expect(resolveMenuBarVisibility(true, false)).toEqual({ hidden: true, clearStoredHidden: false });
  });

  it("restores a hidden item when the user launches the command", () => {
    expect(resolveMenuBarVisibility(true, true)).toEqual({ hidden: false, clearStoredHidden: true });
    expect(resolveMenuBarVisibility(false, true)).toEqual({ hidden: false, clearStoredHidden: false });
  });

  it("presents the current menu-bar Undo or Redo with its task title", () => {
    expect(
      buildMenuBarTaskHistoryItem({
        direction: "undo",
        kind: "complete",
        taskId: "task-1",
        taskTitle: "Submit report",
      }),
    ).toEqual({ direction: "undo", title: "Undo Completion", subtitle: "Submit report" });
    expect(
      buildMenuBarTaskHistoryItem({
        direction: "redo",
        kind: "complete",
        taskId: "task-1",
        taskTitle: "Submit report",
      }),
    ).toEqual({ direction: "redo", title: "Redo Completion", subtitle: "Submit report" });
  });

  it("truncates a long Undo or Redo task title within the menu label budget", () => {
    expect(
      buildMenuBarTaskHistoryItem({
        direction: "undo",
        kind: "trash",
        taskId: "task-1",
        taskTitle: "a".repeat(100),
      }),
    ).toEqual({
      direction: "undo",
      title: "Undo Move to Trash",
      subtitle: `${"a".repeat(52)}…`,
    });
  });
});
