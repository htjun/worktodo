export type StaticTaskViewKind = "today" | "upcoming" | "inbox" | "completed" | "trash";

export type MyTasksLaunchContext = {
  view?: StaticTaskViewKind;
  selectedTaskId?: string;
  createTask?: boolean;
};

export type ParsedMyTasksLaunchContext = {
  view: StaticTaskViewKind;
  selectedTaskId: string | undefined;
  createTask: boolean;
};

export function parseMyTasksLaunchContext(value: unknown): ParsedMyTasksLaunchContext {
  const context = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const view = context.view;
  const selectedTaskId = context.selectedTaskId;

  return {
    view:
      view === "today" || view === "upcoming" || view === "inbox" || view === "completed" || view === "trash"
        ? view
        : "today",
    selectedTaskId: typeof selectedTaskId === "string" && selectedTaskId.trim().length > 0 ? selectedTaskId : undefined,
    createTask: context.createTask === true,
  };
}
