import { Action, ActionPanel, closeMainWindow, Form, Icon, PopToRootType, showToast, Toast } from "@raycast/api";
import { useState } from "react";
import { requestMenuBarRefresh } from "./raycast-commands";
import { createQuickTask } from "./shared/application/task-workflows";
import { openProductionWorktodo, type WorktodoSession } from "./shared/application/worktodo";
import { DomainError, type Project, type Section } from "./shared/domain/model";
import type { DueDatePreset } from "./shared/presentation/due-date";
import { DueDateFields, ProjectDropdown } from "./task-form-controls";

type QuickAddFormValues = {
  title: string;
  notes: string;
};

type QuickAddState = {
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
    let session: WorktodoSession | undefined;
    try {
      session = openProductionWorktodo();
      return {
        projects: session.service.listProjects(),
        sections: session.service.listSections(),
        error: null,
      };
    } catch (error) {
      return { projects: [], sections: [], error: messageFrom(error) };
    } finally {
      session?.close();
    }
  });
  const [selectedPlacement, setSelectedPlacement] = useState("inbox");
  const [dueDatePreset, setDueDatePreset] = useState<DueDatePreset>("none");
  const [customDueDate, setCustomDueDate] = useState<Date | null>(null);
  const [titleError, setTitleError] = useState<string>();
  const [dueError, setDueError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(values: QuickAddFormValues): Promise<boolean> {
    setTitleError(undefined);
    setDueError(undefined);
    if (values.title.trim().length === 0) {
      setTitleError("Title cannot be empty");
      return false;
    }
    if (state.error) {
      return false;
    }

    setIsSubmitting(true);
    try {
      createQuickTask(
        openProductionWorktodo,
        {
          title: values.title,
          notes: values.notes,
          dueDatePreset,
          customDueAtMs: customDueDate?.getTime() ?? null,
          referenceInstantMs,
          viewerTimeZone,
        },
        { selectedPlacement, projects: state.projects, sections: state.sections },
        requestMenuBarRefresh,
      );
    } catch (error) {
      setIsSubmitting(false);
      if (error instanceof DomainError && error.code === "INVALID_DUE_VALUE") {
        setDueError(error.message);
      }
      await showToast(Toast.Style.Failure, "Unable to add task", messageFrom(error));
      return false;
    }

    await showToast(Toast.Style.Success, "Task added");
    await closeMainWindow({ clearRootSearch: true, popToRootType: PopToRootType.Immediate });
    return true;
  }

  return (
    <Form
      navigationTitle="Quick Add"
      isLoading={isSubmitting}
      actions={
        state.error === null ? (
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
