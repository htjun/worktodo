import type { TaskLifecycleHistoryState, TaskLifecycleMutationKind } from "../application/task-lifecycle-interaction";

export type TaskLifecycleMutationPresentation = {
  title: "Complete Task" | "Reopen Task" | "Move to Trash" | "Restore Task";
  successTitle: "Task completed" | "Task reopened" | "Task moved to Trash" | "Task restored";
};

export function taskLifecycleMutationPresentation(
  operation: TaskLifecycleMutationKind,
): TaskLifecycleMutationPresentation {
  switch (operation) {
    case "complete":
      return { title: "Complete Task", successTitle: "Task completed" };
    case "reopen":
      return { title: "Reopen Task", successTitle: "Task reopened" };
    case "trash":
      return { title: "Move to Trash", successTitle: "Task moved to Trash" };
    case "restore":
      return { title: "Restore Task", successTitle: "Task restored" };
  }
}

export function taskLifecycleHistoryTitle(
  state: TaskLifecycleHistoryState,
): "Undo Complete Task" | "Redo Complete Task" | "Undo Move to Trash" | "Redo Move to Trash" {
  if (state.kind === "complete") {
    return state.direction === "undo" ? "Undo Complete Task" : "Redo Complete Task";
  }
  return state.direction === "undo" ? "Undo Move to Trash" : "Redo Move to Trash";
}
