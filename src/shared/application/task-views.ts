import { DomainError, type Project, type Section, type Task } from "../domain/model";
import type { TodayResult, UpcomingResult } from "../domain/queries";
import type { TaskService } from "../domain/task-service";
import { canonicalizeTimeZone, validateId, validateNonNegativeInteger } from "../domain/validation";

export const STATIC_TASK_VIEW_KINDS = ["all", "today", "upcoming", "inbox", "completed", "trash"] as const;
export const TASK_VIEW_KINDS = [...STATIC_TASK_VIEW_KINDS, "project", "section"] as const;

export type StaticTaskViewKind = (typeof STATIC_TASK_VIEW_KINDS)[number];
export type TaskViewKind = (typeof TASK_VIEW_KINDS)[number];

type StaticTaskView = {
  [Kind in StaticTaskViewKind]: { kind: Kind };
}[StaticTaskViewKind];

export type TaskView =
  StaticTaskView | { kind: "project"; projectId: string } | { kind: "section"; projectId: string; sectionId: string };

export type TaskViewContext = {
  evaluationInstantMs: number;
  viewerTimeZone: string;
};

type TodayTaskView = Extract<TaskView, { kind: "today" }>;
type UpcomingTaskView = Extract<TaskView, { kind: "upcoming" }>;
type OrdinaryTaskView = Exclude<TaskView, TodayTaskView | UpcomingTaskView>;

type TaskViewResultContext = {
  evaluatedAtMs: number;
  viewerTimeZone: string;
};

export type TodayTaskViewResult = TaskViewResultContext & {
  kind: "today";
  view: TodayTaskView;
  result: TodayResult;
};

export type UpcomingTaskViewResult = TaskViewResultContext & {
  kind: "upcoming";
  view: UpcomingTaskView;
  result: UpcomingResult;
};

export type OrdinaryTaskViewResult = TaskViewResultContext & {
  kind: "tasks";
  view: OrdinaryTaskView;
  result: Task[];
};

export type TaskViewResult = TodayTaskViewResult | UpcomingTaskViewResult | OrdinaryTaskViewResult;

export function isStaticTaskViewKind(value: unknown): value is StaticTaskViewKind {
  return typeof value === "string" && STATIC_TASK_VIEW_KINDS.some((kind) => kind === value);
}

export function resolveTaskView(
  source: Pick<TaskService, "listSections">,
  kind: TaskViewKind,
  projectId: string | undefined,
  sectionId: string | undefined,
): TaskView {
  if (kind === "project") {
    if (!projectId || sectionId) {
      throw new DomainError("INVALID_ARGUMENT", "The project view requires only projectId");
    }
    return { kind, projectId: validateId(projectId) };
  }
  if (kind === "section") {
    if (!sectionId || projectId) {
      throw new DomainError("INVALID_ARGUMENT", "The section view requires only sectionId");
    }
    const validSectionId = validateId(sectionId);
    const section = source.listSections().find((candidate) => candidate.id === validSectionId);
    if (!section) {
      throw new DomainError("NOT_FOUND", "Section not found");
    }
    return { kind, projectId: section.projectId, sectionId: section.id };
  }
  if (projectId || sectionId) {
    throw new DomainError("INVALID_ARGUMENT", "projectId and sectionId are valid only for their matching views");
  }
  return { kind };
}

export function normalizeTaskView(
  view: TaskView,
  projects: readonly Project[],
  sections: readonly Section[],
): TaskView {
  if (view.kind === "project") {
    return projects.some((project) => project.id === view.projectId) ? view : { kind: "all" };
  }
  if (view.kind !== "section") {
    return view;
  }

  const section = sections.find((candidate) => candidate.id === view.sectionId);
  if (section && projects.some((project) => project.id === section.projectId)) {
    return { kind: "section", projectId: section.projectId, sectionId: section.id };
  }
  return projects.some((project) => project.id === view.projectId)
    ? { kind: "project", projectId: view.projectId }
    : { kind: "all" };
}

export function loadTaskView(source: TaskService, view: TodayTaskView, context: TaskViewContext): TodayTaskViewResult;
export function loadTaskView(
  source: TaskService,
  view: UpcomingTaskView,
  context: TaskViewContext,
): UpcomingTaskViewResult;
export function loadTaskView(source: TaskService, view: TaskView, context: TaskViewContext): TaskViewResult;
export function loadTaskView(source: TaskService, view: TaskView, context: TaskViewContext): TaskViewResult {
  const evaluatedAtMs = validateNonNegativeInteger(context.evaluationInstantMs, "Evaluation instant");
  const viewerTimeZone = canonicalizeTimeZone(context.viewerTimeZone);
  const resultContext = { evaluatedAtMs, viewerTimeZone };

  switch (view.kind) {
    case "today":
      return { kind: "today", view, result: source.listToday(evaluatedAtMs, viewerTimeZone), ...resultContext };
    case "upcoming":
      return { kind: "upcoming", view, result: source.listUpcoming(evaluatedAtMs, viewerTimeZone), ...resultContext };
    case "all":
      return { kind: "tasks", view, result: source.listAllTasks(viewerTimeZone), ...resultContext };
    case "inbox":
      return { kind: "tasks", view, result: source.listInbox(), ...resultContext };
    case "project":
      return { kind: "tasks", view, result: source.listProjectTasks(view.projectId), ...resultContext };
    case "section":
      return { kind: "tasks", view, result: source.listSectionTasks(view.sectionId), ...resultContext };
    case "completed":
      return { kind: "tasks", view, result: source.listCompleted(), ...resultContext };
    case "trash":
      return { kind: "tasks", view, result: source.listTrash(), ...resultContext };
  }
}

export function tasksInTaskView(result: TaskViewResult): Task[] {
  return result.kind === "tasks" ? result.result : result.result.tasks.map((entry) => entry.task);
}
