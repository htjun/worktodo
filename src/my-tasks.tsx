import { Action, ActionPanel, Icon, Keyboard, List, showToast, Toast } from "@raycast/api";
import { useCallback, useEffect, useState } from "react";
import { ProjectsView } from "./project-management";
import { openProductionWorktodo, type WorktodoSession } from "./shared/application/worktodo";
import { placementOf, type Project, type Section } from "./shared/domain/model";
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

export default function Command() {
  const [view, setView] = useState<TaskView>({ kind: "today" });
  const [viewerTimeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [session, setSession] = useState<WorktodoSession | null>(null);
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

  const content = taskViewContent(view, state.projects, state.sections);
  const taskCount = state.taskSections.reduce((count, section) => count + section.items.length, 0);
  const createTarget = session ? (
    <TaskForm
      service={session.service}
      projects={state.projects}
      sections={state.sections}
      initialPlacement={initialPlacementForTaskView(view)}
      viewerTimeZone={viewerTimeZone}
      onSaved={refresh}
    />
  ) : null;
  const projectsTarget = session ? <ProjectsView service={session.service} onChanged={refresh} /> : null;

  return (
    <List
      isLoading={state.isLoading}
      searchBarPlaceholder={content.searchPlaceholder}
      searchBarAccessory={
        <TaskViewDropdown view={view} projects={state.projects} sections={state.sections} onChange={setView} />
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
                  accessories={item.metadata.map((text) => ({ text }))}
                  actions={
                    session && lifecycle ? (
                      <ActionPanel>
                        <Action
                          title={lifecycle.title}
                          icon={lifecycle.icon}
                          onAction={() => runMutation(lifecycle.operation, lifecycle.successTitle)}
                        />
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
                                onSaved={refresh}
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
                                onSaved={refresh}
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
