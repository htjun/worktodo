import { showHUD, type LaunchProps } from "@raycast/api";
import { openProductionWorktodo } from "./shared/application/worktodo";

type QuickAddArguments = {
  title: string;
};

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred";
}

export default async function QuickAdd(props: LaunchProps<{ arguments: QuickAddArguments }>): Promise<void> {
  let session;

  try {
    session = openProductionWorktodo();
    session.service.createTask({
      title: props.arguments.title,
      placement: { kind: "inbox" },
    });
  } catch (error) {
    await showHUD(`Unable to add task: ${messageFrom(error)}`);
    return;
  } finally {
    session?.close();
  }

  await showHUD("Task added to Inbox", { clearRootSearch: true });
}
