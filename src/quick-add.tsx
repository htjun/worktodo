import { Action, ActionPanel, closeMainWindow, Form, Icon, showToast, Toast } from "@raycast/api";
import { useEffect, useState } from "react";
import { requestMenuBarRefresh } from "./raycast-commands";
import { openProductionWorktodo, type WorktodoSession } from "./shared/application/worktodo";
import type { Project } from "./shared/domain/model";
import { formToCreateTask } from "./shared/presentation/task-form";

type QuickAddFormValues = {
  title: string;
  projectId: string;
  dueDate: Date | null;
  notes: string;
};

type QuickAddState = {
  session: WorktodoSession | null;
  projects: Project[];
  error: string | null;
};

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred";
}

export default function QuickAdd() {
  const [viewerTimeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [state] = useState<QuickAddState>(() => {
    try {
      const session = openProductionWorktodo();
      return { session, projects: session.service.listProjects(), error: null };
    } catch (error) {
      return { session: null, projects: [], error: messageFrom(error) };
    }
  });
  const [titleError, setTitleError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => () => state.session?.close(), [state.session]);

  async function submit(values: QuickAddFormValues): Promise<boolean> {
    setTitleError(undefined);
    if (values.title.trim().length === 0) {
      setTitleError("Title cannot be empty");
      return false;
    }
    if (!state.session) {
      return false;
    }

    const placement =
      values.projectId === "inbox"
        ? { kind: "inbox" as const }
        : { kind: "project" as const, projectId: values.projectId };
    setIsSubmitting(true);
    try {
      state.session.service.createTask(
        formToCreateTask(
          {
            title: values.title,
            notes: values.notes,
            priority: "none",
            dueKind: values.dueDate ? "allDay" : "none",
            dueAtMs: values.dueDate?.getTime() ?? null,
          },
          viewerTimeZone,
          placement,
        ),
      );
    } catch (error) {
      setIsSubmitting(false);
      await showToast(Toast.Style.Failure, "Unable to add task", messageFrom(error));
      return false;
    }

    requestMenuBarRefresh();
    await showToast(Toast.Style.Success, "Task added");
    await closeMainWindow({ clearRootSearch: true });
    return true;
  }

  return (
    <Form
      navigationTitle="Quick Add"
      isLoading={isSubmitting}
      actions={
        state.session ? (
          <ActionPanel>
            <Action.SubmitForm title="Add Task" icon={Icon.Plus} onSubmit={submit} />
          </ActionPanel>
        ) : undefined
      }
    >
      <Form.TextField id="title" title="Title" autoFocus error={titleError} onChange={() => setTitleError(undefined)} />
      <Form.Dropdown id="projectId" title="Project" defaultValue="inbox">
        <Form.Dropdown.Item value="inbox" title="Inbox" icon={Icon.Tray} />
        {state.projects.map((project) => (
          <Form.Dropdown.Item key={project.id} value={project.id} title={project.name} />
        ))}
      </Form.Dropdown>
      <Form.DatePicker id="dueDate" title="Due Date" type={Form.DatePicker.Type.Date} defaultValue={null} />
      <Form.TextArea id="notes" title="Notes" />
      {state.error ? <Form.Description title="Unable to open Worktodo" text={state.error} /> : null}
    </Form>
  );
}
