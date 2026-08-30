import type { TimedTaskHistoryState } from "../application/timed-task-history";

export type TimedTaskHistoryPresentation = {
  title: "Undo Complete Task" | "Redo Complete Task" | "Undo Move to Trash" | "Redo Move to Trash";
  successTitle: "Task reopened" | "Task completed" | "Task restored" | "Task moved to Trash";
};

export function timedTaskHistoryPresentation(state: TimedTaskHistoryState): TimedTaskHistoryPresentation {
  if (state.kind === "complete") {
    return state.direction === "undo"
      ? { title: "Undo Complete Task", successTitle: "Task reopened" }
      : { title: "Redo Complete Task", successTitle: "Task completed" };
  }
  return state.direction === "undo"
    ? { title: "Undo Move to Trash", successTitle: "Task restored" }
    : { title: "Redo Move to Trash", successTitle: "Task moved to Trash" };
}
