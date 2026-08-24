import { Icon, List } from "@raycast/api";

export default function Command() {
  return (
    <List>
      <List.EmptyView
        icon={Icon.CheckCircle}
        title="Worktodo is ready"
        description="Task storage is not configured yet."
      />
    </List>
  );
}
