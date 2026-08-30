import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TaskRepository } from "../../src/shared/domain/repository";
import {
  createBackupDocument,
  parseBackupJson,
  type WorktodoBackupDocument,
  type WorktodoSnapshot,
} from "../../src/shared/portability/backup-contract";
import { backupFilename, readSnapshot } from "../../src/shared/portability/export-backup";
import {
  ImportReplacementError,
  replaceFromBackup,
  resolveRecoveryDirectory,
  type ReplaceableTaskRepository,
} from "../../src/shared/portability/replace-backup";
import { openWorktodoDatabase } from "../../src/shared/storage/database";
import { applyMigrations } from "../../src/shared/storage/schema";
import { SqliteTaskRepository } from "../../src/shared/storage/sqlite-task-repository";

const temporaryDirectories: string[] = [];

function id(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function snapshot(offset: number): WorktodoSnapshot {
  const projectId = id(offset + 1);
  const sectionId = id(offset + 2);
  return {
    projects: [{ id: projectId, name: `Project ${offset}`, position: 1_024, createdAtMs: 100, updatedAtMs: 100 }],
    sections: [
      {
        id: sectionId,
        projectId,
        name: `Section ${offset}`,
        position: 1_024,
        createdAtMs: 100,
        updatedAtMs: 100,
      },
    ],
    tasks: [
      {
        id: id(offset + 3),
        title: `Task ${offset}`,
        notes: "Preserved notes",
        priority: "high",
        position: 1_024,
        projectId,
        sectionId,
        due: { kind: "timed", instantMs: 10_000, timeZone: "Australia/Melbourne" },
        createdAtMs: 100,
        updatedAtMs: 300,
        completedAtMs: 200,
        trashedAtMs: 300,
      },
    ],
  };
}

async function createContext(initial: WorktodoSnapshot) {
  const directory = await mkdtemp(join(tmpdir(), "worktodo-replacement-test-"));
  temporaryDirectories.push(directory);
  const db = openWorktodoDatabase(join(directory, "worktodo.sqlite"));
  applyMigrations(db);
  const repository = new SqliteTaskRepository(db);
  repository.transaction(() => {
    initial.projects.forEach((project) => repository.insertProject(project));
    initial.sections.forEach((section) => repository.insertSection(section));
    initial.tasks.forEach((task) => repository.insertTask(task));
  });
  return { db, directory, repository, recoveryDirectory: join(directory, "Backups") };
}

function failAfter(
  repository: SqliteTaskRepository,
  method: keyof ReplaceableTaskRepository,
): ReplaceableTaskRepository {
  return new Proxy(repository as ReplaceableTaskRepository, {
    get(target, property) {
      const value = target[property as keyof ReplaceableTaskRepository];
      if (typeof value !== "function") {
        return value;
      }
      return (...args: unknown[]) => {
        const result = Reflect.apply(value, target, args);
        if (property === method) {
          throw new Error(`Injected failure after ${String(method)}`);
        }
        return result;
      };
    },
  });
}

function storedDocument(repository: TaskRepository, exportedAtMs: number): WorktodoBackupDocument {
  return createBackupDocument(exportedAtMs, readSnapshot(repository));
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Worktodo backup replacement", () => {
  it("publishes recovery before replacing every stored value exactly", async () => {
    const initial = snapshot(0);
    const incoming = createBackupDocument(8_000, snapshot(100));
    const { db, repository, recoveryDirectory } = await createContext(initial);
    try {
      const result = replaceFromBackup(repository, incoming, recoveryDirectory, 9_000);

      expect(storedDocument(repository, incoming.exportedAtMs)).toEqual(incoming);
      expect(result.replaced).toMatchObject({ projects: 1, sections: 1, tasks: 1 });
      expect(parseBackupJson(await readFile(result.recoveryPath, "utf8"))).toEqual(
        createBackupDocument(9_000, initial),
      );
    } finally {
      db.close();
    }
  });

  it.each([
    "deleteAllTasks",
    "deleteAllSections",
    "deleteAllProjects",
    "insertProject",
    "insertSection",
    "insertTask",
    "assertIntegrity",
  ] as const)("rolls back exact prior state when %s fails", async (method) => {
    const initial = snapshot(0);
    const incoming = createBackupDocument(8_000, snapshot(100));
    const { db, repository, recoveryDirectory } = await createContext(initial);
    try {
      let error: unknown;
      try {
        replaceFromBackup(failAfter(repository, method), incoming, recoveryDirectory, 9_000);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(ImportReplacementError);
      expect((error as ImportReplacementError).recoveryPath).toBe(join(recoveryDirectory, backupFilename(9_000)));
      expect(storedDocument(repository, 9_000)).toEqual(createBackupDocument(9_000, initial));
    } finally {
      db.close();
    }
  });

  it("does not mutate production when recovery publication fails", async () => {
    const initial = snapshot(0);
    const incoming = createBackupDocument(8_000, snapshot(100));
    const { db, repository, recoveryDirectory } = await createContext(initial);
    try {
      await mkdir(recoveryDirectory);
      const collision = join(recoveryDirectory, backupFilename(9_000));
      await writeFile(collision, "existing", "utf8");

      expect(() => replaceFromBackup(repository, incoming, recoveryDirectory, 9_000)).toThrow(ImportReplacementError);
      expect(storedDocument(repository, 9_000)).toEqual(createBackupDocument(9_000, initial));
      await expect(readFile(collision, "utf8")).resolves.toBe("existing");
    } finally {
      db.close();
    }
  });

  it("can restore the replaced state from the recovery artifact", async () => {
    const initial = snapshot(0);
    const incoming = createBackupDocument(8_000, snapshot(100));
    const { db, directory, repository, recoveryDirectory } = await createContext(initial);
    try {
      const replacement = replaceFromBackup(repository, incoming, recoveryDirectory, 9_000);
      const recovery = parseBackupJson(await readFile(replacement.recoveryPath, "utf8"));
      const secondRecoveryDirectory = join(directory, "Restore Backups");

      replaceFromBackup(repository, recovery, secondRecoveryDirectory, 10_000);
      expect(storedDocument(repository, recovery.exportedAtMs)).toEqual(recovery);
    } finally {
      db.close();
    }
  });

  it("resolves the owner-local recovery directory", () => {
    expect(resolveRecoveryDirectory("/Users/example")).toBe(
      "/Users/example/Library/Application Support/Worktodo/Backups",
    );
    expect(() => resolveRecoveryDirectory("relative")).toThrow("must be absolute");
  });
});
