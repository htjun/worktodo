import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const raycast = vi.hoisted(() => ({
  launchCommand: vi.fn<(options: unknown) => Promise<void>>(),
  showHUD: vi.fn<(title: string) => Promise<void>>(),
  showToast: vi.fn<(options: unknown) => Promise<void>>(),
}));

vi.mock("@raycast/api", () => ({
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

  it("opens My Tasks as user-initiated", async () => {
    await launchMyTasks({ view: "upcoming", selectedTaskId: "task-1" });

    expect(raycast.launchCommand).toHaveBeenCalledWith({
      name: "my-tasks",
      type: LaunchType.UserInitiated,
      context: { view: "upcoming", selectedTaskId: "task-1" },
    });
  });

  it("opens a selected My Tasks item for editing", async () => {
    await launchMyTasks({ view: "today", selectedTaskId: "task-1", editTask: true });

    expect(raycast.launchCommand).toHaveBeenCalledWith({
      name: "my-tasks",
      type: LaunchType.UserInitiated,
      context: { view: "today", selectedTaskId: "task-1", editTask: true },
    });
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
      title: "Unable to open My Tasks",
      message: "Command unavailable",
    });

    expect(raycast.showHUD).toHaveBeenCalledWith("Unable to open My Tasks: Command unavailable");
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
