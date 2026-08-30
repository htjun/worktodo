import { Icon, List } from "@raycast/api";
import type { WorktodoSession } from "./shared/application/worktodo";
import type { Placement, Project, Section } from "./shared/domain/model";
import { addCalendarDays, startOfCalendarDate } from "./shared/domain/queries";
import type { TaskService } from "./shared/domain/task-service";
import { lifecycleActionIntentForViewKind } from "./shared/presentation/task-actions";
import { buildTaskListItems, type TaskListEntry, type TaskListItem } from "./shared/presentation/task-list";

export type TaskView =
  | { kind: "today" }
  | { kind: "upcoming" }
  | { kind: "inbox" }
  | { kind: "completed" }
  | { kind: "trash" }
  | { kind: "project"; projectId: string }
  | { kind: "section"; projectId: string; sectionId: string };

const STATIC_VIEW_CONTENT = {
  today: {
    title: "Today",
    icon: Icon.Calendar,
    taskIcon: Icon.Circle,
    searchPlaceholder: "Search Today",
    emptyTitle: "Nothing due today",
    emptyDescription: "Overdue and due-today tasks appear here.",
  },
  upcoming: {
    title: "Upcoming",
    icon: Icon.Calendar,
    taskIcon: Icon.Circle,
    searchPlaceholder: "Search Upcoming",
    emptyTitle: "No upcoming tasks",
    emptyDescription: "Tasks due after today appear here.",
  },
  inbox: {
    title: "Inbox",
    icon: Icon.Tray,
    taskIcon: Icon.Circle,
    searchPlaceholder: "Search Inbox",
    emptyTitle: "Inbox is empty",
    emptyDescription: "Create a task to capture it.",
  },
  completed: {
    title: "Completed",
    icon: Icon.CheckCircle,
    taskIcon: Icon.CheckCircle,
    searchPlaceholder: "Search Completed",
    emptyTitle: "No completed tasks",
    emptyDescription: "Completed tasks appear here.",
  },
  trash: {
    title: "Trash",
    icon: Icon.Trash,
    taskIcon: Icon.Trash,
    searchPlaceholder: "Search Trash",
    emptyTitle: "Trash is empty",
    emptyDescription: "Tasks moved to Trash appear here.",
  },
} as const;

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
  if (value === "today" || value === "upcoming" || value === "inbox" || value === "completed" || value === "trash") {
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
  return { kind: "inbox" };
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

export function taskViewContent(view: TaskView, projects: readonly Project[], sections: readonly Section[]) {
  if (view.kind === "project") {
    const title = projects.find((project) => project.id === view.projectId)?.name ?? "Project";
    return {
      title,
      icon: Icon.Folder,
      taskIcon: Icon.Circle,
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
      icon: Icon.BulletPoints,
      taskIcon: Icon.Circle,
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

export type TaskListSection = {
  key: string;
  title: string;
  items: TaskListItem[];
};

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
  session: WorktodoSession,
  view: TaskView,
  viewerTimeZone: string,
): TaskListSection[] {
  const projects = session.service.listProjects();
  const sections = session.service.listSections();
  let entries: TaskListEntry[];
  switch (view.kind) {
    case "today":
      entries = session.service.listToday(Date.now(), viewerTimeZone).tasks.map(({ task, status }) => ({
        task,
        todayStatus: status,
      }));
      break;
    case "upcoming": {
      const result = session.service.listUpcoming(Date.now(), viewerTimeZone);
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
      entries = session.service.listInbox().map((task) => ({ task }));
      break;
    case "project":
      entries = session.service.listProjectTasks(view.projectId).map((task) => ({ task }));
      break;
    case "section":
      entries = session.service.listSectionTasks(view.sectionId).map((task) => ({ task }));
      break;
    case "completed":
      entries = session.service.listCompleted().map((task) => ({ task }));
      break;
    case "trash":
      entries = session.service.listTrash().map((task) => ({ task }));
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
      return {
        title: intent.title,
        icon: Icon.ArrowCounterClockwise,
        successTitle: intent.successTitle,
        operation: () => service.restoreTask(taskId),
      };
    case "reopen":
      return {
        title: intent.title,
        icon: Icon.Circle,
        successTitle: intent.successTitle,
        operation: () => service.reopenTask(taskId),
      };
    default:
      return {
        title: intent.title,
        icon: Icon.CheckCircle,
        successTitle: intent.successTitle,
        operation: () => service.completeTask(taskId),
      };
  }
}

export function TaskViewDropdown({
  view,
  projects,
  sections,
  onChange,
}: {
  view: TaskView;
  projects: readonly Project[];
  sections: readonly Section[];
  onChange: (view: TaskView) => void;
}) {
  return (
    <List.Dropdown
      tooltip="Task View"
      value={taskViewKey(view)}
      onChange={(value) => onChange(taskViewFromKey(value, projects, sections))}
    >
      <List.Dropdown.Section title="Views">
        <List.Dropdown.Item value="today" title="Today" icon={Icon.Calendar} />
        <List.Dropdown.Item value="upcoming" title="Upcoming" icon={Icon.Calendar} />
        <List.Dropdown.Item value="inbox" title="Inbox" icon={Icon.Tray} />
        <List.Dropdown.Item value="completed" title="Completed" icon={Icon.CheckCircle} />
        <List.Dropdown.Item value="trash" title="Trash" icon={Icon.Trash} />
      </List.Dropdown.Section>
      {projects.map((project) => (
        <List.Dropdown.Section key={project.id} title={project.name}>
          <List.Dropdown.Item value={`project:${project.id}`} title="All Tasks" icon={Icon.Folder} />
          {sections
            .filter((section) => section.projectId === project.id)
            .map((section) => (
              <List.Dropdown.Item
                key={section.id}
                value={`section:${section.id}`}
                title={section.name}
                icon={Icon.BulletPoints}
              />
            ))}
        </List.Dropdown.Section>
      ))}
    </List.Dropdown>
  );
}
