import type { Project, Section, Task } from "../domain/model";
import type { TaskService } from "../domain/task-service";
import { dueDateFormValueForPreset, type DueDatePreset } from "../presentation/due-date";
import { placementFromKey } from "../presentation/placement";
import { formToCreateTask, formToUpdateTask, type TaskFormValues } from "../presentation/task-form";

export type TaskSubmission = {
  title: string;
  notes: string;
  priority: TaskFormValues["priority"];
  dueDatePreset: DueDatePreset;
  customDueAtMs: number | null;
  referenceInstantMs: number;
  viewerTimeZone: string;
};

type PlacementSelection = {
  selectedPlacement: string;
  projects: readonly Project[];
  sections: readonly Section[];
};

function formValues(task: Task | undefined, submission: TaskSubmission): TaskFormValues {
  const selectedDue = dueDateFormValueForPreset(
    submission.dueDatePreset,
    submission.customDueAtMs,
    submission.referenceInstantMs,
    submission.viewerTimeZone,
  );
  return {
    title: submission.title,
    notes: submission.notes,
    priority: submission.priority,
    ...(task?.due.kind === "timed" &&
    submission.dueDatePreset === "custom" &&
    submission.customDueAtMs === task.due.instantMs
      ? { dueKind: "timed", dueAtMs: task.due.instantMs }
      : selectedDue),
  };
}

function persistTaskFromForm(
  service: TaskService,
  task: Task | undefined,
  submission: TaskSubmission,
  placement: PlacementSelection,
): Task {
  const values = formValues(task, submission);
  return task
    ? service.updateTask(task.id, formToUpdateTask(values, submission.viewerTimeZone))
    : service.createTask(
        formToCreateTask(
          values,
          submission.viewerTimeZone,
          placementFromKey(placement.selectedPlacement, placement.projects, placement.sections),
        ),
      );
}

export function saveTaskFromForm(
  service: TaskService,
  task: Task | undefined,
  submission: TaskSubmission,
  placement: PlacementSelection,
  onSaved: () => void,
): Task {
  const saved = persistTaskFromForm(service, task, submission, placement);
  onSaved();
  return saved;
}

export function moveTaskFromForm(
  service: TaskService,
  taskId: string,
  placement: PlacementSelection,
  onSaved: () => void,
): Task {
  const moved = service.moveTask(
    taskId,
    placementFromKey(placement.selectedPlacement, placement.projects, placement.sections),
  );
  onSaved();
  return moved;
}

export function createQuickTask(
  openSession: () => { service: TaskService; close: () => void },
  submission: Omit<TaskSubmission, "priority">,
  placement: PlacementSelection,
  onCreated: () => void,
): Task {
  const session = openSession();
  let task: Task;
  try {
    task = persistTaskFromForm(session.service, undefined, { ...submission, priority: "none" }, placement);
  } finally {
    session.close();
  }
  onCreated();
  return task;
}
