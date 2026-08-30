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
import { openProductionWorktodo, type WorktodoSession } from "./shared/application/worktodo";
import { placementOf, type Project, type Section } from "./shared/domain/model";
import { parseMyTasksLaunchContext, type MyTasksLaunchContext } from "./shared/presentation/task-launch";
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

export default function Command(props: LaunchProps<{ launchContext?: MyTasksLaunchContext }>) {
  const [launchContext] = useState(() => parseMyTasksLaunchContext(props.launchContext));
  const [view, setView] = useState<TaskView>(() => ({ kind: launchContext.view }));
  const [selectedTaskId, setSelectedTaskId] = useState(launchContext.selectedTaskId);
  const [isShowingDetail, setIsShowingDetail] = useState(false);
  const [viewerTimeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [session, setSession] = useState<WorktodoSession | null>(null);
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

  const refreshAfterMutation = useCallback(() => {
    refresh();
    requestMenuBarRefresh();
  }, [refresh]);

  const runMutation = useCallback(
    async (operation: () => void, successTitle: string) => {
      try {
        operation();
        refreshAfterMutation();
        await showToast(Toast.Style.Success, successTitle);
      } catch (error) {
        const message = messageFrom(error);
        setState((current) => ({ ...current, isLoading: false, mutationError: message }));
        await showToast(Toast.Style.Failure, "Worktodo could not complete the action", message);
      }
    },
    [refreshAfterMutation],
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
        onSaved={refreshAfterMutation}
      />,
    );
  }, [
    launchContext.createTask,
    push,
    refreshAfterMutation,
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
      onSaved={refreshAfterMutation}
    />
  ) : null;
  const projectsTarget = session ? <ProjectsView service={session.service} onChanged={refreshAfterMutation} /> : null;

  const changeView = useCallback((nextView: TaskView) => {
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
            createTarget || projectsTarget ? (
              <ActionPanel>
                {createTarget ? <Action.Push title="Create Task" icon={Icon.Plus} target={createTarget} /> : null}
                {projectsTarget ? (
                  <Action.Push title="Manage Projects" icon={Icon.Folder} target={projectsTarget} />
                ) : null}
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
              return (
                <List.Item
                  key={item.id}
                  id={item.id}
                  icon={content.taskIcon}
                  title={item.title}
                  subtitle={item.subtitle}
                  keywords={item.keywords}
                  accessories={isShowingDetail ? undefined : item.metadata.map((text) => ({ text }))}
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
                          onAction={() => runMutation(lifecycle.operation, lifecycle.successTitle)}
                        />
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
                                onSaved={refreshAfterMutation}
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
                                onSaved={refreshAfterMutation}
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
                            onAction={() =>
                              runMutation(() => session.service.trashTask(item.id), "Task moved to Trash")
                            }
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
