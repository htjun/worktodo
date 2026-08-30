import type { Priority } from "../domain/model";
import type { TodayResult } from "../domain/queries";
import type { TimedTaskHistoryState } from "../application/timed-task-history";
import { timedTaskHistoryPresentation } from "./task-history";

export type MenuBarTask = {
  id: string;
  title: string;
  priority: Priority;
};

export type MenuBarTaskSection = {
  key: "overdue" | "today";
  title: "Overdue" | "Today";
  tasks: MenuBarTask[];
};

export type MenuBarModel = {
  count: number;
  title: string | undefined;
  sections: MenuBarTaskSection[];
};

export type MenuBarVisibility = {
  hidden: boolean;
  clearStoredHidden: boolean;
};

export type MenuBarTaskHistoryItem = {
  direction: TimedTaskHistoryState["direction"];
  title: string;
  subtitle: string;
};

export function buildMenuBarTaskHistoryItem(state: TimedTaskHistoryState): MenuBarTaskHistoryItem {
  return {
    direction: state.direction,
    title: timedTaskHistoryPresentation(state).title,
    subtitle: state.taskTitle,
  };
}

export function resolveMenuBarVisibility(storedHidden: boolean, userInitiated: boolean): MenuBarVisibility {
  return {
    hidden: storedHidden && !userInitiated,
    clearStoredHidden: storedHidden && userInitiated,
  };
}

export function buildMenuBarModel(result: TodayResult): MenuBarModel {
  const overdue: MenuBarTask[] = [];
  const today: MenuBarTask[] = [];

  for (const { task, status } of result.tasks) {
    const item = { id: task.id, title: task.title, priority: task.priority };
    if (status === "overdue") {
      overdue.push(item);
    } else {
      today.push(item);
    }
  }

  const sections: MenuBarTaskSection[] = [];
  if (overdue.length > 0) {
    sections.push({ key: "overdue", title: "Overdue", tasks: overdue });
  }
  if (today.length > 0) {
    sections.push({ key: "today", title: "Today", tasks: today });
  }

  const count = overdue.length + today.length;
  return { count, title: count === 0 ? undefined : String(count), sections };
}
