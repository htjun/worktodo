import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COMPLETION_FEEDBACK_DURATION_MS,
  CompletionFeedbackController,
} from "../../src/shared/application/completion-feedback";
import type { Task } from "../../src/shared/domain/model";
import { buildTaskListItems, taskListRowPresentation } from "../../src/shared/presentation/task-list";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    title: "Review completion feedback",
    notes: "Keep the original title",
    priority: "medium",
    position: 1_024,
    projectId: null,
    sectionId: null,
    due: { kind: "none" },
    createdAtMs: 1_000,
    updatedAtMs: 1_000,
    completedAtMs: null,
    trashedAtMs: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("completion feedback", () => {
  it("persists before acknowledging and refreshes the list after one second", () => {
    vi.useFakeTimers();
    const stored = task();
    const events: string[] = [];
    let acknowledged = new Map<string, Task>();
    const controller = new CompletionFeedbackController((tasks) => {
      acknowledged = new Map(tasks);
      events.push(tasks.size === 0 ? "acknowledgement cleared" : "acknowledged");
    });
    const completeTask = vi.fn(() => {
      stored.completedAtMs = 2_000;
      stored.updatedAtMs = 2_000;
      events.push("persisted");
      return { ...stored };
    });
    const requestMenuBarRefresh = vi.fn(() => events.push("menu bar refreshed"));
    const refreshList = vi.fn(() => events.push("list refreshed"));

    const result = controller.complete(stored.id, completeTask, requestMenuBarRefresh, refreshList);

    expect(result).toMatchObject({ status: "acknowledged", task: { completedAtMs: 2_000 } });
    expect(events).toEqual(["persisted", "acknowledged", "menu bar refreshed"]);
    expect(acknowledged.get(stored.id)?.completedAtMs).toBe(2_000);
    expect(refreshList).not.toHaveBeenCalled();

    vi.advanceTimersByTime(COMPLETION_FEEDBACK_DURATION_MS - 1);
    expect(acknowledged.has(stored.id)).toBe(true);
    expect(refreshList).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(acknowledged.has(stored.id)).toBe(false);
    expect(refreshList).toHaveBeenCalledOnce();
    expect(events.at(-2)).toBe("acknowledgement cleared");
    expect(events.at(-1)).toBe("list refreshed");
  });

  it("routes repeated keyboard and Action Panel attempts through one pending completion", () => {
    vi.useFakeTimers();
    const source = task();
    const completed = { ...source, completedAtMs: 2_000, updatedAtMs: 2_000 };
    const completeTask = vi.fn(() => completed);
    const requestMenuBarRefresh = vi.fn();
    const controller = new CompletionFeedbackController(() => undefined);
    const runFromShortcut = () => controller.complete(source.id, completeTask, requestMenuBarRefresh, vi.fn());
    const runFromActionPanel = () => controller.complete(source.id, completeTask, requestMenuBarRefresh, vi.fn());

    expect(runFromShortcut().status).toBe("acknowledged");
    expect(runFromActionPanel()).toEqual({ status: "duplicate", task: completed });
    expect(completeTask).toHaveBeenCalledOnce();
    expect(requestMenuBarRefresh).toHaveBeenCalledOnce();
  });

  it("does not acknowledge, refresh, or schedule removal when persistence fails", () => {
    vi.useFakeTimers();
    const onAcknowledgementsChanged = vi.fn();
    const requestMenuBarRefresh = vi.fn();
    const refreshList = vi.fn();
    const controller = new CompletionFeedbackController(onAcknowledgementsChanged);

    expect(() =>
      controller.complete(
        task().id,
        () => {
          throw new Error("database busy");
        },
        requestMenuBarRefresh,
        refreshList,
      ),
    ).toThrow("database busy");
    vi.runAllTimers();

    expect(onAcknowledgementsChanged).not.toHaveBeenCalled();
    expect(requestMenuBarRefresh).not.toHaveBeenCalled();
    expect(refreshList).not.toHaveBeenCalled();
  });

  it("clears pending view feedback without allowing its delayed refresh to run", () => {
    vi.useFakeTimers();
    const source = task();
    const snapshots: number[] = [];
    const refreshList = vi.fn();
    const controller = new CompletionFeedbackController((tasks) => snapshots.push(tasks.size));
    controller.complete(source.id, () => ({ ...source, completedAtMs: 2_000 }), vi.fn(), refreshList);

    controller.reset();
    vi.runAllTimers();

    expect(snapshots).toEqual([1, 0]);
    expect(refreshList).not.toHaveBeenCalled();
  });

  it("cancels unmount work without publishing another state update", () => {
    vi.useFakeTimers();
    const source = task();
    const onAcknowledgementsChanged = vi.fn();
    const refreshList = vi.fn();
    const controller = new CompletionFeedbackController(onAcknowledgementsChanged);
    controller.complete(source.id, () => ({ ...source, completedAtMs: 2_000 }), vi.fn(), refreshList);

    controller.dispose();
    vi.runAllTimers();

    expect(onAcknowledgementsChanged).toHaveBeenCalledOnce();
    expect(refreshList).not.toHaveBeenCalled();
  });

  it("shows checked feedback without changing the task title or source list item", () => {
    const source = task();
    const [item] = buildTaskListItems([{ task: source }], [], [], "Australia/Melbourne");
    const before = structuredClone(item);
    const completed = { ...source, completedAtMs: 2_000, updatedAtMs: 2_000 };

    expect(taskListRowPresentation(item, completed)).toEqual({
      title: source.title,
      accessories: ["Completed"],
      isCompletionAcknowledged: true,
    });
    expect(taskListRowPresentation(item, undefined)).toEqual({
      title: source.title,
      accessories: ["medium priority"],
      isCompletionAcknowledged: false,
    });
    expect(item).toEqual(before);
    expect(source.completedAtMs).toBeNull();
  });
});
