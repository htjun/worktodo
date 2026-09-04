import {
  DomainError,
  placementOf,
  type DueValue,
  type Placement,
  type Priority,
  type Project,
  type Section,
  type Task,
} from "../domain/model";
import { addCalendarDays, calendarDateAt, startOfCalendarDate } from "../domain/queries";
import type { CreateTaskInput, TaskService, UpdateTaskInput } from "../domain/task-service";

export type DueDatePreset = "none" | "today" | "tomorrow" | "endOfWeek" | "custom";

export type TaskEditingValues = {
  title: string;
  notes: string;
  priority: Priority;
  dueDatePreset: DueDatePreset;
  customDueAtMs: number | null;
  selectedPlacement: string;
};

export type TaskEditingContext = {
  referenceInstantMs: number;
  viewerTimeZone: string;
  projects: readonly Project[];
  sections: readonly Section[];
};

export type TaskEditingDefaults = TaskEditingValues;

export type TaskEditingFailureField = "title" | "due" | "placement" | "form";

export type TaskEditingOutcome =
  | { status: "succeeded"; operation: "create" | "update" | "move"; task: Task }
  | { status: "failed"; operation: "create" | "update" | "move"; field: TaskEditingFailureField; message: string };

export type TaskEditingMutations = Pick<TaskService, "createTask" | "updateTask" | "moveTask">;

type OpenTaskEditingSession = () => { service: TaskEditingMutations; close: () => void };

const PROJECT_PREFIX = "project:";
const SECTION_PREFIX = "section:";

function dayOfWeek(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day);
  value.setUTCHours(0, 0, 0, 0);
  return value.getUTCDay();
}

function presetDates(referenceInstantMs: number, viewerTimeZone: string) {
  const today = calendarDateAt(referenceInstantMs, viewerTimeZone);
  return {
    today,
    tomorrow: addCalendarDays(today, 1),
    endOfWeek: addCalendarDays(today, (7 - dayOfWeek(today)) % 7),
  };
}

function dueDatePresetForDue(due: DueValue, referenceInstantMs: number, viewerTimeZone: string): DueDatePreset {
  if (due.kind === "none") {
    return "none";
  }
  if (due.kind === "timed") {
    return "custom";
  }
  const dates = presetDates(referenceInstantMs, viewerTimeZone);
  if (due.date === dates.today) {
    return "today";
  }
  if (due.date === dates.tomorrow) {
    return "tomorrow";
  }
  if (due.date === dates.endOfWeek) {
    return "endOfWeek";
  }
  return "custom";
}

function dueForValues(task: Task | undefined, values: TaskEditingValues, context: TaskEditingContext): DueValue {
  if (values.dueDatePreset === "none") {
    return { kind: "none" };
  }
  if (values.dueDatePreset === "custom") {
    if (values.customDueAtMs === null || !Number.isSafeInteger(values.customDueAtMs)) {
      throw new DomainError("INVALID_DUE_VALUE", "Choose a custom due date");
    }
    if (task?.due.kind === "timed" && values.customDueAtMs === task.due.instantMs) {
      return task.due;
    }
    return { kind: "allDay", date: calendarDateAt(values.customDueAtMs, context.viewerTimeZone) };
  }
  return {
    kind: "allDay",
    date: presetDates(context.referenceInstantMs, context.viewerTimeZone)[values.dueDatePreset],
  };
}

function createInput(values: TaskEditingValues, context: TaskEditingContext): CreateTaskInput {
  const due = dueForValues(undefined, values, context);
  const placement = taskEditingPlacementFromKey(values.selectedPlacement, context.projects, context.sections);
  return {
    title: values.title,
    notes: values.notes,
    priority: values.priority,
    placement,
    due,
  };
}

function updateInput(task: Task, values: TaskEditingValues, context: TaskEditingContext): UpdateTaskInput {
  return {
    title: values.title,
    notes: values.notes,
    priority: values.priority,
    due: dueForValues(task, values, context),
  };
}

