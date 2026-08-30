import { describe, expect, it } from "vitest";
import type { Priority, Task } from "../../src/shared/domain/model";
import type { TodayResult } from "../../src/shared/domain/queries";
import { buildMenuBarModel, resolveMenuBarVisibility } from "../../src/shared/presentation/menu-bar";
import { parseMyTasksLaunchContext } from "../../src/shared/presentation/task-launch";

function task(id: string, title: string, priority: Priority): Task {
  return {
    id,
    title,
    notes: "",
    priority,
    position: 1_024,
    projectId: null,
    sectionId: null,
    due: { kind: "allDay", date: "2026-08-30" },
    createdAtMs: 1_000,
    updatedAtMs: 1_000,
    completedAtMs: null,
    trashedAtMs: null,
  };
}

function todayResult(tasks: TodayResult["tasks"]): TodayResult {
  return {
    tasks,
    count: tasks.length,
    localDate: "2026-08-30",
    startOfDayMs: 1_000,
    startOfNextDayMs: 2_000,
  };
}

describe("menu-bar presentation", () => {
  it("groups overdue before today while preserving query order and priorities", () => {
    const overdueHigh = task("1", "Submit report", "high");
    const overdueLow = task("2", "Book appointment", "low");
    const dueToday = task("3", "Buy groceries", "none");

    expect(
      buildMenuBarModel(
        todayResult([
          { task: overdueHigh, status: "overdue", effectiveDueAtMs: 1_000 },
          { task: overdueLow, status: "overdue", effectiveDueAtMs: 1_100 },
          { task: dueToday, status: "dueToday", effectiveDueAtMs: 1_200 },
        ]),
      ),
    ).toEqual({
      count: 3,
      title: "3",
      sections: [
        {
          key: "overdue",
          title: "Overdue",
          tasks: [
            { id: "1", title: "Submit report", priority: "high" },
            { id: "2", title: "Book appointment", priority: "low" },
          ],
        },
        {
          key: "today",
          title: "Today",
          tasks: [{ id: "3", title: "Buy groceries", priority: "none" }],
        },
      ],
    });
  });

  it("hides the menu title and task sections when nothing is due", () => {
    expect(buildMenuBarModel(todayResult([]))).toEqual({ count: 0, title: undefined, sections: [] });
  });

  it("accepts only supported My Tasks launch context values", () => {
    expect(parseMyTasksLaunchContext({ view: "upcoming", selectedTaskId: "task-1", createTask: true })).toEqual({
      view: "upcoming",
      selectedTaskId: "task-1",
      createTask: true,
    });
    expect(parseMyTasksLaunchContext({ view: "project", selectedTaskId: "", createTask: "yes" })).toEqual({
      view: "today",
      selectedTaskId: undefined,
      createTask: false,
    });
    expect(parseMyTasksLaunchContext(null)).toEqual({
      view: "today",
      selectedTaskId: undefined,
      createTask: false,
    });
  });

  it("keeps a stored hidden state during background refresh", () => {
    expect(resolveMenuBarVisibility(true, false)).toEqual({ hidden: true, clearStoredHidden: false });
  });

  it("restores a hidden item when the user launches the command", () => {
    expect(resolveMenuBarVisibility(true, true)).toEqual({ hidden: false, clearStoredHidden: true });
    expect(resolveMenuBarVisibility(false, true)).toEqual({ hidden: false, clearStoredHidden: false });
  });
});
