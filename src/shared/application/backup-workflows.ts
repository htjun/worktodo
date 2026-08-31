import type { PortabilityService } from "../portability/portability-service";
import type { PreparedImport } from "../portability/import-preview";
import type { ReplacementResult } from "../portability/replace-backup";

export function replaceBackupIfConfirmed(
  portability: PortabilityService,
  prepared: PreparedImport,
  confirmed: boolean,
  onReplaced: () => void,
): ReplacementResult | null {
  if (!confirmed) {
    return null;
  }
  const result = portability.replace(prepared);
  onReplaced();
  return result;
}
