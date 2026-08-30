export type TaskLifecycleActionIntent = {
  kind: "complete" | "reopen" | "restore";
  title: "Complete Task" | "Reopen Task" | "Restore Task";
  successTitle: "Task completed" | "Task reopened" | "Task restored";
};

export const TASK_LIFECYCLE_SHORTCUT: { modifiers: ["cmd"]; key: "enter" } = {
  modifiers: ["cmd"],
  key: "enter",
};

export function lifecycleActionIntentForViewKind(viewKind: string): TaskLifecycleActionIntent {
  if (viewKind === "trash") {
    return { kind: "restore", title: "Restore Task", successTitle: "Task restored" };
  }
  if (viewKind === "completed") {
    return { kind: "reopen", title: "Reopen Task", successTitle: "Task reopened" };
  }
  return { kind: "complete", title: "Complete Task", successTitle: "Task completed" };
}
