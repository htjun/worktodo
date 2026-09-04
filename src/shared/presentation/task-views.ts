import { isStaticTaskViewKind, type TaskView, type TaskViewResult } from "../application/task-views";
import type { Label, Placement, Project } from "../domain/model";
import { addCalendarDays, startOfCalendarDate } from "../domain/queries";
import { buildAllTaskListSections, buildTaskListItems, type TaskListEntry, type TaskListSection } from "./task-list";

export type TaskViewContent = {
  title: string;
  searchPlaceholder: string;
  emptyTitle: string;
  emptyDescription: string;
};

const STATIC_VIEW_CONTENT: Record<Exclude<TaskView["kind"], "project">, TaskViewContent> = {
  all: {
    title: "All Tasks",
    searchPlaceholder: "Search All Tasks",
    emptyTitle: "No tasks",
    emptyDescription: "Create a task to get started.",
  },
  today: {
    title: "Today",
    searchPlaceholder: "Search Today",
    emptyTitle: "Nothing due today",
    emptyDescription: "Overdue and due-today tasks appear here.",
  },
  upcoming: {
    title: "Upcoming",
    searchPlaceholder: "Search Upcoming",
    emptyTitle: "No upcoming tasks",
    emptyDescription: "Tasks due after today appear here.",
  },
  inbox: {
    title: "Inbox",
    searchPlaceholder: "Search Inbox",
    emptyTitle: "Inbox is empty",
    emptyDescription: "Create a task to capture it.",
  },
  completed: {
    title: "Completed",
    searchPlaceholder: "Search Completed",
    emptyTitle: "No completed tasks",
    emptyDescription: "Completed tasks appear here.",
  },
  trash: {
    title: "Trash",
    searchPlaceholder: "Search Trash",
    emptyTitle: "Trash is empty",
    emptyDescription: "Tasks moved to Trash appear here.",
  },
};

export function taskViewKey(view: TaskView): string {
  switch (view.kind) {
    case "project":
      return `project:${view.projectId}`;
    default:
      return view.kind;
  }
}

export function taskViewFromKey(value: string, projects: readonly Project[]): TaskView {
  if (isStaticTaskViewKind(value)) {
    return { kind: value };
  }
  if (value.startsWith("project:")) {
    const projectId = value.slice("project:".length);
    if (projects.some((project) => project.id === projectId)) {
      return { kind: "project", projectId };
    }
  }
  return { kind: "all" };
}

export function taskViewContent(view: TaskView, projects: readonly Project[]): TaskViewContent {
  if (view.kind === "project") {
    const title = projects.find((project) => project.id === view.projectId)?.name ?? "Project";
    return {
      title,
      searchPlaceholder: `Search ${title}`,
      emptyTitle: `${title} is empty`,
      emptyDescription: "Create a task in this project.",
    };
  }
  return STATIC_VIEW_CONTENT[view.kind];
}

export function initialPlacementForTaskView(view: TaskView): Placement {
  switch (view.kind) {
    case "project":
      return { kind: "project", projectId: view.projectId };
    default:
      return { kind: "inbox" };
  }
}

function upcomingSectionTitle(date: string, localDate: string, viewerTimeZone: string): string {
  if (date === addCalendarDays(localDate, 1)) {
    return "Tomorrow";
  }
  const options: Intl.DateTimeFormatOptions = {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: viewerTimeZone,
  };
  if (date.slice(0, 4) !== localDate.slice(0, 4)) {
    options.year = "numeric";
  }
  return new Intl.DateTimeFormat(undefined, options).format(new Date(startOfCalendarDate(date, viewerTimeZone)));
}

export function buildTaskViewSections(
  taskView: TaskViewResult,
  projects: readonly Project[],
  labels: readonly Label[],
): TaskListSection[] {
  if (taskView.kind === "today") {
    return [
      {
        key: "today",
        title: taskViewContent(taskView.view, projects).title,
        items: buildTaskListItems(
          taskView.result.tasks.map(({ task, status }) => ({ task, todayStatus: status })),
          projects,
          labels,
          taskView.viewerTimeZone,
        ),
      },
    ];
  }

  if (taskView.kind === "upcoming") {
    const groups = new Map<string, TaskListEntry[]>();
    for (const { task, localDate } of taskView.result.tasks) {
      const group = groups.get(localDate) ?? [];
      group.push({ task });
      groups.set(localDate, group);
    }
    return [...groups].map(([date, group]) => ({
      key: `upcoming:${date}`,
      title: upcomingSectionTitle(date, taskView.result.localDate, taskView.viewerTimeZone),
      items: buildTaskListItems(group, projects, labels, taskView.viewerTimeZone),
    }));
  }

  if (taskView.view.kind === "all") {
    return buildAllTaskListSections(taskView.result, projects, labels, taskView.viewerTimeZone);
  }

  return [
    {
      key: taskViewKey(taskView.view),
      title: taskViewContent(taskView.view, projects).title,
      items: buildTaskListItems(
        taskView.result.map((task) => ({ task })),
        projects,
        labels,
        taskView.viewerTimeZone,
      ),
    },
  ];
}

export type { TaskListSection } from "./task-list";
