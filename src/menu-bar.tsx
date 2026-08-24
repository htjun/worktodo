import { Icon, LaunchType, MenuBarExtra, launchCommand } from "@raycast/api";

export default function Command() {
  return (
    <MenuBarExtra icon={Icon.CheckCircle} title="0" tooltip="Worktodo">
      <MenuBarExtra.Item
        icon={Icon.List}
        title="Open My Tasks"
        onAction={() => launchCommand({ name: "my-tasks", type: LaunchType.UserInitiated })}
      />
      <MenuBarExtra.Separator />
      <MenuBarExtra.Item icon={Icon.Info} title="Foundation setup" subtitle="No tasks yet" />
    </MenuBarExtra>
  );
}
