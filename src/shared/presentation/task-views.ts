import type { Placement, Project, Section } from "../domain/model";
import { addCalendarDays, startOfCalendarDate } from "../domain/queries";
import type { TaskService } from "../domain/task-service";
import { lifecycleActionIntentForViewKind } from "./task-actions";
import { buildAllTaskListSections, buildTaskListItems, type TaskListEntry, type TaskListSection } from "./task-list";

export type TaskView =
  | { kind: "all" }
  | { kind: "today" }
  | { kind: "upcoming" }
  | { kind: "inbox" }
  | { kind: "completed" }
  | { kind: "trash" }
  | { kind: "project"; projectId: string }
  | { kind: "section"; projectId: string; sectionId: string };

export type TaskViewContent = {
  title: string;
  searchPlaceholder: string;
  emptyTitle: string;
  emptyDescription: string;
};

const STATIC_VIEW_CONTENT: Record<Exclude<TaskView["kind"], "project" | "section">, TaskViewContent> = {
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
    case "section":
      return `section:${view.sectionId}`;
    default:
      return view.kind;
  }
}

export function taskViewFromKey(value: string, projects: readonly Project[], sections: readonly Section[]): TaskView {
  if (
    value === "all" ||
    value === "today" ||
    value === "upcoming" ||
    value === "inbox" ||
    value === "completed" ||
    value === "trash"
  ) {
    return { kind: value };
  }
  if (value.startsWith("project:")) {
    const projectId = value.slice("project:".length);
    if (projects.some((project) => project.id === projectId)) {
      return { kind: "project", projectId };
    }
  }
  if (value.startsWith("section:")) {
    const sectionId = value.slice("section:".length);
    const section = sections.find((candidate) => candidate.id === sectionId);
    if (section && projects.some((project) => project.id === section.projectId)) {
      return { kind: "section", projectId: section.projectId, sectionId };
    }
  }
  return { kind: "all" };
}

export function normalizeTaskView(
  view: TaskView,
  projects: readonly Project[],
  sections: readonly Section[],
): TaskView {
  if (
    view.kind === "section" &&
    !sections.some((section) => section.id === view.sectionId) &&
    projects.some((project) => project.id === view.projectId)
  ) {
    return { kind: "project", projectId: view.projectId };
  }
  return taskViewFromKey(taskViewKey(view), projects, sections);
}

export function taskViewContent(
  view: TaskView,
  projects: readonly Project[],
  sections: readonly Section[],
): TaskViewContent {
  if (view.kind === "project") {
    const title = projects.find((project) => project.id === view.projectId)?.name ?? "Project";
    return {
      title,
      searchPlaceholder: `Search ${title}`,
      emptyTitle: `${title} is empty`,
      emptyDescription: "Create a task in this project.",
    };
  }
  if (view.kind === "section") {
    const project = projects.find((candidate) => candidate.id === view.projectId)?.name ?? "Project";
    const section = sections.find((candidate) => candidate.id === view.sectionId)?.name ?? "Section";
    return {
      title: `${project} / ${section}`,
      searchPlaceholder: `Search ${section}`,
      emptyTitle: `${section} is empty`,
      emptyDescription: "Create a task in this section.",
    };
  }
  return STATIC_VIEW_CONTENT[view.kind];
}

export function initialPlacementForTaskView(view: TaskView): Placement {
  switch (view.kind) {
    case "project":
      return { kind: "project", projectId: view.projectId };
    case "section":
      return { kind: "section", projectId: view.projectId, sectionId: view.sectionId };
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

export function loadTaskViewSections(
  source: { service: TaskService },
  view: TaskView,
  viewerTimeZone: string,
  evaluationInstantMs = Date.now(),
): TaskListSection[] {
  const projects = source.service.listProjects();
  const sections = source.service.listSections();
  let entries: TaskListEntry[];
  switch (view.kind) {
    case "all":
      return buildAllTaskListSections(source.service.listAllTasks(viewerTimeZone), projects, sections, viewerTimeZone);
    case "today":
      entries = source.service.listToday(evaluationInstantMs, viewerTimeZone).tasks.map(({ task, status }) => ({
        task,
        todayStatus: status,
      }));
      break;
    case "upcoming": {
      const result = source.service.listUpcoming(evaluationInstantMs, viewerTimeZone);
      const groups = new Map<string, TaskListEntry[]>();
      for (const { task, localDate } of result.tasks) {
        const group = groups.get(localDate) ?? [];
        group.push({ task });
        groups.set(localDate, group);
      }
      return [...groups].map(([date, group]) => ({
        key: `upcoming:${date}`,
        title: upcomingSectionTitle(date, result.localDate, viewerTimeZone),
        items: buildTaskListItems(group, projects, sections, viewerTimeZone),
      }));
    }
    case "inbox":
      entries = source.service.listInbox().map((task) => ({ task }));
      break;
    case "project":
      entries = source.service.listProjectTasks(view.projectId).map((task) => ({ task }));
      break;
    case "section":
      entries = source.service.listSectionTasks(view.sectionId).map((task) => ({ task }));
      break;
    case "completed":
      entries = source.service.listCompleted().map((task) => ({ task }));
      break;
    case "trash":
      entries = source.service.listTrash().map((task) => ({ task }));
      break;
  }
  return [
    {
      key: taskViewKey(view),
      title: taskViewContent(view, projects, sections).title,
      items: buildTaskListItems(entries, projects, sections, viewerTimeZone),
    },
  ];
}

export function lifecycleActionForTaskView(view: TaskView, service: TaskService, taskId: string) {
  const intent = lifecycleActionIntentForViewKind(view.kind);
  switch (intent.kind) {
    case "restore":
      return { ...intent, operation: () => service.restoreTask(taskId) };
    case "reopen":
      return { ...intent, operation: () => service.reopenTask(taskId) };
    default:
      return { ...intent, operation: () => service.completeTask(taskId) };
  }
}

export type { TaskListSection } from "./task-list";
