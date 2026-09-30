import type { Task } from "../domain/model";
import type { TaskOrderDirection } from "../domain/task-order";
import type { TaskService } from "../domain/task-service";
import { buildTaskViewSections } from "../presentation/task-views";
import { loadTaskView, type TaskView, type TaskViewContext } from "./task-views";

export type TaskOrderingContext = TaskViewContext & {
  view: TaskView;
  searchText: string;
  isLoading: boolean;
};

export type TaskOrderingResult =
  | { status: "moved"; selectedTaskId: string }
  | { status: "unavailable" | "unchanged" }
  | { status: "failed"; error: unknown };

export function canReorderTask(task: Task, context: Pick<TaskOrderingContext, "view" | "searchText" | "isLoading">) {
  return (
    context.view.kind === "today" &&
    context.searchText.length === 0 &&
    !context.isLoading &&
    task.completedAtMs === null &&
    task.trashedAtMs === null
  );
}

export function reorderTaskInView(
  service: TaskService,
  taskId: string,
  direction: TaskOrderDirection,
  context: TaskOrderingContext,
  onMoved: (taskId: string) => void,
): TaskOrderingResult {
  if (context.view.kind !== "today" || context.searchText.length > 0 || context.isLoading) {
    return { status: "unavailable" };
  }
  try {
    const sections = buildTaskViewSections(
      loadTaskView(service, context.view, context),
      service.listProjects(),
      service.listLabels(),
    );
    const group = sections.find((section) => section.items.some((item) => item.id === taskId));
    if (!group) {
      return { status: "unavailable" };
    }
    if (
      !service.reorderTask(
        taskId,
        direction,
        group.items.map((item) => item.id),
      )
    ) {
      return { status: "unchanged" };
    }
    onMoved(taskId);
    return { status: "moved", selectedTaskId: taskId };
  } catch (error) {
    return { status: "failed", error };
  }
}
