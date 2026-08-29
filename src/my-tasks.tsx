import { Action, ActionPanel, Form, Icon, Keyboard, List, showToast, Toast, useNavigation } from "@raycast/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { openProductionWorktodo, type WorktodoSession } from "./shared/application/worktodo";
import { DomainError, type DueValue, type Priority, type Task } from "./shared/domain/model";
import type { TaskService } from "./shared/domain/task-service";
import {
  formToCreateTask,
  formToUpdateTask,
  taskFormDefaults,
  type TaskFormValues,
} from "./shared/presentation/task-form";
import { buildTaskListItems, type TaskListEntry, type TaskListItem } from "./shared/presentation/task-list";

type View = "today" | "inbox" | "completed" | "trash";
type ListState = {
  isLoading: boolean;
  error: string | null;
  mutationError: string | null;
  items: TaskListItem[];
};

type FormValues = {
  title: string;
  notes: string;
  priority: string;
  dueKind: string;
  dueAt: Date | null;
};

const VIEW_CONTENT = {
  today: {
    title: "Today",
    icon: Icon.Calendar,
    taskIcon: Icon.Circle,
    searchPlaceholder: "Search Today",
    emptyTitle: "Nothing due today",
    emptyDescription: "Overdue and due-today tasks appear here.",
  },
  inbox: {
    title: "Inbox",
    icon: Icon.Tray,
    taskIcon: Icon.Circle,
    searchPlaceholder: "Search Inbox",
    emptyTitle: "Inbox is empty",
    emptyDescription: "Create a task to capture it.",
  },
  completed: {
    title: "Completed",
    icon: Icon.CheckCircle,
    taskIcon: Icon.CheckCircle,
    searchPlaceholder: "Search Completed",
    emptyTitle: "No completed tasks",
    emptyDescription: "Completed tasks appear here.",
  },
  trash: {
    title: "Trash",
    icon: Icon.Trash,
    taskIcon: Icon.Trash,
    searchPlaceholder: "Search Trash",
    emptyTitle: "Trash is empty",
    emptyDescription: "Tasks moved to Trash appear here.",
  },
} as const;

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred";
}

function loadItems(session: WorktodoSession, view: View, viewerTimeZone: string): TaskListItem[] {
  const projects = session.service.listProjects();
  const sections = session.service.listSections();
  let entries: TaskListEntry[];
  switch (view) {
    case "today":
      entries = session.service.listToday(Date.now(), viewerTimeZone).tasks.map(({ task, status }) => ({
        task,
        todayStatus: status,
      }));
      break;
    case "inbox":
      entries = session.service.listInbox().map((task) => ({ task }));
      break;
    case "completed":
      entries = session.service.listCompleted().map((task) => ({ task }));
      break;
    case "trash":
      entries = session.service.listTrash().map((task) => ({ task }));
      break;
  }
  return buildTaskListItems(entries, projects, sections, viewerTimeZone);
}

function lifecycleAction(view: View, service: TaskService, taskId: string) {
  switch (view) {
    case "trash":
      return {
        title: "Restore Task",
        icon: Icon.ArrowCounterClockwise,
        successTitle: "Task restored",
        operation: () => service.restoreTask(taskId),
      };
    case "completed":
      return {
        title: "Reopen Task",
        icon: Icon.Circle,
        successTitle: "Task reopened",
        operation: () => service.reopenTask(taskId),
      };
    case "today":
    case "inbox":
      return {
        title: "Complete Task",
        icon: Icon.CheckCircle,
        successTitle: "Task completed",
        operation: () => service.completeTask(taskId),
      };
  }
}

