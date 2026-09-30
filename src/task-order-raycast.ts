import { Icon, Keyboard } from "@raycast/api";
import type { TaskOrderDirection } from "./shared/domain/task-order";

export function taskOrderActionPresentation(direction: TaskOrderDirection) {
  return direction === "up"
    ? { title: "Move Up", icon: Icon.ArrowUp, shortcut: Keyboard.Shortcut.Common.MoveUp }
    : { title: "Move Down", icon: Icon.ArrowDown, shortcut: Keyboard.Shortcut.Common.MoveDown };
}
