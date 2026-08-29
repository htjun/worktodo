import { describe, expect, it } from "vitest";
import type { DueValue, Priority, Task } from "../../src/shared/domain/model";
import { queryInbox, queryToday, startOfCalendarDate, todayWindow } from "../../src/shared/domain/queries";

function id(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function task(
  index: number,
  due: DueValue,
  options: Partial<
    Pick<Task, "priority" | "position" | "createdAtMs" | "completedAtMs" | "trashedAtMs" | "projectId" | "sectionId">
  > = {},
): Task {
  return {
    id: id(index),
    title: `Task ${index}`,
    notes: "",
    priority: options.priority ?? "none",
    position: options.position ?? 1_024,
    projectId: options.projectId ?? null,
    sectionId: options.sectionId ?? null,
    due,
    createdAtMs: options.createdAtMs ?? 1_000,
    updatedAtMs: 1_000,
    completedAtMs: options.completedAtMs ?? null,
    trashedAtMs: options.trashedAtMs ?? null,
  };
}

describe("Today and Inbox queries", () => {
  it("uses exact 23-hour and 25-hour Melbourne calendar boundaries", () => {
    expect(todayWindow(Date.parse("2026-10-04T01:00:00.000Z"), "Australia/Melbourne")).toEqual({
      localDate: "2026-10-04",
      startOfDayMs: Date.parse("2026-10-03T14:00:00.000Z"),
      startOfNextDayMs: Date.parse("2026-10-04T13:00:00.000Z"),
    });
    expect(todayWindow(Date.parse("2026-04-05T01:00:00.000Z"), "Australia/Melbourne")).toEqual({
      localDate: "2026-04-05",
      startOfDayMs: Date.parse("2026-04-04T13:00:00.000Z"),
      startOfNextDayMs: Date.parse("2026-04-05T14:00:00.000Z"),
    });
  });

  it("reproduces the approved Today boundary and lifecycle truth table", () => {
    const tasks = [
      task(1, { kind: "none" }),
      task(2, { kind: "allDay", date: "2026-10-03" }),
      task(3, { kind: "allDay", date: "2026-10-04" }),
      task(4, { kind: "allDay", date: "2026-10-05" }),
      task(5, { kind: "timed", instantMs: Date.parse("2026-10-03T13:59:59.999Z"), timeZone: "UTC" }),
      task(6, { kind: "timed", instantMs: Date.parse("2026-10-03T14:00:00.000Z"), timeZone: "UTC" }),
      task(7, { kind: "timed", instantMs: Date.parse("2026-10-04T12:59:59.999Z"), timeZone: "UTC" }),
      task(8, { kind: "timed", instantMs: Date.parse("2026-10-04T13:00:00.000Z"), timeZone: "UTC" }),
      task(9, { kind: "allDay", date: "2026-10-04" }, { completedAtMs: 1_000 }),
      task(10, { kind: "allDay", date: "2026-10-04" }, { trashedAtMs: 1_000 }),
    ];
    const result = queryToday(tasks, Date.parse("2026-10-04T01:00:00.000Z"), "Australia/Melbourne");
    expect(result.count).toBe(5);
    expect(result.tasks.map(({ task: value, status }) => [value.id, status])).toEqual([
      [id(2), "overdue"],
      [id(5), "overdue"],
      [id(3), "dueToday"],
      [id(6), "dueToday"],
      [id(7), "dueToday"],
    ]);
  });

  it("preserves all-day calendar meaning while timed classification follows the viewer timezone", () => {
    const allDay = task(1, { kind: "allDay", date: "2026-10-04" });
    const timed = task(2, {
      kind: "timed",
      instantMs: Date.parse("2026-10-05T10:00:00.000Z"),
      timeZone: "Australia/Melbourne",
    });
    const evaluation = Date.parse("2026-10-04T16:00:00.000Z");
    expect(queryToday([allDay, timed], evaluation, "Australia/Melbourne").tasks.map(({ task }) => task.id)).toEqual([
      id(1),
      id(2),
    ]);
    expect(queryToday([allDay, timed], evaluation, "America/Los_Angeles").tasks.map(({ task }) => task.id)).toEqual([
      id(1),
    ]);
  });

  it("applies the complete mixed due and ordinary tie-break ordering", () => {
    const priorities: Priority[] = ["none", "low", "medium", "high"];
    const tasks = priorities.map((priority, index) =>
      task(index + 1, { kind: "allDay", date: "2026-10-04" }, { priority, position: 1_024, createdAtMs: 1_000 }),
    );
    tasks.push(
      task(
        5,
        { kind: "timed", instantMs: Date.parse("2026-10-03T15:00:00.000Z"), timeZone: "UTC" },
        { priority: "none" },
      ),
      task(6, { kind: "allDay", date: "2026-10-03" }, { priority: "none" }),
    );
    const result = queryToday(tasks, Date.parse("2026-10-04T01:00:00.000Z"), "Australia/Melbourne");
    expect(result.tasks.map(({ task }) => task.id)).toEqual([id(6), id(4), id(3), id(2), id(1), id(5)]);
    expect(startOfCalendarDate("2026-10-04", "Australia/Melbourne")).toBe(Date.parse("2026-10-03T14:00:00.000Z"));
  });

  it("returns active incomplete Inbox tasks in canonical ordinary order", () => {
    const tasks = [
      task(1, { kind: "none" }, { priority: "none", position: 1_024 }),
      task(2, { kind: "none" }, { priority: "high", position: 2_048 }),
      task(3, { kind: "none" }, { priority: "high", position: 1_024, createdAtMs: 2_000 }),
      task(4, { kind: "none" }, { completedAtMs: 2_000 }),
      task(5, { kind: "none" }, { trashedAtMs: 2_000 }),
      task(6, { kind: "none" }, { projectId: id(100) }),
    ];
    expect(queryInbox(tasks).map((task) => task.id)).toEqual([id(3), id(2), id(1)]);
  });
});
