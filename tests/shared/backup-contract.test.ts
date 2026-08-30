import { describe, expect, it } from "vitest";
import {
  canonicalBackupDocument,
  createBackupDocument,
  parseBackupDocument,
  parseBackupJson,
  PortabilityError,
  serializeBackupDocument,
  type WorktodoBackupDocument,
} from "../../src/shared/portability/backup-contract";

function id(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function completeDocument(): WorktodoBackupDocument {
  return createBackupDocument(9_000, {
    projects: [
      { id: id(2), name: "Personal", position: 1_024, createdAtMs: 100, updatedAtMs: 200 },
      { id: id(1), name: "Work", position: 1_024, createdAtMs: 100, updatedAtMs: 100 },
    ],
    sections: [
      {
        id: id(4),
        projectId: id(1),
        name: "Later",
        position: 1_024,
        createdAtMs: 200,
        updatedAtMs: 200,
      },
      {
        id: id(3),
        projectId: id(1),
        name: "Next",
        position: 1_024,
        createdAtMs: 100,
        updatedAtMs: 100,
      },
    ],
    tasks: [
      {
        id: id(8),
        title: "Trashed and completed",
        notes: "Unicode note: café ☕",
        priority: "high",
        position: 1_024,
        projectId: id(1),
        sectionId: id(3),
        due: { kind: "timed", instantMs: 8_000, timeZone: "Australia/Melbourne" },
        createdAtMs: 100,
        updatedAtMs: 400,
        completedAtMs: 300,
        trashedAtMs: 400,
      },
      {
        id: id(7),
        title: "Trashed incomplete",
        notes: "",
        priority: "medium",
        position: 1_024,
        projectId: id(1),
        sectionId: null,
        due: { kind: "allDay", date: "2028-02-29" },
        createdAtMs: 100,
        updatedAtMs: 300,
        completedAtMs: null,
        trashedAtMs: 300,
      },
      {
        id: id(6),
        title: "Completed inbox",
        notes: "Plain notes",
        priority: "low",
        position: 1_024,
        projectId: null,
        sectionId: null,
        due: { kind: "none" },
        createdAtMs: 100,
        updatedAtMs: 200,
        completedAtMs: 200,
        trashedAtMs: null,
      },
      {
        id: id(5),
        title: "Active inbox",
        notes: "",
        priority: "none",
        position: 1_024,
        projectId: null,
        sectionId: null,
        due: { kind: "none" },
        createdAtMs: 100,
        updatedAtMs: 100,
        completedAtMs: null,
        trashedAtMs: null,
      },
    ],
  });
}

function expectCode(operation: () => unknown, code: PortabilityError["code"]): void {
  try {
    operation();
    throw new Error("Expected a portability error");
  } catch (error) {
    expect(error).toBeInstanceOf(PortabilityError);
    expect((error as PortabilityError).code).toBe(code);
  }
}

describe("Worktodo backup contract", () => {
  it("round-trips every supported state as deterministic readable JSON", () => {
    const document = completeDocument();
    const serialized = serializeBackupDocument(document);

    expect(serialized.endsWith("\n")).toBe(true);
    expect(serialized).toContain('\n  "format": "worktodo-backup"');
    expect(parseBackupJson(serialized)).toEqual(canonicalBackupDocument(document));
    expect(parseBackupJson(serialized).projects.map((project) => project.id)).toEqual([id(1), id(2)]);
    expect(parseBackupJson(serialized).tasks.map((task) => task.id)).toEqual([id(5), id(6), id(7), id(8)]);
  });

  it("rejects malformed JSON and unsupported versions with bounded codes", () => {
    expectCode(() => parseBackupJson("{"), "INVALID_DOCUMENT");
    expectCode(() => parseBackupDocument({ ...completeDocument(), version: 2 }), "UNSUPPORTED_VERSION");
    const missingVersion: Record<string, unknown> = { ...completeDocument() };
    delete missingVersion.version;
    expectCode(() => parseBackupDocument(missingVersion), "INVALID_MODEL");
  });

  it.each([
    ["unknown top-level fields", (document: WorktodoBackupDocument) => ({ ...document, unexpected: true })],
    [
      "unknown entity fields",
      (document: WorktodoBackupDocument) => ({
        ...document,
        projects: [{ ...document.projects[0], unexpected: true }, ...document.projects.slice(1)],
      }),
    ],
    [
      "uppercase UUIDs",
      (document: WorktodoBackupDocument) => ({
        ...document,
        projects: [
          { ...document.projects[0], id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" },
          ...document.projects.slice(1),
        ],
      }),
    ],
    [
      "untrimmed names",
      (document: WorktodoBackupDocument) => ({
        ...document,
        projects: [{ ...document.projects[0], name: " Personal " }, ...document.projects.slice(1)],
      }),
    ],
    [
      "unsafe positions",
      (document: WorktodoBackupDocument) => ({
        ...document,
        tasks: [{ ...document.tasks[0], position: Number.MAX_SAFE_INTEGER + 1 }, ...document.tasks.slice(1)],
      }),
    ],
    [
      "invalid lifecycle timestamps",
      (document: WorktodoBackupDocument) => ({
        ...document,
        tasks: [{ ...document.tasks[0], completedAtMs: 99 }, ...document.tasks.slice(1)],
      }),
    ],
    [
      "invalid calendar dates",
      (document: WorktodoBackupDocument) => ({
        ...document,
        tasks: [{ ...document.tasks[0], due: { kind: "allDay", date: "2026-02-30" } }, ...document.tasks.slice(1)],
      }),
    ],
    [
      "non-canonical timezones",
      (document: WorktodoBackupDocument) => ({
        ...document,
        tasks: [{ ...document.tasks[0], due: { kind: "timed", instantMs: 1, timeZone: "US/Eastern" } }],
      }),
    ],
  ])("rejects %s", (_label, mutate) => {
    expectCode(() => parseBackupDocument(mutate(completeDocument())), "INVALID_MODEL");
  });

  it("rejects duplicate IDs within an entity collection", () => {
    const document = completeDocument();
    expectCode(
      () => parseBackupDocument({ ...document, tasks: [...document.tasks, { ...document.tasks[0] }] }),
      "DUPLICATE_ID",
    );
  });

  it.each([
    [
      "a missing section project",
      (document: WorktodoBackupDocument) => ({
        ...document,
        sections: [{ ...document.sections[0], projectId: id(999) }, ...document.sections.slice(1)],
      }),
    ],
    [
      "a missing task project",
      (document: WorktodoBackupDocument) => ({
        ...document,
        tasks: [{ ...document.tasks[0], projectId: id(999) }, ...document.tasks.slice(1)],
      }),
    ],
    [
      "a cross-project task section",
      (document: WorktodoBackupDocument) => ({
        ...document,
        tasks: [{ ...document.tasks[0], projectId: id(2) }, ...document.tasks.slice(1)],
      }),
    ],
  ])("rejects %s", (_label, mutate) => {
    expectCode(() => parseBackupDocument(mutate(completeDocument())), "BROKEN_RELATIONSHIP");
  });
});
