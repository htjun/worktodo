import { afterEach, describe, expect, it, vi } from "vitest";
import {
  performTimedTaskHistoryOperation,
  TIMED_TASK_HISTORY_DURATION_MS,
  TimedTaskHistoryController,
} from "../../src/shared/application/timed-task-history";
import { timedTaskHistoryPresentation } from "../../src/shared/presentation/task-history";

afterEach(() => {
  vi.useRealTimers();
});

describe("timed task history", () => {
  it("records one Undo step and expires without running a task operation", () => {
    vi.useFakeTimers();
    const snapshots: Array<string | null> = [];
    const controller = new TimedTaskHistoryController((state) => snapshots.push(state?.direction ?? null));
    const operation = vi.fn();

    controller.record({ kind: "complete", taskId: "task-1", taskTitle: "Submit report" });

    expect(controller.state).toEqual({
      direction: "undo",
      kind: "complete",
      taskId: "task-1",
      taskTitle: "Submit report",
    });
    vi.advanceTimersByTime(TIMED_TASK_HISTORY_DURATION_MS - 1);
    expect(controller.state?.direction).toBe("undo");

    vi.advanceTimersByTime(1);
    expect(controller.state).toBeNull();
    expect(operation).not.toHaveBeenCalled();
    expect(snapshots).toEqual(["undo", null]);
  });

  it("replaces the previous task and cancels its expiry", () => {
    vi.useFakeTimers();
    const controller = new TimedTaskHistoryController(() => undefined);
    controller.record({ kind: "complete", taskId: "task-1", taskTitle: "First" });
    vi.advanceTimersByTime(6_000);

    controller.record({ kind: "trash", taskId: "task-2", taskTitle: "Second" });
    vi.advanceTimersByTime(4_000);

    expect(controller.state).toMatchObject({ kind: "trash", taskId: "task-2", direction: "undo" });
    vi.advanceTimersByTime(6_000);
    expect(controller.state).toBeNull();
  });

  it("toggles Undo and Redo with a fresh window after each successful operation", () => {
    vi.useFakeTimers();
    const controller = new TimedTaskHistoryController(() => undefined);
    const undo = vi.fn();
    const redo = vi.fn();
    controller.record({ kind: "trash", taskId: "task-1", taskTitle: "Review draft" });
    vi.advanceTimersByTime(9_000);

    const undoState = controller.state;
    expect(undoState).not.toBeNull();
    expect(controller.perform(undoState!, undo)).toMatchObject({
      status: "performed",
      previous: { direction: "undo" },
      state: { direction: "redo" },
    });
    vi.advanceTimersByTime(9_000);
    expect(controller.state?.direction).toBe("redo");

    const redoState = controller.state;
    expect(redoState).not.toBeNull();
    expect(controller.perform(redoState!, redo)).toMatchObject({
      status: "performed",
      previous: { direction: "redo" },
      state: { direction: "undo" },
    });
    vi.advanceTimersByTime(9_999);
    expect(controller.state?.direction).toBe("undo");
    vi.advanceTimersByTime(1);
    expect(controller.state).toBeNull();
    expect(undo).toHaveBeenCalledOnce();
    expect(redo).toHaveBeenCalledOnce();
  });

  it("does not run or transition when the requested direction is unavailable", () => {
    vi.useFakeTimers();
    const controller = new TimedTaskHistoryController(() => undefined);
    const operation = vi.fn();

    expect(
      controller.perform(
        { direction: "undo", kind: "complete", taskId: "task-1", taskTitle: "Submit report" },
        operation,
      ),
    ).toEqual({ status: "unavailable" });
    controller.record({ kind: "complete", taskId: "task-1", taskTitle: "Submit report" });
    expect(
      controller.perform(
        { direction: "redo", kind: "complete", taskId: "task-1", taskTitle: "Submit report" },
        operation,
      ),
    ).toEqual({ status: "unavailable" });
    expect(controller.state?.direction).toBe("undo");
    expect(operation).not.toHaveBeenCalled();
  });

  it("keeps the current step and original expiry when an operation fails", () => {
    vi.useFakeTimers();
    const snapshots: Array<string | null> = [];
    const controller = new TimedTaskHistoryController((state) => snapshots.push(state?.direction ?? null));
    controller.record({ kind: "complete", taskId: "task-1", taskTitle: "Submit report" });
    vi.advanceTimersByTime(9_000);

    expect(() =>
      controller.perform(controller.state!, () => {
        throw new Error("database busy");
      }),
    ).toThrow("database busy");
    expect(controller.state?.direction).toBe("undo");
    expect(snapshots).toEqual(["undo"]);

    vi.advanceTimersByTime(1_000);
    expect(controller.state).toBeNull();
  });

  it("does not let a replaced toast state operate on the current task", () => {
    vi.useFakeTimers();
    const controller = new TimedTaskHistoryController(() => undefined);
    const stale = controller.record({ kind: "complete", taskId: "task-1", taskTitle: "First" });
    controller.record({ kind: "trash", taskId: "task-2", taskTitle: "Second" });
    const operation = vi.fn();

    expect(controller.perform(stale, operation)).toEqual({ status: "unavailable" });
    expect(operation).not.toHaveBeenCalled();
    expect(controller.state).toMatchObject({ taskId: "task-2", kind: "trash" });
  });

  it("clears explicitly and disposes without publishing an unmount update", () => {
    vi.useFakeTimers();
    const snapshots: Array<string | null> = [];
    const controller = new TimedTaskHistoryController((state) => snapshots.push(state?.direction ?? null));
    controller.record({ kind: "complete", taskId: "task-1", taskTitle: "Submit report" });
    controller.clear();
    vi.runAllTimers();
    expect(snapshots).toEqual(["undo", null]);

    controller.record({ kind: "trash", taskId: "task-2", taskTitle: "Review draft" });
    controller.dispose();
    vi.runAllTimers();
    expect(controller.state).toBeNull();
    expect(snapshots).toEqual(["undo", null, "undo"]);
  });

  it("presents explicit lifecycle Undo and Redo outcomes", () => {
    expect(
      timedTaskHistoryPresentation({
        direction: "undo",
        kind: "complete",
        taskId: "task-1",
        taskTitle: "Submit report",
      }),
    ).toEqual({ title: "Undo Complete Task", successTitle: "Task reopened" });
    expect(
      timedTaskHistoryPresentation({
        direction: "redo",
        kind: "complete",
        taskId: "task-1",
        taskTitle: "Submit report",
      }),
    ).toEqual({ title: "Redo Complete Task", successTitle: "Task completed" });
    expect(
      timedTaskHistoryPresentation({
        direction: "undo",
        kind: "trash",
        taskId: "task-1",
        taskTitle: "Submit report",
      }),
    ).toEqual({ title: "Undo Move to Trash", successTitle: "Task restored" });
    expect(
      timedTaskHistoryPresentation({
        direction: "redo",
        kind: "trash",
        taskId: "task-1",
        taskTitle: "Submit report",
      }),
    ).toEqual({ title: "Redo Move to Trash", successTitle: "Task moved to Trash" });
  });

  it.each([
    ["complete Undo", { direction: "undo", kind: "complete" }, "reopen"],
    ["complete Redo", { direction: "redo", kind: "complete" }, "complete"],
    ["trash Undo", { direction: "undo", kind: "trash" }, "restore"],
    ["trash Redo", { direction: "redo", kind: "trash" }, "trash"],
  ] as const)("maps %s to the matching domain operation", (_title, state, expected) => {
    const operations = {
      complete: vi.fn(),
      reopen: vi.fn(),
      trash: vi.fn(),
      restore: vi.fn(),
    };

    performTimedTaskHistoryOperation({ ...state, taskId: "task-1", taskTitle: "Submit report" }, operations);

    expect(operations[expected]).toHaveBeenCalledOnce();
    expect(Object.values(operations).reduce((count, operation) => count + operation.mock.calls.length, 0)).toBe(1);
  });
});
