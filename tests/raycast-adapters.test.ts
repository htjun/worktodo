import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const raycast = vi.hoisted(() => ({
  launchCommand: vi.fn<(options: unknown) => Promise<void>>(),
  showHUD: vi.fn<(title: string) => Promise<void>>(),
  showToast: vi.fn<(options: unknown) => Promise<void>>(),
}));

vi.mock("@raycast/api", () => ({
  Icon: {
    ArrowCounterClockwise: "arrow-counter-clockwise",
    CheckCircle: "check-circle",
    Circle: "circle",
    Redo: "redo",
    Trash: "trash",
    Undo: "undo",
  },
  LaunchType: {
    Background: "background",
    UserInitiated: "userInitiated",
  },
  launchCommand: raycast.launchCommand,
  showHUD: raycast.showHUD,
  showToast: raycast.showToast,
}));

import { LaunchType } from "@raycast/api";
import { showMenuBarFeedback } from "../src/menu-bar-feedback";
import { launchMyTasks, requestMenuBarRefresh } from "../src/raycast-commands";
import {
  taskLifecycleHistoryActionPresentation,
  taskLifecycleMutationActionPresentation,
} from "../src/task-lifecycle-raycast";

beforeEach(() => {
  vi.resetAllMocks();
  raycast.launchCommand.mockResolvedValue(undefined);
  raycast.showHUD.mockResolvedValue(undefined);
  raycast.showToast.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Raycast command launches", () => {
  it("keeps menu bar refreshes background-launched", () => {
    requestMenuBarRefresh();

    expect(raycast.launchCommand).toHaveBeenCalledOnce();
    expect(raycast.launchCommand).toHaveBeenCalledWith({
      name: "menu-bar",
      type: LaunchType.Background,
    });
  });

  it("opens All Tasks as user-initiated", async () => {
    await launchMyTasks({ view: "upcoming", selectedTaskId: "task-1" });

    expect(raycast.launchCommand).toHaveBeenCalledWith({
      name: "my-tasks",
      type: LaunchType.UserInitiated,
      context: { view: "upcoming", selectedTaskId: "task-1" },
    });
  });

  it("opens a selected All Tasks item for editing", async () => {
    await launchMyTasks({ view: "today", selectedTaskId: "task-1", editTask: true });

    expect(raycast.launchCommand).toHaveBeenCalledWith({
      name: "my-tasks",
      type: LaunchType.UserInitiated,
      context: { view: "today", selectedTaskId: "task-1", editTask: true },
    });
  });
});

describe("Backup & Restore adapter boundary", () => {
  it("uses only the Portability service for backup workflows", () => {
    const source = readFileSync(join(process.cwd(), "src/backup-restore.tsx"), "utf8");

    expect(source).toContain("portability.exportTo(");
    expect(source).toContain("portability.prepare(");
    expect(source).toContain("portability.replace(");
    expect(source).not.toMatch(/from ["'].+\/(?:export-backup|import-preview|replace-backup|backup-workflows)["']/);
  });
});

describe("All Tasks entry points", () => {
  it("uses All Tasks wording and opens the full list from the menu bar", () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      commands: { name: string; title: string }[];
    };
    const menuBarSource = readFileSync(join(process.cwd(), "src/menu-bar.tsx"), "utf8");

    expect(manifest.commands.find((command) => command.name === "my-tasks")?.title).toBe("All Tasks");
    expect(menuBarSource).toContain('title="See All Tasks"');
    expect(menuBarSource).toContain('onAction={() => openMyTasks({ view: "all" })}');
  });
});

