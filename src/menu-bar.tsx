import { Cache, Color, Icon, Keyboard, LaunchType, MenuBarExtra, Toast, type LaunchProps } from "@raycast/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { showMenuBarFeedback } from "./menu-bar-feedback";
import { launchMenuBarAction, launchMyTasks } from "./raycast-commands";
import {
  performTimedTaskHistoryOperation,
  TimedTaskHistoryController,
  type TimedTaskHistoryDirection,
  type TimedTaskHistoryState,
} from "./shared/application/timed-task-history";
import { openProductionWorktodo } from "./shared/application/worktodo";
import type { Priority, Task } from "./shared/domain/model";
import {
  buildMenuBarModel,
  buildMenuBarTaskHistoryItem,
  menuBarTaskTitle,
  type MenuBarLaunchAction,
  type MenuBarModel,
  resolveMenuBarLaunchAction,
  resolveMenuBarVisibility,
} from "./shared/presentation/menu-bar";
import { timedTaskHistoryPresentation } from "./shared/presentation/task-history";
import type { MyTasksLaunchContext } from "./shared/presentation/task-launch";

const EMPTY_MODEL: MenuBarModel = { count: 0, title: undefined, sections: [] };
const MENU_BAR_HIDDEN_KEY = "hidden";
const menuBarVisibilityCache = new Cache({ namespace: "menu-bar-visibility" });
const TASK_HISTORY_SHORTCUTS: Record<TimedTaskHistoryDirection, Keyboard.Shortcut> = {
  undo: { modifiers: ["cmd"], key: "z" },
  redo: { modifiers: ["cmd", "shift"], key: "z" },
};
const PRIORITY_TINT: Record<Priority, Color> = {
  none: Color.SecondaryText,
  low: Color.Blue,
  medium: Color.Orange,
  high: Color.Red,
};

type MenuState = {
  isLoading: boolean;
  error: string | null;
  model: MenuBarModel;
};

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred";
}

function loadMenuBarModel(viewerTimeZone: string): MenuBarModel {
  const session = openProductionWorktodo();
  try {
    const evaluationInstantMs = Date.now();
    return buildMenuBarModel(
      session.service.listToday(evaluationInstantMs, viewerTimeZone),
      session.service.listUpcoming(evaluationInstantMs, viewerTimeZone),
      session.service.listProjects(),
    );
  } finally {
    session.close();
  }
}

function priorityIcon(priority: Priority) {
  return { source: Icon.Circle, tintColor: PRIORITY_TINT[priority] };
}

function menuIcon(source: Icon) {
  return { source, tintColor: Color.SecondaryText };
}

function initialMenuBarHidden(userInitiated: boolean): boolean {
  const visibility = resolveMenuBarVisibility(menuBarVisibilityCache.has(MENU_BAR_HIDDEN_KEY), userInitiated);
  if (visibility.clearStoredHidden) {
    menuBarVisibilityCache.remove(MENU_BAR_HIDDEN_KEY);
  }
  return visibility.hidden;
}

