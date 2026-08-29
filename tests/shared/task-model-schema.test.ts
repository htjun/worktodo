import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractTaskModelSchema, validateTaskModelSchema } from "../../src/shared/sqlite-spike/task-model";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("task model schema design", () => {
  it("round-trips every valid placement and rejects invalid relational states", async () => {
    const directory = await mkdtemp(join(tmpdir(), "worktodo-task-model-test-"));
    temporaryDirectories.push(directory);
    const markdown = await readFile(join(process.cwd(), "docs", "research", "task-model.md"), "utf8");
    const schema = extractTaskModelSchema(markdown);

    expect(validateTaskModelSchema(join(directory, "task-model.sqlite"), schema)).toEqual({
      schemaVersion: 1,
      strictTables: ["projects", "sections", "tasks"],
      requiredIndexes: [
        "projects_order_idx",
        "sections_project_order_idx",
        "tasks_all_day_today_idx",
        "tasks_completed_idx",
        "tasks_inbox_order_idx",
        "tasks_project_fk_idx",
        "tasks_section_project_fk_idx",
        "tasks_timed_today_idx",
        "tasks_trashed_idx",
      ],
      validRoundTrips: 3,
      rejectedCases: [
        "section without project",
        "missing project",
        "cross-project section",
        "invalid priority",
        "none due with date",
        "all-day due without date",
        "timed due without timezone",
        "reversed timestamps",
        "parent deletion with tasks",
      ],
      integrity: "ok",
      foreignKeyViolations: 0,
      pragmas: {
        journalMode: "delete",
        synchronous: 2,
        foreignKeys: 1,
        busyTimeout: 2_000,
      },
    });
  });

  it("rejects documentation without the canonical schema marker", () => {
    expect(() => extractTaskModelSchema("```sql\nSELECT 1;\n```\n")).toThrow("marked SQL schema block");
  });
});