describe("Label UI adapters", () => {
  it("keeps Project placement flat and projects stable Label IDs through one TagPicker", () => {
    const source = readFileSync(join(process.cwd(), "src/task-form-controls.tsx"), "utf8");

    expect(source).toContain('<Form.Dropdown.Item value="inbox" title="Inbox"');
    expect(source).toContain('taskEditingPlacementKey({ kind: "project", projectId: project.id })');
    expect(source).toContain('<Form.TagPicker id="labels" title="Labels" value={value}');
    expect(source).toContain("<Form.TagPicker.Item key={label.id} value={label.id} title={label.name} />");
    expect(source).not.toContain("Section");
  });

  it("submits selected Labels from Quick Add and the full Task form", () => {
    const quickAdd = readFileSync(join(process.cwd(), "src/quick-add.tsx"), "utf8");
    const taskForm = readFileSync(join(process.cwd(), "src/task-form.tsx"), "utf8");

    expect(quickAdd).toContain("labels: session.service.listLabels()");
    expect(quickAdd).toContain("selectedLabelIds,");
    expect(quickAdd).toContain("labels={state.labels}");
    expect(taskForm).toContain("taskEditingDefaults(task, initialPlacement");
    expect(taskForm).toContain("useState(defaults.selectedLabelIds)");
    expect(taskForm).toContain("editing.assignLabels(task.id, selectedLabelIds)");
    expect(taskForm).toContain('navigationTitle="Edit Labels"');
  });

  it("offers global Label management and refreshes it through the external-mutation path", () => {
    const tasks = readFileSync(join(process.cwd(), "src/my-tasks.tsx"), "utf8");
    const management = readFileSync(join(process.cwd(), "src/project-management.tsx"), "utf8");

    expect(tasks).toContain('title="Manage Labels"');
    expect(tasks).toContain("<LabelsView service={session.service} onChanged={refreshAfterUnrelatedMutation} />");
    expect(tasks).toContain("lifecycle.current?.refreshAfterExternalMutation()");
    expect(tasks).toContain('<List.Item.Detail.Metadata.TagList title="Labels">');
    expect(tasks).toContain('title="Edit Labels"');
    expect(tasks).toContain("item.task.trashedAtMs === null");
    expect(tasks).not.toContain("item.task.completedAtMs === null && item.task.trashedAtMs === null");
    expect(management).toContain('navigationTitle="Labels"');
    expect(management).toContain("const confirmed = await confirmAlert(");
    expect(management).toContain("if (!confirmed)");
    expect(management).toContain("Only this Label and its assignments are removed.");
  });

  it("projects Label filtering, search keywords, default creation, and deleted-Label fallback", () => {
    const tasks = readFileSync(join(process.cwd(), "src/my-tasks.tsx"), "utf8");
    const views = readFileSync(join(process.cwd(), "src/task-views.tsx"), "utf8");
    const presentation = readFileSync(join(process.cwd(), "src/shared/presentation/task-list.ts"), "utf8");

    expect(views).toContain('<List.Dropdown.Section title="Labels">');
    expect(views).toContain("value={`label:${label.id}`}");
    expect(tasks).toContain("normalizeTaskView(view, projects, labels)");
    expect(tasks).toContain("initialPlacement={initialPlacementForTaskView(view)}");
    expect(tasks).toContain("initialLabelIds={initialLabelIdsForTaskView(view)}");
    expect(presentation).toContain("keywords: [placement, entry.task.notes, ...labelNames]");
  });
});

describe("menu bar feedback", () => {
  it("shows a Toast for user-initiated launches", async () => {
    const options = { title: "Task completed", message: "Submit report" };

    await showMenuBarFeedback(LaunchType.UserInitiated, options);

    expect(raycast.showToast).toHaveBeenCalledWith(options);
    expect(raycast.showHUD).not.toHaveBeenCalled();
  });

  it("uses a HUD instead of a Toast for background launches", async () => {
    await showMenuBarFeedback(LaunchType.Background, {
      title: "Unable to open All Tasks",
      message: "Command unavailable",
    });

    expect(raycast.showHUD).toHaveBeenCalledWith("Unable to open All Tasks: Command unavailable");
    expect(raycast.showToast).not.toHaveBeenCalled();
  });

  it("falls back to a HUD when a user-initiated Toast fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    raycast.showToast.mockRejectedValue(new Error("Toast unavailable"));

    await showMenuBarFeedback(LaunchType.UserInitiated, { title: "Task completed" });

    expect(raycast.showHUD).toHaveBeenCalledWith("Task completed");
    expect(consoleError).toHaveBeenCalledWith("Unable to show menu bar Toast", expect.any(Error));
  });

  it("logs and suppresses a final HUD failure", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    raycast.showHUD.mockRejectedValue(new Error("HUD unavailable"));

    await expect(
      showMenuBarFeedback(LaunchType.Background, { title: "Unable to complete task" }),
    ).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith("Unable to show menu bar HUD", expect.any(Error));
  });
});

describe("task lifecycle actions", () => {
  it.each([
    ["undo", "complete", "Undo Complete Task", "undo", ["cmd"]],
    ["redo", "complete", "Redo Complete Task", "redo", ["cmd", "shift"]],
    ["undo", "trash", "Undo Move to Trash", "undo", ["cmd"]],
    ["redo", "trash", "Redo Move to Trash", "redo", ["cmd", "shift"]],
  ] as const)("projects %s %s labels, icons, and shortcuts for Raycast", (direction, kind, title, icon, modifiers) => {
    expect(
      taskLifecycleHistoryActionPresentation({
        direction,
        kind,
        taskId: "task-1",
        taskTitle: "Submit report",
      }),
    ).toEqual({
      title,
      icon,
      shortcut: { modifiers: [...modifiers], key: "z" },
    });
  });

  it("projects mutation labels and icons without binding persistence", () => {
    expect(taskLifecycleMutationActionPresentation("complete")).toEqual({
      title: "Complete Task",
      successTitle: "Task completed",
      icon: "check-circle",
    });
    expect(taskLifecycleMutationActionPresentation("reopen")).toMatchObject({
      title: "Reopen Task",
      icon: "circle",
    });
    expect(taskLifecycleMutationActionPresentation("trash")).toMatchObject({
      title: "Move to Trash",
      icon: "trash",
    });
    expect(taskLifecycleMutationActionPresentation("restore")).toMatchObject({
      title: "Restore Task",
      icon: "arrow-counter-clockwise",
    });
  });
});
