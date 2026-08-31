import { launchCommand, LaunchType } from "@raycast/api";
import type { MyTasksLaunchContext } from "./shared/presentation/task-launch";

export function launchMyTasks(context: MyTasksLaunchContext): Promise<void> {
  return launchCommand({ name: "my-tasks", type: LaunchType.UserInitiated, context });
}

export function requestMenuBarRefresh(): void {
  void launchCommand({ name: "menu-bar", type: LaunchType.Background }).catch(() => undefined);
}
