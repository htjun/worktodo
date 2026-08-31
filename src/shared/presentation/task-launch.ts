import { isStaticTaskViewKind, type StaticTaskViewKind } from "../application/task-views";

export type MyTasksLaunchContext = {
  view?: StaticTaskViewKind;
  selectedTaskId?: string;
  createTask?: boolean;
};

export type ParsedMyTasksLaunchContext = {
  view: StaticTaskViewKind;
  selectedTaskId: string | undefined;
  createTask: boolean;
  isShowingDetail: boolean;
};

export function parseMyTasksLaunchContext(value: unknown): ParsedMyTasksLaunchContext {
  const context = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const view = context.view;
  const selectedTaskId =
    typeof context.selectedTaskId === "string" && context.selectedTaskId.trim().length > 0
      ? context.selectedTaskId
      : undefined;

  return {
    view: isStaticTaskViewKind(view) ? view : "all",
    selectedTaskId,
    createTask: context.createTask === true,
    isShowingDetail: selectedTaskId !== undefined,
  };
}

export type { StaticTaskViewKind } from "../application/task-views";
