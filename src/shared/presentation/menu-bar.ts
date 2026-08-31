import type { Priority, Project, Task } from "../domain/model";
import { addCalendarDays, type TodayResult, type UpcomingResult } from "../domain/queries";
import type { TimedTaskHistoryState } from "../application/timed-task-history";
import { timedTaskHistoryPresentation } from "./task-history";

export type MenuBarTask = {
  id: string;
  title: string;
  priority: Priority;
  projectName: string | null;
  view: "today" | "upcoming";
};

export type MenuBarTaskSection = {
  key: "overdue" | "today" | "tomorrow" | "laterThisWeek";
  title: "Overdue" | "Today" | "Tomorrow" | "Later This Week";
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

function menuBarTask(task: Task, projects: ReadonlyMap<string, Project>, view: MenuBarTask["view"]): MenuBarTask {
  return {
    id: task.id,
    title: task.title,
    priority: task.priority,
    projectName: task.projectId === null ? null : (projects.get(task.projectId)?.name ?? null),
    view,
  };
}

function endOfWeek(date: string): string {
  const dayOfWeek = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return addCalendarDays(date, dayOfWeek === 0 ? 0 : 7 - dayOfWeek);
}

export function menuBarTaskTitle(task: MenuBarTask): string {
  return task.projectName === null ? task.title : `${task.title} · ${task.projectName}`;
}

export function buildMenuBarModel(
  todayResult: TodayResult,
  upcomingResult: UpcomingResult,
  projects: readonly Project[],
): MenuBarModel {
  const overdue: MenuBarTask[] = [];
  const today: MenuBarTask[] = [];
  const tomorrow: MenuBarTask[] = [];
  const laterThisWeek: MenuBarTask[] = [];
  const projectMap = new Map(projects.map((project) => [project.id, project]));

  for (const { task, status } of todayResult.tasks) {
    const item = menuBarTask(task, projectMap, "today");
    if (status === "overdue") {
      overdue.push(item);
    } else {
      today.push(item);
    }
  }

  const tomorrowDate = addCalendarDays(todayResult.localDate, 1);
  const endOfWeekDate = endOfWeek(todayResult.localDate);
  for (const { task, localDate } of upcomingResult.tasks) {
    if (localDate > endOfWeekDate) {
      break;
    }
    const item = menuBarTask(task, projectMap, "upcoming");
    if (localDate === tomorrowDate) {
      tomorrow.push(item);
    } else {
      laterThisWeek.push(item);
    }
  }

  const sections: MenuBarTaskSection[] = [];
  if (overdue.length > 0) {
    sections.push({ key: "overdue", title: "Overdue", tasks: overdue });
  }
  if (today.length > 0) {
    sections.push({ key: "today", title: "Today", tasks: today });
  }
  if (tomorrow.length > 0) {
    sections.push({ key: "tomorrow", title: "Tomorrow", tasks: tomorrow });
  }
  if (laterThisWeek.length > 0) {
    sections.push({ key: "laterThisWeek", title: "Later This Week", tasks: laterThisWeek });
  }

  const count = todayResult.count;
  return { count, title: count === 0 ? undefined : String(count), sections };
}
