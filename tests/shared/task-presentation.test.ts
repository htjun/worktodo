import { describe, expect, it } from "vitest";
import type { Project, Section, Task } from "../../src/shared/domain/model";
import { dueDateFormValueForPreset, dueDatePresetForDue } from "../../src/shared/presentation/due-date";
import { lifecycleActionIntentForViewKind } from "../../src/shared/presentation/task-actions";
import { formToCreateTask, formToUpdateTask, taskFormDefaults } from "../../src/shared/presentation/task-form";
import { buildTaskListItems, extractTaskNoteLinks, taskNotesMarkdown } from "../../src/shared/presentation/task-list";
import { placementFromKey, placementKey } from "../../src/shared/presentation/placement";

const project: Project = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Personal",
  position: 1_024,
  createdAtMs: 1_000,
  updatedAtMs: 1_000,
};
const section: Section = {
  id: "00000000-0000-4000-8000-000000000002",
  projectId: project.id,
  name: "Next",
  position: 1_024,
  createdAtMs: 1_000,
  updatedAtMs: 1_000,
};

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "00000000-0000-4000-8000-000000000003",
    title: "Review plan",
    notes: "Open the planning workspace",
    priority: "high",
    position: 1_024,
    projectId: project.id,
    sectionId: section.id,
    due: { kind: "allDay", date: "2026-10-04" },
    createdAtMs: 1_000,
    updatedAtMs: 1_000,
    completedAtMs: null,
    trashedAtMs: null,
    ...overrides,
  };
}

