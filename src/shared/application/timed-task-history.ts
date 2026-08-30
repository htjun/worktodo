export const TIMED_TASK_HISTORY_DURATION_MS = 10_000;

export type TimedTaskActionKind = "complete" | "trash";
export type TimedTaskHistoryDirection = "undo" | "redo";

export type TimedTaskHistoryState = {
  direction: TimedTaskHistoryDirection;
  kind: TimedTaskActionKind;
  taskId: string;
  taskTitle: string;
};

export type TimedTaskHistoryAttempt =
  { status: "performed"; previous: TimedTaskHistoryState; state: TimedTaskHistoryState } | { status: "unavailable" };

export type TimedTaskHistoryScheduler = {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
};

export type TimedTaskHistoryOperations = {
  complete(): void;
  reopen(): void;
  trash(): void;
  restore(): void;
};

export function performTimedTaskHistoryOperation(
  state: TimedTaskHistoryState,
  operations: TimedTaskHistoryOperations,
): void {
  if (state.kind === "complete") {
    if (state.direction === "undo") {
      operations.reopen();
    } else {
      operations.complete();
    }
  } else if (state.direction === "undo") {
    operations.restore();
  } else {
    operations.trash();
  }
}

type TimedTaskHistoryEntry = {
  state: TimedTaskHistoryState;
  timer: unknown;
};

const systemScheduler: TimedTaskHistoryScheduler = {
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class TimedTaskHistoryController {
  private entry: TimedTaskHistoryEntry | null = null;

  constructor(
    private readonly onStateChanged: (state: TimedTaskHistoryState | null) => void,
    private readonly scheduler: TimedTaskHistoryScheduler = systemScheduler,
  ) {}

  get state(): TimedTaskHistoryState | null {
    return this.entry?.state ?? null;
  }

  record(action: Omit<TimedTaskHistoryState, "direction">): TimedTaskHistoryState {
    return this.replace({ ...action, direction: "undo" });
  }

  perform(expected: TimedTaskHistoryState, operation: () => void): TimedTaskHistoryAttempt {
    const current = this.entry;
    if (!current || !sameState(current.state, expected)) {
      return { status: "unavailable" };
    }

    operation();
    const state = this.replace({
      ...current.state,
      direction: current.state.direction === "undo" ? "redo" : "undo",
    });
    return { status: "performed", previous: current.state, state };
  }

  clear(): void {
    if (!this.entry) {
      return;
    }
    this.cancelTimer();
    this.entry = null;
    this.onStateChanged(null);
  }

  dispose(): void {
    this.cancelTimer();
    this.entry = null;
  }

  private replace(state: TimedTaskHistoryState): TimedTaskHistoryState {
    this.cancelTimer();
    const entry: TimedTaskHistoryEntry = { state, timer: undefined };
    this.entry = entry;
    entry.timer = this.scheduler.schedule(() => {
      if (this.entry !== entry) {
        return;
      }
      this.entry = null;
      this.onStateChanged(null);
    }, TIMED_TASK_HISTORY_DURATION_MS);
    this.onStateChanged(state);
    return state;
  }

  private cancelTimer(): void {
    if (this.entry) {
      this.scheduler.cancel(this.entry.timer);
    }
  }
}

function sameState(left: TimedTaskHistoryState, right: TimedTaskHistoryState): boolean {
  return (
    left.direction === right.direction &&
    left.kind === right.kind &&
    left.taskId === right.taskId &&
    left.taskTitle === right.taskTitle
  );
}
