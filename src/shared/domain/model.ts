export type Priority = "none" | "low" | "medium" | "high";

export type DueValue =
  { kind: "none" } | { kind: "allDay"; date: string } | { kind: "timed"; instantMs: number; timeZone: string };

export type Placement =
  | { kind: "inbox" }
  | { kind: "project"; projectId: string }
  | { kind: "section"; projectId: string; sectionId: string };

export type Project = {
  id: string;
  name: string;
  position: number;
  createdAtMs: number;
  updatedAtMs: number;
};

export type Section = {
  id: string;
  projectId: string;
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
  sectionId: string | null;
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

export function placementOf(task: Pick<Task, "projectId" | "sectionId">): Placement {
  if (task.projectId === null && task.sectionId === null) {
    return { kind: "inbox" };
  }
  if (task.projectId !== null && task.sectionId === null) {
    return { kind: "project", projectId: task.projectId };
  }
  if (task.projectId !== null && task.sectionId !== null) {
    return { kind: "section", projectId: task.projectId, sectionId: task.sectionId };
  }

  throw new DomainError("INVALID_PLACEMENT", "A task section requires a project");
}

export function placementFields(placement: Placement): Pick<Task, "projectId" | "sectionId"> {
  if (placement.kind === "inbox") {
    return { projectId: null, sectionId: null };
  }
  if (placement.kind === "project") {
    return { projectId: placement.projectId, sectionId: null };
  }
  return { projectId: placement.projectId, sectionId: placement.sectionId };
}
