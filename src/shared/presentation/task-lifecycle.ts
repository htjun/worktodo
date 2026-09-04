import type { TaskLifecycleHistoryState, TaskLifecycleMutationKind } from "../application/task-lifecycle-interaction";

export type TaskLifecycleMutationPresentation = {
  title: "Complete task" | "Reopen task" | "Move to trash" | "Restore task";
  successTitle: "Task completed" | "Task reopened" | "Task moved to trash" | "Task restored";
  failureTitle:
    "Unable to complete task" | "Unable to reopen task" | "Unable to move task to trash" | "Unable to restore task";
};

export function taskLifecycleMutationPresentation(
  operation: TaskLifecycleMutationKind,
): TaskLifecycleMutationPresentation {
  switch (operation) {
    case "complete":
      return { title: "Complete task", successTitle: "Task completed", failureTitle: "Unable to complete task" };
    case "reopen":
      return { title: "Reopen task", successTitle: "Task reopened", failureTitle: "Unable to reopen task" };
    case "trash":
      return {
        title: "Move to trash",
        successTitle: "Task moved to trash",
        failureTitle: "Unable to move task to trash",
      };
    case "restore":
      return { title: "Restore task", successTitle: "Task restored", failureTitle: "Unable to restore task" };
  }
}

export function taskLifecycleHistoryTitle(
  state: TaskLifecycleHistoryState,
): "Undo completion" | "Redo completion" | "Undo move to trash" | "Redo move to trash" {
  if (state.kind === "complete") {
    return state.direction === "undo" ? "Undo completion" : "Redo completion";
  }
  return state.direction === "undo" ? "Undo move to trash" : "Redo move to trash";
}
