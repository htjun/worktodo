import type { TaskRepository } from "../domain/repository";
import {
  createBackupDocument,
  serializeBackupDocument,
  type WorktodoBackupDocument,
  type WorktodoSnapshot,
} from "./backup-contract";
import { publishBackupFile } from "./backup-file";

export type ExportBackupResult = {
  document: WorktodoBackupDocument;
  path: string;
};

export function backupFilename(exportedAtMs: number): string {
  const date = new Date(exportedAtMs);
  if (!Number.isSafeInteger(exportedAtMs) || exportedAtMs < 0 || Number.isNaN(date.getTime())) {
    throw new Error("Backup timestamp must be a valid non-negative safe integer");
  }
  return `worktodo-backup-${date.toISOString().replace(/[-:.]/g, "")}.json`;
}

export function captureBackupDocument(repository: TaskRepository, exportedAtMs: number): WorktodoBackupDocument {
  return repository.transaction(() => createBackupDocument(exportedAtMs, readSnapshot(repository)));
}

export function readSnapshot(repository: TaskRepository): WorktodoSnapshot {
  return {
    projects: repository.listProjects(),
    sections: repository.listSections(),
    tasks: repository.listTasks(),
  };
}

export function exportBackup(
  repository: TaskRepository,
  directory: string,
  exportedAtMs = Date.now(),
): ExportBackupResult {
  const document = captureBackupDocument(repository, exportedAtMs);
  const path = publishBackupFile(directory, backupFilename(exportedAtMs), serializeBackupDocument(document));
  return { document, path };
}
