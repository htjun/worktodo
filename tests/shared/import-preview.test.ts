import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBackupDocument,
  PortabilityError,
  serializeBackupDocument,
  type WorktodoSnapshot,
} from "../../src/shared/portability/backup-contract";
import { buildImportPreview, prepareImport, readBackupFile } from "../../src/shared/portability/import-preview";

const temporaryDirectories: string[] = [];

function id(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function populatedSnapshot(): WorktodoSnapshot {
  return {
    projects: [{ id: id(1), name: "Work", position: 1_024, createdAtMs: 100, updatedAtMs: 100 }],
    sections: [
      {
        id: id(2),
        projectId: id(1),
        name: "Next",
        position: 1_024,
        createdAtMs: 100,
        updatedAtMs: 100,
      },
    ],
    tasks: [task(3, null, null), task(4, 200, null), task(5, null, 300), task(6, 200, 300)],
  };
}

function task(index: number, completedAtMs: number | null, trashedAtMs: number | null) {
  return {
    id: id(index),
    title: `Task ${index}`,
    notes: "",
    priority: "none" as const,
    position: 1_024,
    projectId: null,
    sectionId: null,
    due: { kind: "none" as const },
    createdAtMs: 100,
    updatedAtMs: Math.max(completedAtMs ?? 100, trashedAtMs ?? 100),
    completedAtMs,
    trashedAtMs,
  };
}

async function temporaryPath(name: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "worktodo-import-preview-test-"));
  temporaryDirectories.push(directory);
  return join(directory, name);
}

function expectCode(operation: () => unknown, code: PortabilityError["code"]): PortabilityError {
  try {
    operation();
    throw new Error("Expected a portability error");
  } catch (error) {
    expect(error).toBeInstanceOf(PortabilityError);
    expect((error as PortabilityError).code).toBe(code);
    return error as PortabilityError;
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Worktodo import validation and preview", () => {
  it("reads one complete UTF-8 JSON backup and reports mutually exclusive counts", async () => {
    const path = await temporaryPath("backup.json");
    const document = createBackupDocument(9_000, populatedSnapshot());
    await writeFile(path, serializeBackupDocument(document), "utf8");

    expect(readBackupFile(path)).toEqual(document);
    expect(buildImportPreview(document, { projects: [], sections: [], tasks: [] })).toEqual({
      formatVersion: 1,
      exportedAtMs: 9_000,
      incoming: {
        projects: 1,
        sections: 1,
        tasks: 4,
        lifecycle: {
          activeIncomplete: 1,
          activeCompleted: 1,
          trashedIncomplete: 1,
          trashedCompleted: 1,
        },
      },
      current: {
        projects: 0,
        sections: 0,
        tasks: 0,
        lifecycle: {
          activeIncomplete: 0,
          activeCompleted: 0,
          trashedIncomplete: 0,
          trashedCompleted: 0,
        },
      },
      confirmationTitle: "Replace Worktodo Data",
      warning: "This will replace all current Worktodo data. Cancelling changes nothing.",
    });
  });

  it("validates the selected file before reading current production state", async () => {
    const path = await temporaryPath("invalid.json");
    await writeFile(path, "{", "utf8");
    const readCurrent = vi.fn(() => populatedSnapshot());

    const error = expectCode(() => prepareImport(path, readCurrent), "INVALID_DOCUMENT");
    expect(error.message).toContain("Worktodo data was not changed.");
    expect(readCurrent).not.toHaveBeenCalled();
  });

  it.each([
    ["relative paths", () => readBackupFile("backup.json"), "INVALID_IMPORT_FILE"],
    ["wrong extensions", () => readBackupFile("/tmp/backup.txt"), "INVALID_IMPORT_FILE"],
  ])("rejects %s", (_label, operation, code) => {
    expectCode(operation, code as PortabilityError["code"]);
  });

  it("rejects missing files, directories, oversized files, and invalid UTF-8", async () => {
    const missing = await temporaryPath("missing.json");
    expectCode(() => readBackupFile(missing), "INVALID_IMPORT_FILE");

    const directoryPath = await temporaryPath("directory.json");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(directoryPath));
    expectCode(() => readBackupFile(directoryPath), "INVALID_IMPORT_FILE");

    const oversized = await temporaryPath("oversized.json");
    await writeFile(oversized, "12345", "utf8");
    expectCode(() => readBackupFile(oversized, 4), "FILE_TOO_LARGE");

    const invalidUtf8 = await temporaryPath("invalid-utf8.json");
    await writeFile(invalidUtf8, Buffer.from([0xff]));
    expectCode(() => readBackupFile(invalidUtf8), "INVALID_DOCUMENT");
  });

  it("calls the current snapshot reader only after a valid document", async () => {
    const path = await temporaryPath("backup.json");
    await writeFile(path, serializeBackupDocument(createBackupDocument(9_000, populatedSnapshot())), "utf8");
    const current = { projects: [], sections: [], tasks: [] };
    const readCurrent = vi.fn(() => current);

    const prepared = prepareImport(path, readCurrent);
    expect(readCurrent).toHaveBeenCalledOnce();
    expect(prepared.preview.current.tasks).toBe(0);
    expect(prepared.document.tasks).toHaveLength(4);
  });
});
