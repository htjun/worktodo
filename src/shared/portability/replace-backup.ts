import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { TaskRepository } from "../domain/repository";
import {
  createBackupDocument,
  parseBackupDocument,
  PortabilityError,
  serializeBackupDocument,
  type WorktodoBackupDocument,
} from "./backup-contract";
import { ensurePrivateDirectory, publishBackupFile } from "./backup-file";
import { backupFilename, readSnapshot } from "./export-backup";
import { countSnapshot, type BackupCounts } from "./import-preview";

export interface ReplaceableTaskRepository extends TaskRepository {
  deleteAllTasks(): void;
  deleteAllSections(): void;
  deleteAllProjects(): void;
  assertIntegrity(): void;
}

export type ReplacementResult = {
  recoveryPath: string;
  replaced: BackupCounts;
};

export class ImportReplacementError extends PortabilityError {
  readonly recoveryPath: string | undefined;

  constructor(cause: unknown, recoveryPath?: string) {
    super("IMPORT_FAILED", "Worktodo could not replace its data. Worktodo data was not changed.", cause);
    this.name = "ImportReplacementError";
    this.recoveryPath = recoveryPath;
  }
}

export function resolveRecoveryDirectory(homeDirectory = homedir()): string {
  if (!isAbsolute(homeDirectory)) {
    throw new Error("The Worktodo home directory must be absolute");
  }
  return join(homeDirectory, "Library", "Application Support", "Worktodo", "Backups");
}

function replaceRows(repository: ReplaceableTaskRepository, document: WorktodoBackupDocument): void {
  repository.deleteAllTasks();
  repository.deleteAllSections();
  repository.deleteAllProjects();
  document.projects.forEach((project) => repository.insertProject(project));
  document.sections.forEach((section) => repository.insertSection(section));
  document.tasks.forEach((task) => repository.insertTask(task));
}

function assertExactReplacement(repository: ReplaceableTaskRepository, document: WorktodoBackupDocument): void {
  repository.assertIntegrity();
  const stored = createBackupDocument(document.exportedAtMs, readSnapshot(repository));
  if (serializeBackupDocument(stored) !== serializeBackupDocument(document)) {
    throw new Error("The replacement database does not match the selected backup");
  }
}

export function replaceFromBackup(
  repository: ReplaceableTaskRepository,
  documentValue: WorktodoBackupDocument,
  recoveryDirectory: string,
  replacementAtMs = Date.now(),
): ReplacementResult {
  const document = parseBackupDocument(documentValue);
  ensurePrivateDirectory(recoveryDirectory);
  let recoveryPath: string | undefined;

  try {
    return repository.transaction(() => {
      const current = createBackupDocument(replacementAtMs, readSnapshot(repository));
      recoveryPath = publishBackupFile(
        recoveryDirectory,
        backupFilename(replacementAtMs),
        serializeBackupDocument(current),
      );
      replaceRows(repository, document);
      assertExactReplacement(repository, document);
      return { recoveryPath, replaced: countSnapshot(document) };
    });
  } catch (error) {
    throw new ImportReplacementError(error, recoveryPath);
  }
}
