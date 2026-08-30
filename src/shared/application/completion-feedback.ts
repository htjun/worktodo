import type { Task } from "../domain/model";

export const COMPLETION_FEEDBACK_DURATION_MS = 1_000;

export type CompletionFeedbackAttempt = { status: "acknowledged"; task: Task } | { status: "duplicate"; task: Task };

type CompletionFeedbackScheduler = {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
};

type PendingCompletion = {
  task: Task;
  timer: unknown;
};

const systemScheduler: CompletionFeedbackScheduler = {
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class CompletionFeedbackController {
  private readonly pending = new Map<string, PendingCompletion>();

  constructor(
    private readonly onAcknowledgementsChanged: (tasks: ReadonlyMap<string, Task>) => void,
    private readonly scheduler: CompletionFeedbackScheduler = systemScheduler,
  ) {}

  complete(
    taskId: string,
    completeTask: () => Task,
    requestMenuBarRefresh: () => void,
    refreshList: () => void,
  ): CompletionFeedbackAttempt {
    const existing = this.pending.get(taskId);
    if (existing) {
      return { status: "duplicate", task: existing.task };
    }

    const task = completeTask();
    const pending: PendingCompletion = { task, timer: undefined };
    this.pending.set(taskId, pending);
    this.emit();
    requestMenuBarRefresh();
    pending.timer = this.scheduler.schedule(() => {
      if (this.pending.get(taskId) !== pending) {
        return;
      }
      this.pending.delete(taskId);
      this.emit();
      refreshList();
    }, COMPLETION_FEEDBACK_DURATION_MS);

    return { status: "acknowledged", task };
  }

  reset(): void {
    if (this.pending.size === 0) {
      return;
    }
    this.cancelPending();
    this.emit();
  }

  dispose(): void {
    this.cancelPending();
  }

  private cancelPending(): void {
    for (const { timer } of this.pending.values()) {
      this.scheduler.cancel(timer);
    }
    this.pending.clear();
  }

  private emit(): void {
    this.onAcknowledgementsChanged(new Map([...this.pending].map(([taskId, pending]) => [taskId, pending.task])));
  }
}
