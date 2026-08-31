import { launchCommand, LaunchType } from "@raycast/api";
import type { MenuBarLaunchAction } from "./shared/presentation/menu-bar";
import type { MyTasksLaunchContext } from "./shared/presentation/task-launch";

export function launchMyTasks(context: MyTasksLaunchContext): Promise<void> {
  return launchCommand({ name: "my-tasks", type: LaunchType.UserInitiated, context });
}

export function requestMenuBarRefresh(): void {
  void launchCommand({ name: "menu-bar", type: LaunchType.Background }).catch(() => undefined);
}

export function launchMenuBarAction(context: MenuBarLaunchAction): Promise<void> {
  return launchCommand({ name: "menu-bar", type: LaunchType.UserInitiated, context });
}
