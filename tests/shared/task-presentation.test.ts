import { describe, expect, it } from "vitest";
import type { Project, Section, Task } from "../../src/shared/domain/model";
import { formToCreateTask, formToUpdateTask, taskFormDefaults } from "../../src/shared/presentation/task-form";
import { buildTaskListItems } from "../../src/shared/presentation/task-list";

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
    expect(formToUpdateTask({ ...values, dueKind: "timed" }, "Australia/Melbourne")).toEqual({
      title: "Review plan",
      notes: "Details",
      priority: "medium",
      due: { kind: "timed", instantMs: allDayMs, timeZone: "Australia/Melbourne" },
    });
    expect(() => formToCreateTask({ ...values, dueAtMs: null }, "Australia/Melbourne")).toThrow("Choose a due date");
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
});