function TaskForm({
  service,
  task,
  viewerTimeZone,
  onSaved,
}: {
  service: TaskService;
  task?: Task;
  viewerTimeZone: string;
  onSaved: () => void;
}) {
  const { pop } = useNavigation();
  const defaults = useMemo(() => taskFormDefaults(task, viewerTimeZone), [task, viewerTimeZone]);
  const [priority, setPriority] = useState<Priority>(defaults.priority);
  const [dueKind, setDueKind] = useState<DueValue["kind"]>(defaults.dueKind);
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
        service.createTask(formToCreateTask(mapped, viewerTimeZone));
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
      navigationTitle={task ? "Edit Task" : "New Inbox Task"}
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

export default function Command() {
  const [view, setView] = useState<View>("today");
  const [viewerTimeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [session, setSession] = useState<WorktodoSession | null>(null);
  const [state, setState] = useState<ListState>({
    isLoading: true,
    error: null,
    mutationError: null,
    items: [],
  });

  useEffect(() => {
    let opened: WorktodoSession | null = null;
    try {
      opened = openProductionWorktodo();
      setSession(opened);
    } catch (error) {
      setState({ isLoading: false, error: messageFrom(error), mutationError: null, items: [] });
    }
    return () => opened?.close();
  }, []);

  const refresh = useCallback(() => {
    if (!session) {
      return;
    }
    setState((current) => ({ ...current, isLoading: true, error: null }));
    try {
      setState({
        isLoading: false,
        error: null,
        mutationError: null,
        items: loadItems(session, view, viewerTimeZone),
      });
    } catch (error) {
      setState({ isLoading: false, error: messageFrom(error), mutationError: null, items: [] });
    }
  }, [session, view, viewerTimeZone]);

  useEffect(() => refresh(), [refresh]);

  const runMutation = useCallback(
    async (operation: () => void, successTitle: string) => {
      try {
        operation();
        refresh();
        await showToast(Toast.Style.Success, successTitle);
      } catch (error) {
        const message = messageFrom(error);
        setState((current) => ({ ...current, isLoading: false, mutationError: message }));
        await showToast(Toast.Style.Failure, "Worktodo could not complete the action", message);
      }
    },
    [refresh],
  );

  const createTarget = session ? (
    <TaskForm service={session.service} viewerTimeZone={viewerTimeZone} onSaved={refresh} />
  ) : null;
  const viewContent = VIEW_CONTENT[view];

  return (
    <List
      isLoading={state.isLoading}
      searchBarPlaceholder={viewContent.searchPlaceholder}
      searchBarAccessory={
        <List.Dropdown tooltip="Task View" value={view} onChange={(value) => setView(value as View)}>
          <List.Dropdown.Item value="today" title="Today" icon={Icon.Calendar} />
          <List.Dropdown.Item value="inbox" title="Inbox" icon={Icon.Tray} />
          <List.Dropdown.Item value="completed" title="Completed" icon={Icon.CheckCircle} />
          <List.Dropdown.Item value="trash" title="Trash" icon={Icon.Trash} />
        </List.Dropdown>
      }
    >
      {state.error ? (
        <List.EmptyView icon={Icon.Warning} title="Unable to open Worktodo" description={state.error} />
      ) : state.items.length === 0 ? (
        <List.EmptyView
          icon={viewContent.icon}
          title={viewContent.emptyTitle}
          description={viewContent.emptyDescription}
          actions={
            createTarget ? (
              <ActionPanel>
                <Action.Push title="Create Inbox Task" icon={Icon.Plus} target={createTarget} />
              </ActionPanel>
            ) : undefined
          }
        />
      ) : (
        <List.Section title={state.mutationError ? `Action failed: ${state.mutationError}` : viewContent.title}>
          {state.items.map((item) => {
            const lifecycle = session ? lifecycleAction(view, session.service, item.id) : null;
            return (
              <List.Item
                key={item.id}
                id={item.id}
                icon={viewContent.taskIcon}
                title={item.title}
                subtitle={item.subtitle}
                keywords={item.keywords}
                accessories={item.metadata.map((text) => ({ text }))}
                actions={
                  session && lifecycle ? (
                    <ActionPanel>
                      <Action
                        title={lifecycle.title}
                        icon={lifecycle.icon}
                        onAction={() => runMutation(lifecycle.operation, lifecycle.successTitle)}
                      />
                      {view !== "trash" ? (
                        <Action.Push
                          title="Edit Task"
                          icon={Icon.Pencil}
                          shortcut={Keyboard.Shortcut.Common.Edit}
                          target={
                            <TaskForm
                              service={session.service}
                              task={item.task}
                              viewerTimeZone={viewerTimeZone}
                              onSaved={refresh}
                            />
                          }
                        />
                      ) : null}
                      {view !== "trash" ? (
                        <Action
                          title="Move to Trash"
                          icon={Icon.Trash}
                          style={Action.Style.Destructive}
                          shortcut={Keyboard.Shortcut.Common.Remove}
                          onAction={() => runMutation(() => session.service.trashTask(item.id), "Task moved to Trash")}
                        />
                      ) : null}
                      {createTarget ? (
                        <Action.Push
                          title="Create Inbox Task"
                          icon={Icon.Plus}
                          shortcut={Keyboard.Shortcut.Common.New}
                          target={createTarget}
                        />
                      ) : null}
                      <Action
                        title="Refresh"
                        icon={Icon.ArrowClockwise}
                        shortcut={Keyboard.Shortcut.Common.Refresh}
                        onAction={refresh}
                      />
                    </ActionPanel>
                  ) : undefined
                }
              />
            );
          })}
        </List.Section>
      )}
    </List>
  );
}
