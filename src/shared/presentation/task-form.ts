import { DomainError, type DueValue, type Priority, type Task } from "../domain/model";
import { calendarDateAt, startOfCalendarDate } from "../domain/queries";
import type { CreateTaskInput, UpdateTaskInput } from "../domain/task-service";

export type TaskFormValues = {
  title: string;
  notes: string;
  priority: Priority;
  dueKind: DueValue["kind"];
  dueAtMs: number | null;
};

export type TaskFormDefaults = TaskFormValues;

function dueFromForm(values: TaskFormValues, viewerTimeZone: string): DueValue {
  if (values.dueKind === "none") {
    return { kind: "none" };
  }
  if (values.dueAtMs === null || !Number.isSafeInteger(values.dueAtMs) || values.dueAtMs < 0) {
    throw new DomainError("INVALID_DUE_VALUE", "Choose a due date");
  }
  if (values.dueKind === "allDay") {
    return { kind: "allDay", date: calendarDateAt(values.dueAtMs, viewerTimeZone) };
  }
  return { kind: "timed", instantMs: values.dueAtMs, timeZone: viewerTimeZone };
}

export function formToCreateTask(values: TaskFormValues, viewerTimeZone: string): CreateTaskInput {
  return {
    title: values.title,
    notes: values.notes,
    priority: values.priority,
    placement: { kind: "inbox" },
    due: dueFromForm(values, viewerTimeZone),
  };
}

export function formToUpdateTask(values: TaskFormValues, viewerTimeZone: string): UpdateTaskInput {
  return {
    title: values.title,
    notes: values.notes,
    priority: values.priority,
    due: dueFromForm(values, viewerTimeZone),
  };
}

export function taskFormDefaults(task: Task | undefined, viewerTimeZone: string): TaskFormDefaults {
  if (!task) {
    return { title: "", notes: "", priority: "none", dueKind: "none", dueAtMs: null };
  }
  const dueAtMs =
    task.due.kind === "none"
      ? null
      : task.due.kind === "allDay"
        ? startOfCalendarDate(task.due.date, viewerTimeZone)
        : task.due.instantMs;
  return {
    title: task.title,
    notes: task.notes,
    priority: task.priority,
    dueKind: task.due.kind,
    dueAtMs,
  };
}
