import { Cache, Color, environment, Icon, LaunchType, MenuBarExtra, showToast, Toast } from "@raycast/api";
import { useCallback, useEffect, useState } from "react";
import { launchMyTasks } from "./raycast-commands";
import { openProductionWorktodo } from "./shared/application/worktodo";
import type { Priority } from "./shared/domain/model";
import {
  buildMenuBarModel,
  type MenuBarModel,
  type MenuBarTask,
  resolveMenuBarVisibility,
} from "./shared/presentation/menu-bar";
import type { MyTasksLaunchContext } from "./shared/presentation/task-launch";

const EMPTY_MODEL: MenuBarModel = { count: 0, title: undefined, sections: [] };
const MENU_BAR_HIDDEN_KEY = "hidden";
const menuBarVisibilityCache = new Cache({ namespace: "menu-bar-visibility" });
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
    return buildMenuBarModel(session.service.listToday(Date.now(), viewerTimeZone));
  } finally {
    session.close();
  }
}

function priorityIcon(priority: Priority) {
  return { source: Icon.Circle, tintColor: PRIORITY_TINT[priority] };
}

function menuIcon(source: Icon) {
  return { source, tintColor: Color.PrimaryText };
}

function initialMenuBarHidden(): boolean {
  const visibility = resolveMenuBarVisibility(
    menuBarVisibilityCache.has(MENU_BAR_HIDDEN_KEY),
    environment.launchType === LaunchType.UserInitiated,
  );
  if (visibility.clearStoredHidden) {
    menuBarVisibilityCache.remove(MENU_BAR_HIDDEN_KEY);
  }
  return visibility.hidden;
}

export default function Command() {
  const [viewerTimeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [hidden, setHidden] = useState(initialMenuBarHidden);
  const [state, setState] = useState<MenuState>({ isLoading: true, error: null, model: EMPTY_MODEL });

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

  async function completeTask(task: MenuBarTask) {
    try {
      const session = openProductionWorktodo();
      try {
        session.service.completeTask(task.id);
      } finally {
        session.close();
      }
      refresh();
      await showToast(Toast.Style.Success, "Task completed", task.title);
    } catch (error) {
      await showToast(Toast.Style.Failure, "Unable to complete task", messageFrom(error));
    }
  }

  async function openMyTasks(context: MyTasksLaunchContext) {
    try {
      await launchMyTasks(context);
    } catch (error) {
      await showToast(Toast.Style.Failure, "Unable to open My Tasks", messageFrom(error));
    }
  }

  async function hideMenuBar() {
    try {
      menuBarVisibilityCache.set(MENU_BAR_HIDDEN_KEY, "true");
      setHidden(true);
      await showToast(Toast.Style.Success, "Worktodo hidden from menu bar", "Run Worktodo Menu Bar to restore it.");
    } catch (error) {
      await showToast(Toast.Style.Failure, "Unable to hide Worktodo", messageFrom(error));
    }
  }

  if (hidden) {
    return null;
  }

  const tooltip =
    state.model.count === 0
      ? "Worktodo — nothing due today"
      : `Worktodo — ${state.model.count} ${state.model.count === 1 ? "task" : "tasks"} due`;

  return (
    <MenuBarExtra icon="extension-icon.png" title={state.model.title} tooltip={tooltip} isLoading={state.isLoading}>
      {state.error ? (
        <MenuBarExtra.Section title="Worktodo">
          <MenuBarExtra.Item title="Unable to load tasks" subtitle={state.error} icon={menuIcon(Icon.Warning)} />
        </MenuBarExtra.Section>
      ) : state.model.sections.length === 0 ? (
        <MenuBarExtra.Section title="Today">
          <MenuBarExtra.Item title="Nothing due today" icon={menuIcon(Icon.CheckCircle)} />
        </MenuBarExtra.Section>
      ) : (
        state.model.sections.map((section) => (
          <MenuBarExtra.Section key={section.key} title={section.title}>
            {section.tasks.map((task) => (
              <MenuBarExtra.Submenu key={task.id} title={task.title} icon={priorityIcon(task.priority)}>
                <MenuBarExtra.Item
                  title="Complete Task"
                  icon={menuIcon(Icon.CheckCircle)}
                  onAction={() => completeTask(task)}
                />
                <MenuBarExtra.Item
                  title="Open in My Tasks"
                  icon={menuIcon(Icon.AppWindowList)}
                  onAction={() => openMyTasks({ view: "today", selectedTaskId: task.id })}
                />
              </MenuBarExtra.Submenu>
            ))}
          </MenuBarExtra.Section>
        ))
      )}

      <MenuBarExtra.Section>
        <MenuBarExtra.Item
          title="Today"
          icon={menuIcon(Icon.Calendar)}
          onAction={() => openMyTasks({ view: "today" })}
        />
        <MenuBarExtra.Item title="Inbox" icon={menuIcon(Icon.Tray)} onAction={() => openMyTasks({ view: "inbox" })} />
        <MenuBarExtra.Item
          title="Upcoming"
          icon={menuIcon(Icon.Calendar)}
          onAction={() => openMyTasks({ view: "upcoming" })}
        />
        <MenuBarExtra.Item
          title="Completed"
          icon={menuIcon(Icon.CheckCircle)}
          onAction={() => openMyTasks({ view: "completed" })}
        />
        <MenuBarExtra.Item title="Trash" icon={menuIcon(Icon.Trash)} onAction={() => openMyTasks({ view: "trash" })} />
      </MenuBarExtra.Section>

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
