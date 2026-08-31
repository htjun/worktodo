import type { Task } from "../domain/model";
import type { TaskService } from "../domain/task-service";
import { performTimedTaskHistoryOperation, type TimedTaskHistoryState } from "./timed-task-history";
import { buildMenuBarModel, resolveMenuBarVisibility, type MenuBarModel } from "../presentation/menu-bar";
import { loadTaskView } from "./task-views";

type MenuBarSession = { service: TaskService; close: () => void };

type MenuBarVisibilityStore = {
  has(key: string): boolean;
  remove(key: string): void;
  set(key: string, value: string): void;
};

const MENU_BAR_HIDDEN_KEY = "hidden";

export function loadMenuBarModel(
  openSession: () => MenuBarSession,
  viewerTimeZone: string,
  evaluationInstantMs: number,
): MenuBarModel {
  const session = openSession();
  try {
    const context = { evaluationInstantMs, viewerTimeZone };
    const today = loadTaskView(session.service, { kind: "today" }, context);
    const upcoming = loadTaskView(session.service, { kind: "upcoming" }, context);
    return buildMenuBarModel(today.result, upcoming.result, session.service.listProjects());
  } finally {
    session.close();
  }
}

export function completeMenuBarTask(openSession: () => MenuBarSession, taskId: string): Task {
  const session = openSession();
  try {
    return session.service.completeTask(taskId);
  } finally {
    session.close();
  }
}

export function performMenuBarTaskHistory(openSession: () => MenuBarSession, state: TimedTaskHistoryState): void {
  const session = openSession();
  try {
    performTimedTaskHistoryOperation(state, {
      complete: () => session.service.completeTask(state.taskId),
      reopen: () => session.service.reopenTask(state.taskId),
      trash: () => session.service.trashTask(state.taskId),
      restore: () => session.service.restoreTask(state.taskId),
    });
  } finally {
    session.close();
  }
}

export function initialMenuBarHidden(store: MenuBarVisibilityStore, userInitiated: boolean): boolean {
  const visibility = resolveMenuBarVisibility(store.has(MENU_BAR_HIDDEN_KEY), userInitiated);
  if (visibility.clearStoredHidden) {
    store.remove(MENU_BAR_HIDDEN_KEY);
  }
  return visibility.hidden;
}

export function hideMenuBar(store: MenuBarVisibilityStore): void {
  store.set(MENU_BAR_HIDDEN_KEY, "true");
}
