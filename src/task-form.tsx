import { Action, ActionPanel, Form, Icon, showToast, Toast, useNavigation } from "@raycast/api";
import { useMemo, useState } from "react";
import { moveTaskFromForm, saveTaskFromForm } from "./shared/application/task-workflows";
import {
  DomainError,
  placementOf,
  type Placement,
  type Priority,
  type Project,
  type Section,
  type Task,
} from "./shared/domain/model";
import type { TaskService } from "./shared/domain/task-service";
import { taskFormDefaults } from "./shared/presentation/task-form";
import { placementKey } from "./shared/presentation/placement";
import { dueDatePresetForDue } from "./shared/presentation/due-date";
import { DueDateFields, ProjectDropdown } from "./task-form-controls";

type FormValues = {
  title: string;
  notes: string;
};

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred";
}

export function TaskForm({
  service,
  task,
  projects,
  sections,
  initialPlacement,
  viewerTimeZone,
  onSaved,
}: {
  service: TaskService;
  task?: Task;
  projects: readonly Project[];
  sections: readonly Section[];
  initialPlacement: Placement;
  viewerTimeZone: string;
  onSaved: () => void;
}) {
  const { pop } = useNavigation();
  const [referenceInstantMs] = useState(Date.now);
  const defaults = useMemo(() => taskFormDefaults(task, viewerTimeZone), [task, viewerTimeZone]);
  const [priority, setPriority] = useState<Priority>(defaults.priority);
  const [dueDatePreset, setDueDatePreset] = useState(() =>
    dueDatePresetForDue(task?.due ?? { kind: "none" }, referenceInstantMs, viewerTimeZone),
  );
  const [customDueDate, setCustomDueDate] = useState<Date | null>(() =>
    defaults.dueAtMs === null ? null : new Date(defaults.dueAtMs),
  );
  const [selectedPlacement, setSelectedPlacement] = useState(() => placementKey(initialPlacement));
  const [titleError, setTitleError] = useState<string>();
  const [dueError, setDueError] = useState<string>();
  const [formError, setFormError] = useState<string>();

  async function submit(values: FormValues): Promise<boolean> {
    setTitleError(undefined);
    setDueError(undefined);
    setFormError(undefined);
    if (values.title.trim().length === 0) {
      setTitleError("Title cannot be empty");
      return false;
    }
    try {
      saveTaskFromForm(
        service,
        task,
        {
          title: values.title,
          notes: values.notes,
          priority,
          dueDatePreset,
          customDueAtMs: customDueDate?.getTime() ?? null,
          referenceInstantMs,
          viewerTimeZone,
        },
        { selectedPlacement, projects, sections },
        onSaved,
      );
      await showToast(Toast.Style.Success, task ? "Task updated" : "Task created");
      pop();
      return true;
    } catch (error) {
      const message = messageFrom(error);
      if (error instanceof DomainError && error.code === "INVALID_DUE_VALUE") {
        setDueError(message);
      } else {
        setFormError(message);
      }
      await showToast(Toast.Style.Failure, task ? "Unable to update task" : "Unable to create task", message);
      return false;
    }
  }

  return (
    <Form
      navigationTitle={task ? "Edit Task" : "New Task"}
      actions={
        <ActionPanel>
          <Action.SubmitForm title={task ? "Save Task" : "Create Task"} icon={Icon.Check} onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="title"
        title="Title"
        defaultValue={defaults.title}
        error={titleError}
        autoFocus
        onChange={() => setTitleError(undefined)}
      />
      {!task ? (
        <ProjectDropdown
          projects={projects}
          sections={sections}
          value={selectedPlacement}
          onChange={setSelectedPlacement}
        />
      ) : null}
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
      <Form.TextArea id="notes" title="Notes" defaultValue={defaults.notes} />
      <Form.Dropdown
        id="priority"
        title="Priority"
        value={priority}
        onChange={(value) => setPriority(value as Priority)}
      >
        <Form.Dropdown.Item value="none" title="None" />
        <Form.Dropdown.Item value="low" title="Low" />
        <Form.Dropdown.Item value="medium" title="Medium" />
        <Form.Dropdown.Item value="high" title="High" />
      </Form.Dropdown>
      {formError ? <Form.Description title="Error" text={formError} /> : null}
    </Form>
  );
}

export function MoveTaskForm({
  service,
  task,
  projects,
  sections,
  onSaved,
}: {
  service: TaskService;
  task: Task;
  projects: readonly Project[];
  sections: readonly Section[];
  onSaved: () => void;
}) {
  const { pop } = useNavigation();
  const [selectedPlacement, setSelectedPlacement] = useState(() => placementKey(placementOf(task)));
  const [formError, setFormError] = useState<string>();

  async function submit(): Promise<boolean> {
    setFormError(undefined);
    try {
      moveTaskFromForm(service, task.id, { selectedPlacement, projects, sections }, onSaved);
      await showToast(Toast.Style.Success, "Task moved");
      pop();
      return true;
    } catch (error) {
      const message = messageFrom(error);
      setFormError(message);
      await showToast(Toast.Style.Failure, "Unable to move task", message);
      return false;
    }
  }

  return (
    <Form
      navigationTitle="Move Task"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Move Task" icon={Icon.ArrowRight} onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.Description title="Task" text={task.title} />
      <ProjectDropdown
        projects={projects}
        sections={sections}
        value={selectedPlacement}
        onChange={setSelectedPlacement}
      />
      {formError ? <Form.Description title="Error" text={formError} /> : null}
    </Form>
  );
}
