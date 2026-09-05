import { Color, Icon } from "@raycast/api";
import type { TaskView } from "./shared/application/task-views";

export function activeTaskIcon(priority: boolean) {
  return priority ? { source: Icon.Circle, tintColor: Color.Red } : Icon.Circle;
}

export function menuBarTaskIcon(priority: boolean) {
  return priority ? activeTaskIcon(true) : { source: Icon.Circle, tintColor: Color.SecondaryText };
}

export function taskListIcon(view: TaskView, priority: boolean, isCompletionAcknowledged: boolean) {
  if (isCompletionAcknowledged || view.kind === "completed") {
    return Icon.CheckCircle;
  }
  if (view.kind === "trash") {
    return Icon.Trash;
  }
  return activeTaskIcon(priority);
}
