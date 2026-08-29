import { Action, ActionPanel, Form, Icon, showToast, Toast, useNavigation } from "@raycast/api";
import { useMemo, useState } from "react";
import {
  DomainError,
  placementOf,
  type DueValue,
  type Placement,
  type Priority,
  type Project,
  type Section,
  type Task,
} from "./shared/domain/model";
import type { TaskService } from "./shared/domain/task-service";
import {
  formToCreateTask,
  formToUpdateTask,
  taskFormDefaults,
  type TaskFormValues,
} from "./shared/presentation/task-form";
import { placementFromKey, placementKey } from "./shared/presentation/placement";

type FormValues = {
  title: string;
  notes: string;
  priority: string;
  dueKind: string;
  dueAt: Date | null;
};

type PlacementDropdownProps = {
  projects: readonly Project[];
  sections: readonly Section[];
  value: string;
  onChange: (value: string) => void;
};

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred";
}

function PlacementDropdown({ projects, sections, value, onChange }: PlacementDropdownProps) {
  return (
    <Form.Dropdown id="placement" title="Location" value={value} onChange={onChange}>
      <Form.Dropdown.Item value="inbox" title="Inbox" icon={Icon.Tray} />
      {projects.map((project) => (
        <Form.Dropdown.Section key={project.id} title={project.name}>
          <Form.Dropdown.Item value={placementKey({ kind: "project", projectId: project.id })} title={project.name} />
          {sections
            .filter((section) => section.projectId === project.id)
            .map((section) => (
              <Form.Dropdown.Item
                key={section.id}
                value={placementKey({ kind: "section", projectId: project.id, sectionId: section.id })}
                title={section.name}
              />
            ))}
        </Form.Dropdown.Section>
      ))}
    </Form.Dropdown>
  );
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
  const defaults = useMemo(() => taskFormDefaults(task, viewerTimeZone), [task, viewerTimeZone]);
  const [priority, setPriority] = useState<Priority>(defaults.priority);
  const [dueKind, setDueKind] = useState<DueValue["kind"]>(defaults.dueKind);
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
    const mapped: TaskFormValues = {
      title: values.title,
      notes: values.notes,
      priority,
      dueKind: values.dueKind as DueValue["kind"],
      dueAtMs: values.dueAt?.getTime() ?? null,
    };
    try {
      if (task) {
        service.updateTask(task.id, formToUpdateTask(mapped, viewerTimeZone));
      } else {
        const placement = placementFromKey(selectedPlacement, projects, sections);
        service.createTask(formToCreateTask(mapped, viewerTimeZone, placement));
      }
      onSaved();
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
      <Form.TextArea id="notes" title="Notes" defaultValue={defaults.notes} />
      {!task ? (
        <PlacementDropdown
          projects={projects}
          sections={sections}
          value={selectedPlacement}
          onChange={setSelectedPlacement}
        />
      ) : null}
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
      <Form.Dropdown
        id="dueKind"
        title="Due"
        value={dueKind}
        onChange={(value) => {
          setDueKind(value as DueValue["kind"]);
          setDueError(undefined);
        }}
      >
        <Form.Dropdown.Item value="none" title="No Due Date" />
        <Form.Dropdown.Item value="allDay" title="All Day" />
        <Form.Dropdown.Item value="timed" title="Date and Time" />
      </Form.Dropdown>
      <Form.DatePicker
        id="dueAt"
        title={dueKind === "timed" ? "Due Date and Time" : "Due Date"}
        info={dueKind === "none" ? "Ignored while No Due Date is selected." : undefined}
        type={dueKind === "timed" ? Form.DatePicker.Type.DateTime : Form.DatePicker.Type.Date}
        defaultValue={defaults.dueAtMs === null ? null : new Date(defaults.dueAtMs)}
        error={dueError}
        onChange={() => setDueError(undefined)}
      />
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
      service.moveTask(task.id, placementFromKey(selectedPlacement, projects, sections));
      onSaved();
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
      <PlacementDropdown
        projects={projects}
        sections={sections}
        value={selectedPlacement}
        onChange={setSelectedPlacement}
      />
      {formError ? <Form.Description title="Error" text={formError} /> : null}
    </Form>
  );
}
