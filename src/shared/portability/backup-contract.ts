import { z } from "zod";
import type { Project, Section, Task } from "../domain/model";
import { canonicalizeTimeZone, validateCalendarDate } from "../domain/validation";

export const WORKTODO_BACKUP_FORMAT = "worktodo-backup";
export const WORKTODO_BACKUP_VERSION = 1;

export type WorktodoSnapshot = {
  projects: Project[];
  sections: Section[];
  tasks: Task[];
};

export type WorktodoBackupDocument = WorktodoSnapshot & {
  format: typeof WORKTODO_BACKUP_FORMAT;
  version: typeof WORKTODO_BACKUP_VERSION;
  exportedAtMs: number;
};

export type PortabilityErrorCode =
  | "BROKEN_RELATIONSHIP"
  | "DESTINATION_EXISTS"
  | "DUPLICATE_ID"
  | "FILE_TOO_LARGE"
  | "FILE_WRITE_FAILED"
  | "INVALID_DESTINATION"
  | "INVALID_DOCUMENT"
  | "INVALID_MODEL"
  | "UNSUPPORTED_VERSION";

export class PortabilityError extends Error {
  readonly code: PortabilityErrorCode;

  constructor(code: PortabilityErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "PortabilityError";
    this.code = code;
  }
}

const uuidV4 = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const nonNegativeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const trimmedText = z.string().refine((value) => value.length > 0 && value === value.trim());
const timestampedEntity = {
  createdAtMs: nonNegativeInteger,
  updatedAtMs: nonNegativeInteger,
};

const projectSchema = z
  .strictObject({
    id: uuidV4,
    name: trimmedText,
    position: nonNegativeInteger,
    ...timestampedEntity,
  })
  .refine((value) => value.updatedAtMs >= value.createdAtMs);

const sectionSchema = z
  .strictObject({
    id: uuidV4,
    projectId: uuidV4,
    name: trimmedText,
    position: nonNegativeInteger,
    ...timestampedEntity,
  })
  .refine((value) => value.updatedAtMs >= value.createdAtMs);

const dueSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("none") }),
  z.strictObject({
    kind: z.literal("allDay"),
    date: z.string().refine((value) => {
      try {
        return validateCalendarDate(value) === value;
      } catch {
        return false;
      }
    }),
  }),
  z.strictObject({
    kind: z.literal("timed"),
    instantMs: nonNegativeInteger,
    timeZone: z.string().refine((value) => {
      try {
        return canonicalizeTimeZone(value) === value;
      } catch {
        return false;
      }
    }),
  }),
]);

const taskSchema = z
  .strictObject({
    id: uuidV4,
    title: trimmedText,
    notes: z.string(),
    priority: z.enum(["none", "low", "medium", "high"]),
    position: nonNegativeInteger,
    projectId: uuidV4.nullable(),
    sectionId: uuidV4.nullable(),
    due: dueSchema,
    ...timestampedEntity,
    completedAtMs: nonNegativeInteger.nullable(),
    trashedAtMs: nonNegativeInteger.nullable(),
  })
  .refine((value) => value.updatedAtMs >= value.createdAtMs)
  .refine((value) => value.completedAtMs === null || value.completedAtMs >= value.createdAtMs)
  .refine((value) => value.completedAtMs === null || value.completedAtMs <= value.updatedAtMs)
  .refine((value) => value.trashedAtMs === null || value.trashedAtMs >= value.createdAtMs)
  .refine((value) => value.trashedAtMs === null || value.trashedAtMs <= value.updatedAtMs)
  .refine((value) => value.sectionId === null || value.projectId !== null);

const backupSchema = z.strictObject({
  format: z.literal(WORKTODO_BACKUP_FORMAT),
  version: z.literal(WORKTODO_BACKUP_VERSION),
  exportedAtMs: nonNegativeInteger,
  projects: z.array(projectSchema),
  sections: z.array(sectionSchema),
  tasks: z.array(taskSchema),
});

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function rejectUnsupportedVersion(value: unknown): void {
  const candidate = record(value);
  if (candidate?.format === WORKTODO_BACKUP_FORMAT && candidate.version !== WORKTODO_BACKUP_VERSION) {
    throw new PortabilityError(
      "UNSUPPORTED_VERSION",
      `This Worktodo backup uses version ${String(candidate.version)}. This version of Worktodo supports version 1.`,
    );
  }
}

function rejectDuplicates(collection: string, ids: string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new PortabilityError("DUPLICATE_ID", `The backup contains a duplicate ${collection} ID.`);
    }
    seen.add(id);
  }
}

function validateRelationships(document: WorktodoBackupDocument): void {
  rejectDuplicates(
    "project",
    document.projects.map((project) => project.id),
  );
  rejectDuplicates(
    "section",
    document.sections.map((section) => section.id),
  );
  rejectDuplicates(
    "task",
    document.tasks.map((task) => task.id),
  );

  const projects = new Set(document.projects.map((project) => project.id));
  const sections = new Map(document.sections.map((section) => [section.id, section]));

  for (const section of document.sections) {
    if (!projects.has(section.projectId)) {
      throw new PortabilityError("BROKEN_RELATIONSHIP", "A backup section references a missing project.");
    }
  }

  for (const task of document.tasks) {
    if (task.projectId !== null && !projects.has(task.projectId)) {
      throw new PortabilityError("BROKEN_RELATIONSHIP", "A backup task references a missing project.");
    }
    if (task.sectionId !== null) {
      const section = sections.get(task.sectionId);
      if (!section || section.projectId !== task.projectId) {
        throw new PortabilityError(
          "BROKEN_RELATIONSHIP",
          "A backup task references a missing section or a section in another project.",
        );
      }
    }
  }
}

function compareId(left: { id: string }, right: { id: string }): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export function canonicalBackupDocument(document: WorktodoBackupDocument): WorktodoBackupDocument {
  return {
    ...document,
    projects: [...document.projects].sort(compareId),
    sections: [...document.sections].sort(compareId),
    tasks: [...document.tasks].sort(compareId),
  };
}

export function parseBackupDocument(value: unknown): WorktodoBackupDocument {
  rejectUnsupportedVersion(value);
  const parsed = backupSchema.safeParse(value);
  if (!parsed.success) {
    throw new PortabilityError("INVALID_MODEL", "This file is not a valid Worktodo backup.", parsed.error);
  }
  const document = parsed.data as WorktodoBackupDocument;
  validateRelationships(document);
  return document;
}

export function parseBackupJson(value: string): WorktodoBackupDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new PortabilityError("INVALID_DOCUMENT", "This file does not contain valid JSON.", error);
  }
  return parseBackupDocument(parsed);
}

export function createBackupDocument(exportedAtMs: number, snapshot: WorktodoSnapshot): WorktodoBackupDocument {
  return parseBackupDocument({
    format: WORKTODO_BACKUP_FORMAT,
    version: WORKTODO_BACKUP_VERSION,
    exportedAtMs,
    ...snapshot,
  });
}

export function serializeBackupDocument(document: WorktodoBackupDocument): string {
  const valid = parseBackupDocument(document);
  return `${JSON.stringify(canonicalBackupDocument(valid), null, 2)}\n`;
}