export default function Command(props: LaunchProps<{ launchContext?: MenuBarLaunchAction }>) {
  const [viewerTimeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [hidden, setHidden] = useState(() => initialMenuBarHidden(props.launchType === LaunchType.UserInitiated));
  const [state, setState] = useState<MenuState>({ isLoading: true, error: null, model: EMPTY_MODEL });
  const [taskHistoryState, setTaskHistoryState] = useState<TimedTaskHistoryState | null>(null);
  const taskHistory = useRef<TimedTaskHistoryController | null>(null);
  if (taskHistory.current === null) {
    taskHistory.current = new TimedTaskHistoryController(setTaskHistoryState);
  }
  const performTaskHistoryRef = useRef<(state: TimedTaskHistoryState) => Promise<void>>(async () => undefined);
  const didExecuteLaunchAction = useRef(false);

  const showFeedback = useCallback(
    (options: Toast.Options) => showMenuBarFeedback(props.launchType, options),
    [props.launchType],
  );

  const refresh = useCallback(() => {
    setState((current) => ({ ...current, isLoading: true, error: null }));
    try {
      setState({ isLoading: false, error: null, model: loadMenuBarModel(viewerTimeZone) });
    } catch (error) {
      setState({ isLoading: false, error: messageFrom(error), model: EMPTY_MODEL });
    }
  }, [viewerTimeZone]);

  useEffect(() => {
    if (!hidden) {
      refresh();
    }
  }, [hidden, refresh]);

  useEffect(() => () => taskHistory.current?.dispose(), []);

  const showHistoryToast = useCallback(
    async (title: string, message: string, nextState: TimedTaskHistoryState) => {
      const nextPresentation = timedTaskHistoryPresentation(nextState);
      await showFeedback({
        style: Toast.Style.Success,
        title,
        message,
        primaryAction: {
          title: nextPresentation.title,
          onAction: () => void performTaskHistoryRef.current(nextState),
        },
      });
    },
    [showFeedback],
  );

  const performTaskHistory = useCallback(
    async (expected: TimedTaskHistoryState) => {
      if (!taskHistory.current) {
        return;
      }
      try {
        const result = taskHistory.current.perform(expected, () => {
          const session = openProductionWorktodo();
          try {
            performTimedTaskHistoryOperation(expected, {
              complete: () => session.service.completeTask(expected.taskId),
              reopen: () => session.service.reopenTask(expected.taskId),
              trash: () => session.service.trashTask(expected.taskId),
              restore: () => session.service.restoreTask(expected.taskId),
            });
          } finally {
            session.close();
          }
        });
        if (result.status === "unavailable") {
          await showFeedback({
            style: Toast.Style.Failure,
            title: expected.direction === "undo" ? "Undo no longer available" : "Redo no longer available",
            message: expected.taskTitle,
          });
          return;
        }
        refresh();
        const completedPresentation = timedTaskHistoryPresentation(result.previous);
        await showHistoryToast(completedPresentation.successTitle, expected.taskTitle, result.state);
      } catch (error) {
        await showFeedback({
          style: Toast.Style.Failure,
          title: expected.direction === "undo" ? "Unable to undo task" : "Unable to redo task",
          message: messageFrom(error),
        });
      }
    },
    [refresh, showFeedback, showHistoryToast],
  );
  performTaskHistoryRef.current = performTaskHistory;

  const completeTaskLocally = useCallback(
    async (taskId: string) => {
      let completed: Task;
      try {
        const session = openProductionWorktodo();
        try {
          completed = session.service.completeTask(taskId);
        } finally {
          session.close();
        }
      } catch (error) {
        await showFeedback({
          style: Toast.Style.Failure,
          title: "Unable to complete task",
          message: messageFrom(error),
        });
        return;
      }

      const historyState = taskHistory.current?.record({
        kind: "complete",
        taskId: completed.id,
        taskTitle: completed.title,
      });
      if (!historyState) {
        return;
      }
      refresh();
      await showHistoryToast("Task completed", completed.title, historyState);
    },
    [refresh, showFeedback, showHistoryToast],
  );

  const hideMenuBarLocally = useCallback(async () => {
    try {
      menuBarVisibilityCache.set(MENU_BAR_HIDDEN_KEY, "true");
    } catch (error) {
      await showFeedback({
        style: Toast.Style.Failure,
        title: "Unable to hide Worktodo",
        message: messageFrom(error),
      });
      return;
    }

    taskHistory.current?.clear();
    setHidden(true);
    await showFeedback({
      style: Toast.Style.Success,
      title: "Worktodo hidden from menu bar",
      message: "Run Worktodo Menu Bar to restore it.",
    });
  }, [showFeedback]);

  useEffect(() => {
    const action = resolveMenuBarLaunchAction(
      props.launchContext,
      props.launchType === LaunchType.UserInitiated,
      didExecuteLaunchAction.current,
    );
    if (!action) {
      return;
    }

    didExecuteLaunchAction.current = true;
    if (action.action === "complete-task") {
      void completeTaskLocally(action.taskId);
    } else {
      void hideMenuBarLocally();
    }
  }, [completeTaskLocally, hideMenuBarLocally, props.launchContext, props.launchType]);

  async function completeTask(taskId: string) {
    if (props.launchType === LaunchType.Background) {
      try {
        await launchMenuBarAction({ action: "complete-task", taskId });
      } catch (error) {
        await showFeedback({
          style: Toast.Style.Failure,
          title: "Unable to complete task",
          message: messageFrom(error),
        });
      }
      return;
    }

    await completeTaskLocally(taskId);
  }

  async function openMyTasks(context: MyTasksLaunchContext) {
    try {
      await launchMyTasks(context);
    } catch (error) {
      await showFeedback({
        style: Toast.Style.Failure,
        title: "Unable to open My Tasks",
        message: messageFrom(error),
      });
    }
  }

  async function hideMenuBar() {
    if (props.launchType === LaunchType.Background) {
      try {
        await launchMenuBarAction({ action: "hide-menu-bar" });
      } catch (error) {
        await showFeedback({
          style: Toast.Style.Failure,
          title: "Unable to hide Worktodo",
          message: messageFrom(error),
        });
      }
      return;
    }

    await hideMenuBarLocally();
  }

  if (hidden) {
    return null;
  }

  const tooltip =
    state.model.count === 0
      ? "Worktodo — nothing due today"
      : `Worktodo — ${state.model.count} ${state.model.count === 1 ? "task" : "tasks"} due`;
  const historyItem = taskHistoryState ? buildMenuBarTaskHistoryItem(taskHistoryState) : null;

  return (
    <MenuBarExtra icon="extension-icon.png" title={state.model.title} tooltip={tooltip} isLoading={state.isLoading}>
      {state.error ? (
        <MenuBarExtra.Section title="Worktodo">
          <MenuBarExtra.Item title="Unable to load tasks" subtitle={state.error} icon={menuIcon(Icon.Warning)} />
        </MenuBarExtra.Section>
      ) : state.model.sections.length === 0 ? (
        <MenuBarExtra.Section title="This Week">
          <MenuBarExtra.Item title="Nothing due this week" icon={menuIcon(Icon.CheckCircle)} />
        </MenuBarExtra.Section>
      ) : (
        state.model.sections.map((section) => (
          <MenuBarExtra.Section key={section.key} title={section.title}>
            {section.tasks.map((task) => (
              <MenuBarExtra.Submenu key={task.id} title={menuBarTaskTitle(task)} icon={priorityIcon(task.priority)}>
                <MenuBarExtra.Item
                  title="Complete Task"
                  icon={menuIcon(Icon.CheckCircle)}
                  onAction={() => completeTask(task.id)}
                />
                <MenuBarExtra.Item
                  title="Open in My Tasks"
                  icon={menuIcon(Icon.AppWindowList)}
                  onAction={() => openMyTasks({ view: task.view, selectedTaskId: task.id })}
                />
              </MenuBarExtra.Submenu>
            ))}
          </MenuBarExtra.Section>
        ))
      )}

      {historyItem && taskHistoryState ? (
        <MenuBarExtra.Section title="Recent Action">
          <MenuBarExtra.Item
            title={historyItem.title}
            subtitle={historyItem.subtitle}
            icon={menuIcon(historyItem.direction === "undo" ? Icon.Undo : Icon.Redo)}
            shortcut={TASK_HISTORY_SHORTCUTS[historyItem.direction]}
            onAction={() => performTaskHistory(taskHistoryState)}
          />
        </MenuBarExtra.Section>
      ) : null}

      <MenuBarExtra.Section>
        <MenuBarExtra.Item
          title="New Task…"
          icon={menuIcon(Icon.Plus)}
          onAction={() => openMyTasks({ view: "inbox", createTask: true })}
        />
      </MenuBarExtra.Section>

      <MenuBarExtra.Section>
        <MenuBarExtra.Item title="Hide from Menu Bar" icon={menuIcon(Icon.EyeDisabled)} onAction={hideMenuBar} />
      </MenuBarExtra.Section>
    </MenuBarExtra>
  );
}
