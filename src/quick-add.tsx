import { Action, ActionPanel, closeMainWindow, Form, Icon, PopToRootType, showToast, Toast } from "@raycast/api";
import { useState } from "react";
import { requestMenuBarRefresh } from "./raycast-commands";
import {
  createOperationScopedTaskEditingMutations,
  TaskEditingInteraction,
  taskEditingPlacementKey,
  type DueDatePreset,
  type TaskEditingFailureField,
} from "./shared/application/task-editing";
import { openProductionWorktodo, type WorktodoSession } from "./shared/application/worktodo";
import type { Project, Section } from "./shared/domain/model";
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
  const [editing] = useState(
    () => new TaskEditingInteraction(createOperationScopedTaskEditingMutations(openProductionWorktodo)),
  );
  const [selectedPlacement, setSelectedPlacement] = useState(() => taskEditingPlacementKey({ kind: "inbox" }));
  const [dueDatePreset, setDueDatePreset] = useState<DueDatePreset>("none");
  const [customDueDate, setCustomDueDate] = useState<Date | null>(null);
  const [titleError, setTitleError] = useState<string>();
  const [dueError, setDueError] = useState<string>();
  const [placementError, setPlacementError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(values: QuickAddFormValues): Promise<boolean> {
    setTitleError(undefined);
    setDueError(undefined);
    setPlacementError(undefined);
    setFormError(undefined);
    if (state.error) {
      return false;
    }

    setIsSubmitting(true);
    const outcome = editing.save(
      undefined,
      {
        title: values.title,
        notes: values.notes,
        priority: "none",
        dueDatePreset,
        customDueAtMs: customDueDate?.getTime() ?? null,
        selectedPlacement,
      },
      { referenceInstantMs, viewerTimeZone, projects: state.projects, sections: state.sections },
    );
    if (outcome.status === "failed") {
      setIsSubmitting(false);
      const setFieldError: Record<TaskEditingFailureField, (message: string) => void> = {
        title: setTitleError,
        due: setDueError,
        placement: setPlacementError,
        form: setFormError,
      };
      setFieldError[outcome.field](outcome.message);
      await showToast(Toast.Style.Failure, "Unable to add task", outcome.message);
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
        error={placementError}
        onChange={(placement) => {
          setSelectedPlacement(placement);
          setPlacementError(undefined);
        }}
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
      {formError ? <Form.Description title="Error" text={formError} /> : null}
      {state.error ? <Form.Description title="Unable to open Worktodo" text={state.error} /> : null}
    </Form>
  );
}