function failure(
  operation: TaskEditingOutcome["operation"],
  error: unknown,
): Extract<TaskEditingOutcome, { status: "failed" }> {
  const message = error instanceof Error ? error.message : "An unexpected error occurred";
  if (error instanceof DomainError && error.code === "INVALID_DUE_VALUE") {
    return { status: "failed", operation, field: "due", message };
  }
  if (error instanceof DomainError && error.code === "INVALID_PLACEMENT") {
    return { status: "failed", operation, field: "placement", message };
  }
  if (error instanceof DomainError && error.code === "INVALID_ARGUMENT" && message.startsWith("Task title")) {
    return { status: "failed", operation, field: "title", message };
  }
  return { status: "failed", operation, field: "form", message };
}

export function taskEditingPlacementKey(placement: Placement): string {
  switch (placement.kind) {
    case "inbox":
      return "inbox";
    case "project":
      return `${PROJECT_PREFIX}${placement.projectId}`;
    case "section":
      return `${SECTION_PREFIX}${placement.projectId}:${placement.sectionId}`;
  }
}

export function taskEditingPlacementFromKey(
  key: string,
  projects: readonly Project[],
  sections: readonly Section[],
): Placement {
  if (key === "inbox") {
    return { kind: "inbox" };
  }
  if (key.startsWith(PROJECT_PREFIX)) {
    const projectId = key.slice(PROJECT_PREFIX.length);
    if (projects.some((project) => project.id === projectId)) {
      return { kind: "project", projectId };
    }
  }
  if (key.startsWith(SECTION_PREFIX)) {
    const [projectId, sectionId, extra] = key.slice(SECTION_PREFIX.length).split(":");
    const project = projects.find((candidate) => candidate.id === projectId);
    const section = sections.find((candidate) => candidate.id === sectionId);
    if (!extra && project && section?.projectId === project.id) {
      return { kind: "section", projectId: project.id, sectionId: section.id };
    }
  }
  throw new DomainError("INVALID_PLACEMENT", "Choose an existing project or section");
}

export function taskEditingDefaults(
  task: Task | undefined,
  initialPlacement: Placement,
  referenceInstantMs: number,
  viewerTimeZone: string,
): TaskEditingDefaults {
  if (!task) {
    return {
      title: "",
      notes: "",
      priority: "none",
      dueDatePreset: "none",
      customDueAtMs: null,
      selectedPlacement: taskEditingPlacementKey(initialPlacement),
    };
  }
  return {
    title: task.title,
    notes: task.notes,
    priority: task.priority,
    dueDatePreset: dueDatePresetForDue(task.due, referenceInstantMs, viewerTimeZone),
    customDueAtMs:
      task.due.kind === "none"
        ? null
        : task.due.kind === "allDay"
          ? startOfCalendarDate(task.due.date, viewerTimeZone)
          : task.due.instantMs,
    selectedPlacement: taskEditingPlacementKey(placementOf(task)),
  };
}

export function createOperationScopedTaskEditingMutations(openSession: OpenTaskEditingSession): TaskEditingMutations {
  const run = <Result>(operation: (service: TaskEditingMutations) => Result): Result => {
    const session = openSession();
    try {
      return operation(session.service);
    } finally {
      session.close();
    }
  };
  return {
    createTask: (input) => run((service) => service.createTask(input)),
    updateTask: (taskId, input) => run((service) => service.updateTask(taskId, input)),
    moveTask: (taskId, placement) => run((service) => service.moveTask(taskId, placement)),
  };
}

export class TaskEditingInteraction {
  constructor(private readonly mutations: TaskEditingMutations) {}

  save(task: Task | undefined, values: TaskEditingValues, context: TaskEditingContext): TaskEditingOutcome {
    const operation = task ? "update" : "create";
    if (values.title.trim().length === 0) {
      return { status: "failed", operation, field: "title", message: "Title cannot be empty" };
    }
    try {
      const saved = task
        ? this.mutations.updateTask(task.id, updateInput(task, values, context))
        : this.mutations.createTask(createInput(values, context));
      return { status: "succeeded", operation, task: saved };
    } catch (error) {
      return failure(operation, error);
    }
  }

  move(
    taskId: string,
    selectedPlacement: string,
    projects: readonly Project[],
    sections: readonly Section[],
  ): TaskEditingOutcome {
    try {
      const placement = taskEditingPlacementFromKey(selectedPlacement, projects, sections);
      return { status: "succeeded", operation: "move", task: this.mutations.moveTask(taskId, placement) };
    } catch (error) {
      return failure("move", error);
    }
  }
}
