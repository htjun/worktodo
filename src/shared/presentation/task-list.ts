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
  task: Task;
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

function dueLabel(entry: TaskListEntry, viewerTimeZone: string): string | null {
  const prefix = entry.todayStatus === "overdue" ? "Overdue" : entry.todayStatus === "dueToday" ? "Today" : "Due";
  if (entry.task.due.kind === "none") {
    return null;
  }
  if (entry.task.due.kind === "allDay") {
    return `${prefix} ${entry.task.due.date}`;
  }
  const value = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: viewerTimeZone,
  }).format(new Date(entry.task.due.instantMs));
  return `${prefix} ${value}`;
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
    const due = dueLabel(entry, viewerTimeZone);
    const priority = entry.task.priority === "none" ? null : `${entry.task.priority} priority`;
    return {
      id: entry.task.id,
      title: entry.task.title,
      subtitle: placement,
      keywords: [placement, entry.task.notes],
      metadata: [priority, due].filter((value): value is string => value !== null),
      task: entry.task,
    };
  });
}
