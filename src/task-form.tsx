import { Action, ActionPanel, Form, Icon, showToast, Toast, useNavigation } from "@raycast/api";
import { useMemo, useState } from "react";
import {
  TaskEditingInteraction,
  taskEditingDefaults,
  taskEditingPlacementKey,
  type TaskEditingFailureField,
} from "./shared/application/task-editing";
import { placementOf, type Placement, type Priority, type Project, type Task } from "./shared/domain/model";
import type { TaskService } from "./shared/domain/task-service";
import { DueDateFields, ProjectDropdown } from "./task-form-controls";

type FormValues = {
  title: string;
  notes: string;
};

export function TaskForm({
  service,
  task,
  projects,
  initialPlacement,
  viewerTimeZone,
  onSaved,
}: {
  service: TaskService;
  task?: Task;
  projects: readonly Project[];
  initialPlacement: Placement;
  viewerTimeZone: string;
  onSaved: () => void;
}) {
  const { pop } = useNavigation();
  const [referenceInstantMs] = useState(Date.now);
  const editing = useMemo(() => new TaskEditingInteraction(service), [service]);
  const defaults = useMemo(
    () => taskEditingDefaults(task, initialPlacement, referenceInstantMs, viewerTimeZone),
    [initialPlacement, referenceInstantMs, task, viewerTimeZone],
  );
  const [priority, setPriority] = useState<Priority>(defaults.priority);
  const [dueDatePreset, setDueDatePreset] = useState(defaults.dueDatePreset);
  const [customDueDate, setCustomDueDate] = useState<Date | null>(() =>
    defaults.customDueAtMs === null ? null : new Date(defaults.customDueAtMs),
  );
  const [selectedPlacement, setSelectedPlacement] = useState(defaults.selectedPlacement);
  const [titleError, setTitleError] = useState<string>();
  const [dueError, setDueError] = useState<string>();
  const [placementError, setPlacementError] = useState<string>();
  const [formError, setFormError] = useState<string>();

  async function submit(values: FormValues): Promise<boolean> {
    setTitleError(undefined);
    setDueError(undefined);
    setPlacementError(undefined);
    setFormError(undefined);
    const outcome = editing.save(
      task,
      {
        title: values.title,
        notes: values.notes,
        priority,
        dueDatePreset,
        customDueAtMs: customDueDate?.getTime() ?? null,
        selectedPlacement,
      },
      { referenceInstantMs, viewerTimeZone, projects },
    );
    if (outcome.status === "failed") {
      const setFieldError: Record<TaskEditingFailureField, (message: string) => void> = {
        title: setTitleError,
        due: setDueError,
        placement: setPlacementError,
        form: setFormError,
      };
      setFieldError[outcome.field](outcome.message);
      await showToast(Toast.Style.Failure, task ? "Unable to update task" : "Unable to create task", outcome.message);
      return false;
    }

    onSaved();
    await showToast(Toast.Style.Success, task ? "Task updated" : "Task created");
    pop();
    return true;
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
          value={selectedPlacement}
          error={placementError}
          onChange={(placement) => {
            setSelectedPlacement(placement);
            setPlacementError(undefined);
          }}
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
  onSaved,
}: {
  service: TaskService;
  task: Task;
  projects: readonly Project[];
  onSaved: () => void;
}) {
  const { pop } = useNavigation();
  const editing = useMemo(() => new TaskEditingInteraction(service), [service]);
  const [selectedPlacement, setSelectedPlacement] = useState(() => taskEditingPlacementKey(placementOf(task)));
  const [placementError, setPlacementError] = useState<string>();
  const [formError, setFormError] = useState<string>();

  async function submit(): Promise<boolean> {
    setFormError(undefined);
    setPlacementError(undefined);
    const outcome = editing.move(task.id, selectedPlacement, projects);
    if (outcome.status === "failed") {
      if (outcome.field === "placement") {
        setPlacementError(outcome.message);
      } else {
        setFormError(outcome.message);
      }
      await showToast(Toast.Style.Failure, "Unable to move task", outcome.message);
      return false;
    }

    onSaved();
    await showToast(Toast.Style.Success, "Task moved");
    pop();
    return true;
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
        value={selectedPlacement}
        error={placementError}
        onChange={(placement) => {
          setSelectedPlacement(placement);
          setPlacementError(undefined);
        }}
      />
      {formError ? <Form.Description title="Error" text={formError} /> : null}
    </Form>
  );
}
