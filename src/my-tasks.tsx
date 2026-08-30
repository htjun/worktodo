import {
  Action,
  ActionPanel,
  Icon,
  Keyboard,
  List,
  showToast,
  Toast,
  type LaunchProps,
  useNavigation,
} from "@raycast/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { ProjectsView } from "./project-management";
import { requestMenuBarRefresh } from "./raycast-commands";
import { CompletionFeedbackController } from "./shared/application/completion-feedback";
import {
  performTimedTaskHistoryOperation,
  TimedTaskHistoryController,
  type TimedTaskHistoryDirection,
  type TimedTaskHistoryState,
} from "./shared/application/timed-task-history";
import { openProductionWorktodo, type WorktodoSession } from "./shared/application/worktodo";
import { placementOf, type Project, type Section, type Task } from "./shared/domain/model";
import { timedTaskHistoryPresentation } from "./shared/presentation/task-history";
import { parseMyTasksLaunchContext, type MyTasksLaunchContext } from "./shared/presentation/task-launch";
import { taskListRowPresentation } from "./shared/presentation/task-list";
import { MoveTaskForm, TaskForm } from "./task-form";
import {
  initialPlacementForTaskView,
  lifecycleActionForTaskView,
  loadTaskViewSections,
  normalizeTaskView,
  TaskViewDropdown,
  taskViewContent,
  taskViewKey,
  type TaskListSection,
  type TaskView,
} from "./task-views";

type ListState = {
  isLoading: boolean;
  error: string | null;
  mutationError: string | null;
  taskSections: TaskListSection[];
  projects: Project[];
  sections: Section[];
};

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred";
}

const TASK_HISTORY_SHORTCUTS: Record<TimedTaskHistoryDirection, Keyboard.Shortcut> = {
  undo: { modifiers: ["cmd"], key: "z" },
  redo: { modifiers: ["cmd", "shift"], key: "z" },
};

function TaskHistoryAction({
  state,
  onAction,
}: {
  state: TimedTaskHistoryState;
  onAction: (state: TimedTaskHistoryState) => Promise<void>;
}) {
  const presentation = timedTaskHistoryPresentation(state);
  return (
    <Action
      title={presentation.title}
      icon={state.direction === "undo" ? Icon.Undo : Icon.Redo}
      shortcut={TASK_HISTORY_SHORTCUTS[state.direction]}
      onAction={() => onAction(state)}
    />
  );
}

