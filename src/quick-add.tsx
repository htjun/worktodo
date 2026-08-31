import { Action, ActionPanel, closeMainWindow, Form, Icon, PopToRootType, showToast, Toast } from "@raycast/api";
import { useEffect, useState } from "react";
import { requestMenuBarRefresh } from "./raycast-commands";
import { openProductionWorktodo, type WorktodoSession } from "./shared/application/worktodo";
import { DomainError, type Project, type Section } from "./shared/domain/model";
import { dueDateFormValueForPreset, type DueDatePreset } from "./shared/presentation/due-date";
import { placementFromKey } from "./shared/presentation/placement";
import { formToCreateTask } from "./shared/presentation/task-form";
import { DueDateFields, ProjectDropdown } from "./task-form-controls";

type QuickAddFormValues = {
  title: string;
  notes: string;
};

type QuickAddState = {
  session: WorktodoSession | null;
  projects: Project[];
  sections: Section[];
  error: string | null;
};

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred";
}

export default function QuickAdd() {
  const [viewerTimeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [referenceInstantMs] = useState(Date.now);
  const [state] = useState<QuickAddState>(() => {
    let session: WorktodoSession | null = null;
    try {
      session = openProductionWorktodo();
      return {
        session,
        projects: session.service.listProjects(),
        sections: session.service.listSections(),
        error: null,
      };
    } catch (error) {
      session?.close();
      return { session: null, projects: [], sections: [], error: messageFrom(error) };
    }
  });
  const [selectedPlacement, setSelectedPlacement] = useState("inbox");
  const [dueDatePreset, setDueDatePreset] = useState<DueDatePreset>("none");
  const [customDueDate, setCustomDueDate] = useState<Date | null>(null);
  const [titleError, setTitleError] = useState<string>();
  const [dueError, setDueError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => () => state.session?.close(), [state.session]);

  async function submit(values: QuickAddFormValues): Promise<boolean> {
    setTitleError(undefined);
    setDueError(undefined);
    if (values.title.trim().length === 0) {
      setTitleError("Title cannot be empty");
      return false;
    }
    if (!state.session) {
      return false;
    }

    setIsSubmitting(true);
    try {
      const placement = placementFromKey(selectedPlacement, state.projects, state.sections);
      const due = dueDateFormValueForPreset(
        dueDatePreset,
        customDueDate?.getTime() ?? null,
        referenceInstantMs,
        viewerTimeZone,
      );
      state.session.service.createTask(
        formToCreateTask(
          {
            title: values.title,
            notes: values.notes,
            priority: "none",
            ...due,
          },
          viewerTimeZone,
          placement,
        ),
      );
    } catch (error) {
      setIsSubmitting(false);
      if (error instanceof DomainError && error.code === "INVALID_DUE_VALUE") {
        setDueError(error.message);
      }
      await showToast(Toast.Style.Failure, "Unable to add task", messageFrom(error));
      return false;
    }

    requestMenuBarRefresh();
    await showToast(Toast.Style.Success, "Task added");
    await closeMainWindow({ clearRootSearch: true, popToRootType: PopToRootType.Immediate });
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
      <ProjectDropdown
        projects={state.projects}
        sections={state.sections}
        value={selectedPlacement}
        onChange={setSelectedPlacement}
      />
      <DueDateFields
        preset={dueDatePreset}
        customDate={customDueDate}
        error={dueError}
        onPresetChange={(preset) => {
          setDueDatePreset(preset);
          setDueError(undefined);
        }}
        onCustomDateChange={(date) => {
          setCustomDueDate(date);
          setDueError(undefined);
        }}
      />
      <Form.TextArea id="notes" title="Notes" />
      {state.error ? <Form.Description title="Unable to open Worktodo" text={state.error} /> : null}
    </Form>
  );
}
