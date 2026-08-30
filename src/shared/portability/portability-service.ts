import type { ReplaceableTaskRepository, ReplacementResult } from "./replace-backup";
import { exportBackup, readSnapshot, type ExportBackupResult } from "./export-backup";
import { prepareImport, type PreparedImport } from "./import-preview";
import { replaceFromBackup } from "./replace-backup";

export class PortabilityService {
  constructor(
    private readonly repository: ReplaceableTaskRepository,
    private readonly recoveryDirectory: string,
    private readonly now: () => number,
  ) {}

  exportTo(directory: string): ExportBackupResult {
    return exportBackup(this.repository, directory, this.now());
  }

  prepare(path: string): PreparedImport {
    return prepareImport(path, () => this.repository.transaction(() => readSnapshot(this.repository)));
  }

  replace(prepared: PreparedImport): ReplacementResult {
    return replaceFromBackup(this.repository, prepared.document, this.recoveryDirectory, this.now());
  }
}
