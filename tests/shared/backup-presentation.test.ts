import { describe, expect, it } from "vitest";
import { ImportReplacementError } from "../../src/shared/portability/replace-backup";
import type { ImportPreview } from "../../src/shared/portability/import-preview";
import {
  exportSuccessMarkdown,
  failurePresentation,
  importPreviewMarkdown,
  importSuccessMarkdown,
} from "../../src/shared/presentation/backup-restore";

const preview: ImportPreview = {
  formatVersion: 1,
  exportedAtMs: Date.parse("2026-08-30T06:25:30.123Z"),
  incoming: {
    projects: 2,
    sections: 3,
    tasks: 10,
    lifecycle: { activeIncomplete: 4, activeCompleted: 3, trashedIncomplete: 2, trashedCompleted: 1 },
  },
  current: {
    projects: 1,
    sections: 1,
    tasks: 4,
    lifecycle: { activeIncomplete: 1, activeCompleted: 1, trashedIncomplete: 1, trashedCompleted: 1 },
  },
  confirmationTitle: "Replace Worktodo Data",
  warning: "This will replace all current Worktodo data. Cancelling changes nothing.",
};

describe("backup and restore presentation", () => {
  it("renders the approved replacement preview with mutually exclusive counts", () => {
    const markdown = importPreviewMarkdown(preview);
    expect(markdown).toContain("# Replace Worktodo Data");
    expect(markdown).toContain("This will replace all current Worktodo data. Cancelling changes nothing.");
    expect(markdown).toContain("Exported: 2026-08-30T06:25:30.123Z");
    expect(markdown).toContain("| Tasks | 4 | 10 |");
    expect(markdown).toContain("| Active incomplete | 1 | 4 |");
    expect(markdown).toContain("| Trashed completed | 1 | 1 |");
  });

  it("renders an allowed timestamp outside the JavaScript Date range without crashing", () => {
    expect(importPreviewMarkdown({ ...preview, exportedAtMs: Number.MAX_SAFE_INTEGER })).toContain(
      `${Number.MAX_SAFE_INTEGER} ms since Unix epoch`,
    );
  });

  it("shows the exact export and recovery paths after success", () => {
    expect(exportSuccessMarkdown("/tmp/worktodo-backup.json")).toContain("/tmp/worktodo-backup.json");
    expect(importSuccessMarkdown("/tmp/recovery.json")).toContain("/tmp/recovery.json");
  });

  it("states that import failures did not change production and preserves recovery actions", () => {
    const error = new ImportReplacementError(new Error("injected"), "/tmp/recovery.json");
    expect(failurePresentation(error, "import")).toEqual({
      title: "Backup import failed",
      message: "Worktodo could not replace its data. Worktodo data was not changed.",
      recoveryPath: "/tmp/recovery.json",
    });
    expect(failurePresentation(new Error("Invalid file"), "import").message).toBe(
      "Invalid file Worktodo data was not changed.",
    );
  });

  it("states that export failures did not change task data", () => {
    expect(failurePresentation(new Error("Destination exists"), "export")).toEqual({
      title: "Backup export failed",
      message: "Destination exists Worktodo data was not changed.",
    });
  });
});
