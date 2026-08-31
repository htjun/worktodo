import type { Project, Section, Task } from "../domain/model";
import type { TodayTask } from "../domain/queries";

export type TaskListEntry = {
  task: Task;
  todayStatus?: TodayTask["status"];
};

export type TaskListItem = {
  id: string;
  title: string;
  subtitle: string;
  keywords: string[];
  metadata: string[];
  detail: TaskDetailPresentation;
  task: Task;
};

export type TaskListSection = {
  key: string;
  title: string;
  items: TaskListItem[];
};

export type TaskListRowPresentation = {
  title: string;
  accessories: string[];
  isCompletionAcknowledged: boolean;
};

export type TaskDetailField = {
  title: string;
  text: string;
};

export type TaskDetailPresentation = {
  markdown: string;
  links: string[];
  metadata: TaskDetailField[];
};

type DuePresentation = {
  title: "Due Date" | "Overdue" | "Today";
  text: string;
};

function placementLabel(task: Task, projects: Map<string, Project>, sections: Map<string, Section>): string {
  if (task.projectId === null) {
    return "Inbox";
  }
  const project = projects.get(task.projectId)?.name ?? task.projectId;
  if (task.sectionId === null) {
    return project;
  }
  const section = sections.get(task.sectionId)?.name ?? task.sectionId;
  return `${project} / ${section}`;
}

function instantLabel(instantMs: number, viewerTimeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: viewerTimeZone,
  }).format(new Date(instantMs));
}

function duePresentation(entry: TaskListEntry, viewerTimeZone: string): DuePresentation {
  const title = entry.todayStatus === "overdue" ? "Overdue" : entry.todayStatus === "dueToday" ? "Today" : "Due Date";
  if (entry.task.due.kind === "none") {
    return { title: "Due Date", text: "None" };
  }
  if (entry.task.due.kind === "allDay") {
    return { title, text: entry.task.due.date };
  }
  return { title, text: instantLabel(entry.task.due.instantMs, viewerTimeZone) };
}

function lifecycleLabel(
  prefix: "Completed" | "Trashed",
  instantMs: number | null,
  viewerTimeZone: string,
): string | null {
  if (instantMs === null) {
    return null;
  }
  return `${prefix} ${instantLabel(instantMs, viewerTimeZone)}`;
}

function trimUrlCandidate(value: string): string {
  let candidate = value;
  let previous = "";
  while (candidate !== previous) {
    previous = candidate;
    candidate = candidate.replace(/[.,;:!?]+$/u, "");
    const closing = candidate.at(-1);
    const opening = closing === ")" ? "(" : closing === "]" ? "[" : closing === "}" ? "{" : null;
    if (
      opening &&
      [...candidate].filter((character) => character === closing).length >
        [...candidate].filter((character) => character === opening).length
    ) {
      candidate = candidate.slice(0, -1);
    }
  }
  return candidate;
}

export function extractTaskNoteLinks(notes: string): string[] {
  const links: string[] = [];
  const seen = new Set<string>();
  for (const match of notes.matchAll(/\bhttps?:\/\/[^\s<>"']+/giu)) {
    const candidate = trimUrlCandidate(match[0]);
    try {
      const url = new URL(candidate);
      if ((url.protocol !== "http:" && url.protocol !== "https:") || url.hostname.length === 0 || seen.has(url.href)) {
        continue;
      }
      seen.add(url.href);
      links.push(candidate);
    } catch {
      continue;
    }
  }
  return links;
}

export function taskNotesMarkdown(notes: string): string {
  if (notes.length === 0) {
    return "## Notes\n\n_No notes_";
  }
  const literalNotes = notes.replace(/[!-/:-@[-`{-~]/g, "\\$&").replace(/\n/g, "  \n");
  return `## Notes\n\n${literalNotes}`;
}

export function taskListRowPresentation(
  item: TaskListItem,
  acknowledgedTask: Task | undefined,
): TaskListRowPresentation {
  const isCompletionAcknowledged = acknowledgedTask?.id === item.id && acknowledgedTask.completedAtMs !== null;
  return {
    title: item.title,
    accessories: isCompletionAcknowledged ? ["Completed"] : item.metadata,
    isCompletionAcknowledged,
  };
}

function priorityDetailLabel(task: Task): string {
  if (task.priority === "none") {
    return "None";
  }
  return `${task.priority[0].toUpperCase()}${task.priority.slice(1)}`;
}

function detailPresentation(entry: TaskListEntry, placement: string, viewerTimeZone: string): TaskDetailPresentation {
  const due = duePresentation(entry, viewerTimeZone);
  const metadata: TaskDetailField[] = [
    { title: "Project", text: placement },
    { title: "Priority", text: priorityDetailLabel(entry.task) },
    due,
    { title: "Created", text: instantLabel(entry.task.createdAtMs, viewerTimeZone) },
    { title: "Updated", text: instantLabel(entry.task.updatedAtMs, viewerTimeZone) },
  ];
  if (entry.task.completedAtMs !== null) {
    metadata.push({ title: "Completed", text: instantLabel(entry.task.completedAtMs, viewerTimeZone) });
  }
  if (entry.task.trashedAtMs !== null) {
    metadata.push({ title: "Trashed", text: instantLabel(entry.task.trashedAtMs, viewerTimeZone) });
  }
  return {
    markdown: taskNotesMarkdown(entry.task.notes),
    links: extractTaskNoteLinks(entry.task.notes),
    metadata,
  };
}

export function buildTaskListItems(
  entries: readonly TaskListEntry[],
  projects: readonly Project[],
  sections: readonly Section[],
  viewerTimeZone: string,
): TaskListItem[] {
  const projectMap = new Map(projects.map((project) => [project.id, project]));
  const sectionMap = new Map(sections.map((section) => [section.id, section]));

  return entries.map((entry) => {
    const placement = placementLabel(entry.task, projectMap, sectionMap);
    const due = entry.task.due.kind === "none" ? null : duePresentation(entry, viewerTimeZone);
    const priority = entry.task.priority === "none" ? null : `${entry.task.priority} priority`;
    const completed = lifecycleLabel("Completed", entry.task.completedAtMs, viewerTimeZone);
    const trashed = lifecycleLabel("Trashed", entry.task.trashedAtMs, viewerTimeZone);
    return {
      id: entry.task.id,
      title: entry.task.title,
      subtitle: placement,
      keywords: [placement, entry.task.notes],
      metadata: [priority, due ? `${due.title} ${due.text}` : null, completed, trashed].filter(
        (value): value is string => value !== null,
      ),
      detail: detailPresentation(entry, placement, viewerTimeZone),
      task: entry.task,
    };
  });
}

export function buildAllTaskListSections(
  tasks: readonly Task[],
  projects: readonly Project[],
  sections: readonly Section[],
  viewerTimeZone: string,
): TaskListSection[] {
  const groups = [
    {
      key: "all:inbox",
      title: "Inbox",
      tasks: tasks.filter((task) => task.projectId === null),
    },
    ...projects.map((project) => ({
      key: `all:project:${project.id}`,
      title: project.name,
      tasks: tasks.filter((task) => task.projectId === project.id),
    })),
  ];

  return groups
    .filter((group) => group.tasks.length > 0)
    .map((group) => ({
      key: group.key,
      title: group.title,
      items: buildTaskListItems(
        group.tasks.map((task) => ({ task })),
        projects,
        sections,
        viewerTimeZone,
      ),
    }));
}
