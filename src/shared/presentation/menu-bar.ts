import type { Priority, Project, Task } from "../domain/model";
import { addCalendarDays, type ThisWeekResult } from "../domain/queries";
import type { TaskLifecycleHistoryState } from "../application/task-lifecycle-interaction";
import { taskLifecycleHistoryTitle } from "./task-lifecycle";

const MENU_BAR_TASK_LABEL_MAX_GRAPHEMES = 72;
const MENU_BAR_PROJECT_NAME_MAX_GRAPHEMES = 24;
const MENU_BAR_PROJECT_SEPARATOR = " · ";
const MENU_BAR_HISTORY_TITLE_GAP_GRAPHEMES = 1;
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export type MenuBarTask = {
  id: string;
  title: string;
  priority: Priority;
  projectName: string | null;
  view: "thisWeek";
};

export type MenuBarTaskSection = {
  key: "overdue" | "today" | "tomorrow" | "laterThisWeek";
  title: "Overdue" | "Today" | "Tomorrow" | "Later this week";
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
  direction: TaskLifecycleHistoryState["direction"];
  title: string;
  subtitle: string;
};

export function buildMenuBarTaskHistoryItem(state: TaskLifecycleHistoryState): MenuBarTaskHistoryItem {
  const title = taskLifecycleHistoryTitle(state);
  const subtitleMaximum =
    MENU_BAR_TASK_LABEL_MAX_GRAPHEMES - graphemes(title).length - MENU_BAR_HISTORY_TITLE_GAP_GRAPHEMES;
  return {
    direction: state.direction,
    title,
    subtitle: truncateGraphemes(state.taskTitle, subtitleMaximum),
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

function graphemes(value: string): string[] {
  return Array.from(graphemeSegmenter.segment(value), ({ segment }) => segment);
}

function truncateGraphemes(value: string, maximum: number): string {
  const segments = graphemes(value);
  if (segments.length <= maximum) {
    return value;
  }
  return `${segments.slice(0, maximum - 1).join("")}…`;
}

export function menuBarTaskTitle(task: MenuBarTask): string {
  if (task.projectName === null) {
    return truncateGraphemes(task.title, MENU_BAR_TASK_LABEL_MAX_GRAPHEMES);
  }

  const projectName = truncateGraphemes(task.projectName, MENU_BAR_PROJECT_NAME_MAX_GRAPHEMES);
  const taskTitleMaximum =
    MENU_BAR_TASK_LABEL_MAX_GRAPHEMES - graphemes(MENU_BAR_PROJECT_SEPARATOR).length - graphemes(projectName).length;
  return `${truncateGraphemes(task.title, taskTitleMaximum)}${MENU_BAR_PROJECT_SEPARATOR}${projectName}`;
}

export function buildMenuBarModel(thisWeekResult: ThisWeekResult, projects: readonly Project[]): MenuBarModel {
  const overdue: MenuBarTask[] = [];
  const today: MenuBarTask[] = [];
  const tomorrow: MenuBarTask[] = [];
  const laterThisWeek: MenuBarTask[] = [];
  const projectMap = new Map(projects.map((project) => [project.id, project]));

  const tomorrowDate = addCalendarDays(thisWeekResult.localDate, 1);
  for (const { task, status, localDate } of thisWeekResult.tasks) {
    const item = menuBarTask(task, projectMap, "thisWeek");
    if (status === "overdue") {
      overdue.push(item);
    } else if (status === "dueToday") {
      today.push(item);
    } else if (localDate === tomorrowDate) {
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
    sections.push({ key: "laterThisWeek", title: "Later this week", tasks: laterThisWeek });
  }

  const count = overdue.length + today.length;
  return { count, title: count === 0 ? undefined : String(count), sections };
}