export default function Command(props: LaunchProps<{ launchContext?: MyTasksLaunchContext }>) {
  const [launchContext] = useState(() => parseMyTasksLaunchContext(props.launchContext));
  const [view, setView] = useState<TaskView>(() => ({ kind: launchContext.view }));
  const [selectedTaskId, setSelectedTaskId] = useState(launchContext.selectedTaskId);
  const [isShowingDetail, setIsShowingDetail] = useState(false);
  const [viewerTimeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [session, setSession] = useState<WorktodoSession | null>(null);
  const [acknowledgedTasks, setAcknowledgedTasks] = useState<ReadonlyMap<string, Task>>(() => new Map());
  const [taskHistoryState, setTaskHistoryState] = useState<TimedTaskHistoryState | null>(null);
  const completionFeedback = useRef<CompletionFeedbackController | null>(null);
  if (completionFeedback.current === null) {
    completionFeedback.current = new CompletionFeedbackController(setAcknowledgedTasks);
  }
  const taskHistory = useRef<TimedTaskHistoryController | null>(null);
  if (taskHistory.current === null) {
    taskHistory.current = new TimedTaskHistoryController(setTaskHistoryState);
  }
  const performTaskHistoryRef = useRef<(state: TimedTaskHistoryState) => Promise<void>>(async () => undefined);
  const didOpenCreateTask = useRef(false);
  const { push } = useNavigation();
  const [state, setState] = useState<ListState>({
    isLoading: true,
    error: null,
    mutationError: null,
    taskSections: [],
    projects: [],
    sections: [],
  });

  useEffect(() => {
    let opened: WorktodoSession | null = null;
    try {
      opened = openProductionWorktodo();
      setSession(opened);
    } catch (error) {
      setState({
        isLoading: false,
        error: messageFrom(error),
        mutationError: null,
        taskSections: [],
        projects: [],
        sections: [],
      });
    }
    return () => opened?.close();
  }, []);

  const refresh = useCallback(() => {
    if (!session) {
      return;
    }
    setState((current) => ({ ...current, isLoading: true, error: null }));
    try {
      const projects = session.service.listProjects();
      const sections = session.service.listSections();
      const nextView = normalizeTaskView(view, projects, sections);
      if (taskViewKey(nextView) !== taskViewKey(view)) {
        completionFeedback.current?.reset();
        setIsShowingDetail(false);
        setView(nextView);
      }
      setState({
        isLoading: false,
        error: null,
        mutationError: null,
        taskSections: loadTaskViewSections(session, nextView, viewerTimeZone),
        projects,
        sections,
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        isLoading: false,
        error: messageFrom(error),
        mutationError: null,
        taskSections: [],
      }));
    }
  }, [session, view, viewerTimeZone]);

  useEffect(() => refresh(), [refresh]);

  useEffect(
    () => () => {
      completionFeedback.current?.dispose();
      taskHistory.current?.dispose();
    },
    [],
  );

  const refreshAfterMutation = useCallback(() => {
    refresh();
    requestMenuBarRefresh();
  }, [refresh]);

  const refreshAfterUnrelatedMutation = useCallback(() => {
    taskHistory.current?.clear();
    completionFeedback.current?.reset();
    refreshAfterMutation();
  }, [refreshAfterMutation]);

  const reportMutationFailure = useCallback(async (error: unknown) => {
    const message = messageFrom(error);
    setState((current) => ({ ...current, isLoading: false, mutationError: message }));
    await showToast(Toast.Style.Failure, "Worktodo could not complete the action", message);
  }, []);

  const showHistoryToast = useCallback(async (title: string, message: string, nextState: TimedTaskHistoryState) => {
    const nextPresentation = timedTaskHistoryPresentation(nextState);
    await showToast({
      style: Toast.Style.Success,
      title,
      message,
      primaryAction: {
        title: nextPresentation.title,
        onAction: () => void performTaskHistoryRef.current(nextState),
      },
    });
  }, []);

  const performTaskHistory = useCallback(
    async (expected: TimedTaskHistoryState) => {
      if (!session || !taskHistory.current) {
        return;
      }
      try {
        let completionFeedbackOwnsRefresh = false;
        const result = taskHistory.current.perform(expected, () => {
          performTimedTaskHistoryOperation(expected, {
            reopen: () => {
              session.service.reopenTask(expected.taskId);
              completionFeedback.current?.reset();
            },
            complete: () => {
              const attempt = completionFeedback.current?.complete(
                expected.taskId,
                () => session.service.completeTask(expected.taskId),
                requestMenuBarRefresh,
                refresh,
              );
              if (!attempt || attempt.status === "duplicate") {
                throw new Error("Task completion is already pending");
              }
              completionFeedbackOwnsRefresh = true;
            },
            restore: () => session.service.restoreTask(expected.taskId),
            trash: () => session.service.trashTask(expected.taskId),
          });
        });
        if (result.status === "unavailable") {
          await showToast(
            Toast.Style.Failure,
            expected.direction === "undo" ? "Undo no longer available" : "Redo no longer available",
            expected.taskTitle,
          );
          return;
        }
        setState((value) => ({ ...value, mutationError: null }));
        if (!completionFeedbackOwnsRefresh) {
          refreshAfterMutation();
        }
        if (expected.direction === "undo") {
          setSelectedTaskId(expected.taskId);
        }
        const completedPresentation = timedTaskHistoryPresentation(result.previous);
        await showHistoryToast(completedPresentation.successTitle, expected.taskTitle, result.state);
      } catch (error) {
        await reportMutationFailure(error);
      }
    },
    [refresh, refreshAfterMutation, reportMutationFailure, session, showHistoryToast],
  );
  performTaskHistoryRef.current = performTaskHistory;

  const runMutation = useCallback(
    async (operation: () => void, successTitle: string) => {
      try {
        operation();
        refreshAfterUnrelatedMutation();
        await showToast(Toast.Style.Success, successTitle);
      } catch (error) {
        await reportMutationFailure(error);
      }
    },
    [refreshAfterUnrelatedMutation, reportMutationFailure],
  );

  const completeTaskWithFeedback = useCallback(
    async (taskId: string) => {
      if (!session) {
        return;
      }
      try {
        const result = completionFeedback.current?.complete(
          taskId,
          () => session.service.completeTask(taskId),
          requestMenuBarRefresh,
          refresh,
        );
        if (!result || result.status === "duplicate") {
          return;
        }
        const historyState = taskHistory.current?.record({
          kind: "complete",
          taskId,
          taskTitle: result.task.title,
        });
        if (!historyState) {
          return;
        }
        setState((current) => ({ ...current, mutationError: null }));
        await showHistoryToast("Task completed", result.task.title, historyState);
      } catch (error) {
        await reportMutationFailure(error);
      }
    },
    [refresh, reportMutationFailure, session, showHistoryToast],
  );

  const trashTaskWithHistory = useCallback(
    async (task: Task) => {
      if (!session) {
        return;
      }
      try {
        const trashed = session.service.trashTask(task.id);
        completionFeedback.current?.reset();
        const historyState = taskHistory.current?.record({
          kind: "trash",
          taskId: task.id,
          taskTitle: trashed.title,
        });
        if (!historyState) {
          return;
        }
        setState((current) => ({ ...current, mutationError: null }));
        refreshAfterMutation();
        await showHistoryToast("Task moved to Trash", trashed.title, historyState);
      } catch (error) {
        await reportMutationFailure(error);
      }
    },
    [refreshAfterMutation, reportMutationFailure, session, showHistoryToast],
  );

  useEffect(() => {
    if (!launchContext.createTask || didOpenCreateTask.current || !session || state.isLoading || state.error) {
      return;
    }
    didOpenCreateTask.current = true;
    push(
      <TaskForm
        service={session.service}
        projects={state.projects}
        sections={state.sections}
        initialPlacement={{ kind: "inbox" }}
        viewerTimeZone={viewerTimeZone}
        onSaved={refreshAfterUnrelatedMutation}
      />,
    );
  }, [
    launchContext.createTask,
    push,
    refreshAfterUnrelatedMutation,
    session,
    state.error,
    state.isLoading,
    state.projects,
    state.sections,
    viewerTimeZone,
  ]);

  const content = taskViewContent(view, state.projects, state.sections);
  const taskCount = state.taskSections.reduce((count, section) => count + section.items.length, 0);
  const createTarget = session ? (
    <TaskForm
      service={session.service}
      projects={state.projects}
      sections={state.sections}
      initialPlacement={initialPlacementForTaskView(view)}
      viewerTimeZone={viewerTimeZone}
      onSaved={refreshAfterUnrelatedMutation}
    />
  ) : null;
  const projectsTarget = session ? (
    <ProjectsView service={session.service} onChanged={refreshAfterUnrelatedMutation} />
  ) : null;

  const changeView = useCallback((nextView: TaskView) => {
    completionFeedback.current?.reset();
    setSelectedTaskId(undefined);
    setIsShowingDetail(false);
    setView(nextView);
  }, []);

  return (
    <List
      isLoading={state.isLoading}
      isShowingDetail={isShowingDetail}
      selectedItemId={state.isLoading ? undefined : selectedTaskId}
      onSelectionChange={(id) => {
        if (id !== null) {
          setSelectedTaskId(id);
        }
      }}
      searchBarPlaceholder={content.searchPlaceholder}
      searchBarAccessory={
        <TaskViewDropdown view={view} projects={state.projects} sections={state.sections} onChange={changeView} />
      }
    >
      {state.error ? (
        <List.EmptyView icon={Icon.Warning} title="Unable to open Worktodo" description={state.error} />
      ) : taskCount === 0 ? (
        <List.EmptyView
          icon={content.icon}
          title={content.emptyTitle}
          description={content.emptyDescription}
          actions={
            createTarget || projectsTarget || taskHistoryState ? (
              <ActionPanel>
                {createTarget ? <Action.Push title="Create Task" icon={Icon.Plus} target={createTarget} /> : null}
                {projectsTarget ? (
                  <Action.Push title="Manage Projects" icon={Icon.Folder} target={projectsTarget} />
                ) : null}
                {taskHistoryState ? <TaskHistoryAction state={taskHistoryState} onAction={performTaskHistory} /> : null}
              </ActionPanel>
            ) : undefined
          }
        />
      ) : (
        state.taskSections.map((taskSection, sectionIndex) => (
          <List.Section
            key={taskSection.key}
            title={
              sectionIndex === 0 && state.mutationError
                ? `Action failed: ${state.mutationError} — ${taskSection.title}`
                : taskSection.title
            }
          >
            {taskSection.items.map((item) => {
              const lifecycle = session ? lifecycleActionForTaskView(view, session.service, item.id) : null;
              const row = taskListRowPresentation(item, acknowledgedTasks.get(item.id));
              return (
                <List.Item
                  key={item.id}
                  id={item.id}
                  icon={row.isCompletionAcknowledged ? Icon.CheckCircle : content.taskIcon}
                  title={row.title}
                  subtitle={item.subtitle}
                  keywords={item.keywords}
                  accessories={
                    isShowingDetail && !row.isCompletionAcknowledged
                      ? undefined
                      : row.accessories.map((text) => ({ text }))
                  }
                  detail={
                    <List.Item.Detail
                      markdown={item.detail.markdown}
                      metadata={
                        <List.Item.Detail.Metadata>
                          {item.detail.metadata.map((field) => (
                            <List.Item.Detail.Metadata.Label key={field.title} title={field.title} text={field.text} />
                          ))}
                          {item.detail.links.map((url, index) => (
                            <List.Item.Detail.Metadata.Link
                              key={url}
                              title={index === 0 ? "Link" : `Link ${index + 1}`}
                              text={url}
                              target={url}
                            />
                          ))}
                        </List.Item.Detail.Metadata>
                      }
                    />
                  }
                  actions={
                    session && lifecycle ? (
                      <ActionPanel>
                        <Action
                          title={isShowingDetail ? "Hide Details" : "Show Details"}
                          icon={isShowingDetail ? Icon.EyeDisabled : Icon.Eye}
                          onAction={() => setIsShowingDetail((current) => !current)}
                        />
                        {/* Raycast reserves Command-Return for the second action and rejects it as an explicit shortcut. */}
                        <Action
                          title={lifecycle.title}
                          icon={lifecycle.icon}
                          onAction={() =>
                            view.kind === "completed" || view.kind === "trash"
                              ? runMutation(lifecycle.operation, lifecycle.successTitle)
                              : completeTaskWithFeedback(item.id)
                          }
                        />
                        {taskHistoryState ? (
                          <TaskHistoryAction state={taskHistoryState} onAction={performTaskHistory} />
                        ) : null}
                        {item.detail.links.map((url, index) => (
                          <Action.OpenInBrowser
                            key={url}
                            title={index === 0 ? "Open Link" : `Open Link ${index + 1}`}
                            url={url}
                          />
                        ))}
                        {view.kind !== "trash" ? (
                          <Action.Push
                            title="Edit Task"
                            icon={Icon.Pencil}
                            shortcut={Keyboard.Shortcut.Common.Edit}
                            target={
                              <TaskForm
                                service={session.service}
                                task={item.task}
                                projects={state.projects}
                                sections={state.sections}
                                initialPlacement={placementOf(item.task)}
                                viewerTimeZone={viewerTimeZone}
                                onSaved={refreshAfterUnrelatedMutation}
                              />
                            }
                          />
                        ) : null}
                        {view.kind !== "trash" ? (
                          <Action.Push
                            title="Move Task"
                            icon={Icon.ArrowRight}
                            target={
                              <MoveTaskForm
                                service={session.service}
                                task={item.task}
                                projects={state.projects}
                                sections={state.sections}
                                onSaved={refreshAfterUnrelatedMutation}
                              />
                            }
                          />
                        ) : null}
                        {createTarget ? (
                          <Action.Push
                            title="Create Task"
                            icon={Icon.Plus}
                            shortcut={Keyboard.Shortcut.Common.New}
                            target={createTarget}
                          />
                        ) : null}
                        {projectsTarget ? (
                          <Action.Push title="Manage Projects" icon={Icon.Folder} target={projectsTarget} />
                        ) : null}
                        {view.kind !== "trash" ? (
                          <Action
                            title="Move to Trash"
                            icon={Icon.Trash}
                            style={Action.Style.Destructive}
                            shortcut={Keyboard.Shortcut.Common.Remove}
                            onAction={() => trashTaskWithHistory(item.task)}
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
        ))
      )}
    </List>
  );
}