describe("task presentation mapping", () => {
  it("maps the shared due-date presets to local calendar dates", () => {
    const referenceInstantMs = Date.parse("2026-08-30T14:30:00.000Z");
    const baseValues = {
      title: "Review plan",
      notes: "",
      priority: "none" as const,
    };
    const mappedDate = (preset: "today" | "tomorrow" | "endOfWeek") =>
      formToCreateTask(
        {
          ...baseValues,
          ...dueDateFormValueForPreset(preset, null, referenceInstantMs, "Australia/Melbourne"),
        },
        "Australia/Melbourne",
      ).due;

    expect(mappedDate("today")).toEqual({ kind: "allDay", date: "2026-08-31" });
    expect(mappedDate("tomorrow")).toEqual({ kind: "allDay", date: "2026-09-01" });
    expect(mappedDate("endOfWeek")).toEqual({ kind: "allDay", date: "2026-09-06" });
    expect(dueDateFormValueForPreset("none", null, referenceInstantMs, "Australia/Melbourne")).toEqual({
      dueKind: "none",
      dueAtMs: null,
    });
    expect(() => dueDateFormValueForPreset("custom", null, referenceInstantMs, "Australia/Melbourne")).toThrow(
      "Choose a custom due date",
    );
  });

  it("recognizes preset all-day dates and keeps timed values custom", () => {
    const referenceInstantMs = Date.parse("2026-08-30T14:30:00.000Z");
    const presetFor = (due: Task["due"]) => dueDatePresetForDue(due, referenceInstantMs, "Australia/Melbourne");

    expect(presetFor({ kind: "none" })).toBe("none");
    expect(presetFor({ kind: "allDay", date: "2026-08-31" })).toBe("today");
    expect(presetFor({ kind: "allDay", date: "2026-09-01" })).toBe("tomorrow");
    expect(presetFor({ kind: "allDay", date: "2026-09-06" })).toBe("endOfWeek");
    expect(presetFor({ kind: "allDay", date: "2026-09-10" })).toBe("custom");
    expect(presetFor({ kind: "timed", instantMs: referenceInstantMs, timeZone: "Australia/Melbourne" })).toBe("custom");
  });

  it("maps new and edited forms without Raycast-specific values", () => {
    const allDayMs = Date.parse("2026-10-03T14:00:00.000Z");
    const values = {
      title: "Review plan",
      notes: "Details",
      priority: "medium" as const,
      dueKind: "allDay" as const,
      dueAtMs: allDayMs,
    };
    expect(formToCreateTask(values, "Australia/Melbourne")).toEqual({
      title: "Review plan",
      notes: "Details",
      priority: "medium",
      placement: { kind: "inbox" },
      due: { kind: "allDay", date: "2026-10-04" },
    });
    expect(
      formToCreateTask(values, "Australia/Melbourne", {
        kind: "section",
        projectId: project.id,
        sectionId: section.id,
      }).placement,
    ).toEqual({ kind: "section", projectId: project.id, sectionId: section.id });
    expect(formToUpdateTask({ ...values, dueKind: "timed" }, "Australia/Melbourne")).toEqual({
      title: "Review plan",
      notes: "Details",
      priority: "medium",
      due: { kind: "timed", instantMs: allDayMs, timeZone: "Australia/Melbourne" },
    });
    expect(() => formToCreateTask({ ...values, dueAtMs: null }, "Australia/Melbourne")).toThrow("Choose a due date");
    expect(
      formToCreateTask({ ...values, dueAtMs: Date.parse("1960-01-01T14:00:00.000Z") }, "Australia/Melbourne").due,
    ).toEqual({ kind: "allDay", date: "1960-01-02" });
  });

  it("round-trips valid placement selections and rejects missing containers", () => {
    const projectPlacement = { kind: "project", projectId: project.id } as const;
    const sectionPlacement = {
      kind: "section",
      projectId: project.id,
      sectionId: section.id,
    } as const;

    expect(placementFromKey(placementKey({ kind: "inbox" }), [project], [section])).toEqual({ kind: "inbox" });
    expect(placementFromKey(placementKey(projectPlacement), [project], [section])).toEqual(projectPlacement);
    expect(placementFromKey(placementKey(sectionPlacement), [project], [section])).toEqual(sectionPlacement);
    expect(() => placementFromKey(`project:${project.id}`, [], [])).toThrow("Choose an existing project or section");
    expect(() => placementFromKey(`section:${section.id}`, [project], [])).toThrow(
      "Choose an existing project or section",
    );
  });

  it("round-trips task defaults for all due kinds", () => {
    expect(taskFormDefaults(undefined, "Australia/Melbourne")).toEqual({
      title: "",
      notes: "",
      priority: "none",
      dueKind: "none",
      dueAtMs: null,
    });
    expect(taskFormDefaults(task(), "Australia/Melbourne")).toMatchObject({
      title: "Review plan",
      notes: "Open the planning workspace",
      priority: "high",
      dueKind: "allDay",
      dueAtMs: Date.parse("2026-10-03T14:00:00.000Z"),
    });
    expect(
      taskFormDefaults(
        task({ due: { kind: "timed", instantMs: 2_000_000, timeZone: "Australia/Melbourne" } }),
        "America/Los_Angeles",
      ).dueAtMs,
    ).toBe(2_000_000);
  });

  it("preserves query order and supplies due, priority, and placement metadata", () => {
    const first = task();
    const second = task({
      id: "00000000-0000-4000-8000-000000000004",
      title: "Inbox task",
      projectId: null,
      sectionId: null,
      priority: "none",
      due: { kind: "none" },
    });
    const items = buildTaskListItems(
      [{ task: first, todayStatus: "overdue" }, { task: second }],
      [project],
      [section],
      "Australia/Melbourne",
    );
    expect(items.map((item) => item.id)).toEqual([first.id, second.id]);
    expect(items[0]).toMatchObject({
      subtitle: "Personal / Next",
      metadata: ["high priority", "Overdue 2026-10-04"],
      keywords: ["Personal / Next", "Open the planning workspace"],
    });
    expect(items[1]).toMatchObject({ subtitle: "Inbox", metadata: [] });
  });

  it("builds deterministic detail metadata for every placement and due kind", () => {
    const timedAtMs = Date.parse("2026-10-04T02:30:00.000Z");
    const timedLabel = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Australia/Melbourne",
    }).format(new Date(timedAtMs));
    const sourceTasks = [
      task({
        id: "00000000-0000-4000-8000-000000000010",
        projectId: null,
        sectionId: null,
        priority: "none",
        due: { kind: "none" },
      }),
      task({
        id: "00000000-0000-4000-8000-000000000011",
        projectId: project.id,
        sectionId: null,
        priority: "low",
        due: { kind: "allDay", date: "2026-10-04" },
      }),
      task({
        id: "00000000-0000-4000-8000-000000000012",
        priority: "medium",
        due: { kind: "timed", instantMs: timedAtMs, timeZone: "Australia/Melbourne" },
      }),
    ];
    const before = structuredClone(sourceTasks);
    const entries = [
      { task: sourceTasks[0] },
      { task: sourceTasks[1], todayStatus: "overdue" as const },
      { task: sourceTasks[2], todayStatus: "dueToday" as const },
    ];

    const first = buildTaskListItems(entries, [project], [section], "Australia/Melbourne");
    const second = buildTaskListItems(entries, [project], [section], "Australia/Melbourne");

    expect(first.map((item) => item.detail.metadata.slice(0, 3))).toEqual([
      [
        { title: "Project", text: "Inbox" },
        { title: "Priority", text: "None" },
        { title: "Due Date", text: "None" },
      ],
      [
        { title: "Project", text: "Personal" },
        { title: "Priority", text: "Low" },
        { title: "Overdue", text: "2026-10-04" },
      ],
      [
        { title: "Project", text: "Personal / Next" },
        { title: "Priority", text: "Medium" },
        { title: "Today", text: timedLabel },
      ],
    ]);
    expect(second.map((item) => item.detail)).toEqual(first.map((item) => item.detail));
    expect(sourceTasks).toEqual(before);
  });

  it("renders notes literally and extracts distinct valid web links", () => {
    const notes = "# Heading\n- [ ] Use *literal* text\n[Docs](https://example.com/path).";
    expect(taskNotesMarkdown(notes)).toBe(
      "## Notes\n\n\\# Heading  \n\\- \\[ \\] Use \\*literal\\* text  \n\\[Docs\\]\\(https\\:\\/\\/example\\.com\\/path\\)\\.",
    );
    expect(taskNotesMarkdown("")).toBe("## Notes\n\n_No notes_");
    expect(
      extractTaskNoteLinks(
        "https://example.com/path, HTTPS://EXAMPLE.COM/path. https://example.org/a_(b). https://? http://localhost:8080/test ftp://example.net",
      ),
    ).toEqual(["https://example.com/path", "https://example.org/a_(b)", "http://localhost:8080/test"]);
  });

  it("maps lifecycle actions for safe secondary placement", () => {
    for (const viewKind of ["today", "upcoming", "inbox", "project", "section"]) {
      expect(lifecycleActionIntentForViewKind(viewKind)).toEqual({
        kind: "complete",
        title: "Complete Task",
        successTitle: "Task completed",
      });
    }
    expect(lifecycleActionIntentForViewKind("completed")).toEqual({
      kind: "reopen",
      title: "Reopen Task",
      successTitle: "Task reopened",
    });
    expect(lifecycleActionIntentForViewKind("trash")).toEqual({
      kind: "restore",
      title: "Restore Task",
      successTitle: "Task restored",
    });
  });

  it("shows independent completion and trash timestamps", () => {
    const completedAtMs = Date.parse("2026-10-04T01:00:00.000Z");
    const trashedAtMs = Date.parse("2026-10-04T02:00:00.000Z");
    const format = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Australia/Melbourne",
    });
    const [item] = buildTaskListItems(
      [
        {
          task: task({
            priority: "none",
            due: { kind: "none" },
            completedAtMs,
            trashedAtMs,
          }),
        },
      ],
      [project],
      [section],
      "Australia/Melbourne",
    );

    expect(item.metadata).toEqual([
      `Completed ${format.format(new Date(completedAtMs))}`,
      `Trashed ${format.format(new Date(trashedAtMs))}`,
    ]);
    expect(item.detail.metadata).toEqual([
      { title: "Project", text: "Personal / Next" },
      { title: "Priority", text: "None" },
      { title: "Due Date", text: "None" },
      { title: "Created", text: format.format(new Date(1_000)) },
      { title: "Updated", text: format.format(new Date(1_000)) },
      { title: "Completed", text: format.format(new Date(completedAtMs)) },
      { title: "Trashed", text: format.format(new Date(trashedAtMs)) },
    ]);
  });
});
