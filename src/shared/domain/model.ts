export type Priority = "none" | "low" | "medium" | "high";

export type DueValue =
  { kind: "none" } | { kind: "allDay"; date: string } | { kind: "timed"; instantMs: number; timeZone: string };

export type Placement = { kind: "inbox" } | { kind: "project"; projectId: string };

export type Project = {
  id: string;
  name: string;
  position: number;
  createdAtMs: number;
  updatedAtMs: number;
};

export type Label = {
  id: string;
  name: string;
  position: number;
  createdAtMs: number;
  updatedAtMs: number;
};

export type Task = {
  id: string;
  title: string;
  notes: string;
  priority: Priority;
  position: number;
  projectId: string | null;
  labelIds: string[];
  due: DueValue;
  createdAtMs: number;
  updatedAtMs: number;
  completedAtMs: number | null;
  trashedAtMs: number | null;
};

export type DomainErrorCode =
  "INVALID_ARGUMENT" | "INVALID_DUE_VALUE" | "INVALID_PLACEMENT" | "NOT_FOUND" | "TASK_TRASHED";

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

export function placementOf(task: Pick<Task, "projectId">): Placement {
  if (task.projectId === null) {
    return { kind: "inbox" };
  }
  return { kind: "project", projectId: task.projectId };
}

export function placementFields(placement: Placement): Pick<Task, "projectId"> {
  if (placement.kind === "inbox") {
    return { projectId: null };
  }
  return { projectId: placement.projectId };
}
