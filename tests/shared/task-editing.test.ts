import { describe, expect, it, vi } from "vitest";
import {
  createOperationScopedTaskEditingMutations,
  TaskEditingInteraction,
  taskEditingDefaults,
  taskEditingPlacementFromKey,
  taskEditingPlacementKey,
  type TaskEditingContext,
  type TaskEditingMutations,
  type TaskEditingValues,
} from "../../src/shared/application/task-editing";
import { DomainError, placementFields, type Project, type Section, type Task } from "../../src/shared/domain/model";

const project: Project = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Work",
  position: 1_024,
  createdAtMs: 1_000,
  updatedAtMs: 1_000,
};
const otherProject: Project = {
  ...project,
  id: "00000000-0000-4000-8000-000000000002",
  name: "Personal",
};
const section: Section = {
  id: "00000000-0000-4000-8000-000000000003",
  projectId: project.id,
  name: "Next",
  position: 1_024,
  createdAtMs: 1_000,
  updatedAtMs: 1_000,
};
const referenceInstantMs = Date.parse("2026-08-30T14:30:00.000Z");

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "00000000-0000-4000-8000-000000000004",
    title: "Review plan",
    notes: "Keep the behavior",
    priority: "medium",
    position: 1_024,
    projectId: null,
    sectionId: null,
    due: { kind: "none" },
    createdAtMs: 1_000,
    updatedAtMs: 1_000,
    completedAtMs: null,
    trashedAtMs: null,
    ...overrides,
  };
}

function context(overrides: Partial<TaskEditingContext> = {}): TaskEditingContext {
  return {
    referenceInstantMs,
    viewerTimeZone: "Australia/Melbourne",
    projects: [project, otherProject],
    sections: [section],
    ...overrides,
  };
}

function values(overrides: Partial<TaskEditingValues> = {}): TaskEditingValues {
  return {
    title: "Review plan",
    notes: "Keep the behavior",
    priority: "medium",
    dueDatePreset: "none",
    customDueAtMs: null,
    selectedPlacement: taskEditingPlacementKey({ kind: "inbox" }),
    ...overrides,
  };
}

function mutations() {
  return {
    createTask: vi.fn<TaskEditingMutations["createTask"]>((input) =>
      task({
        title: input.title,
        notes: input.notes ?? "",
        priority: input.priority ?? "none",
        ...placementFields(input.placement),
        due: input.due ?? { kind: "none" },
      }),
    ),
    updateTask: vi.fn<TaskEditingMutations["updateTask"]>((_taskId, input) =>
      task({ title: input.title, notes: input.notes, priority: input.priority, due: input.due }),
    ),
    moveTask: vi.fn<TaskEditingMutations["moveTask"]>((_taskId, placement) => task(placementFields(placement))),
  };
}

describe("Task editing interaction", () => {
  it("owns new and edit defaults for every Due kind", () => {
    expect(
      taskEditingDefaults(
        undefined,
        { kind: "section", projectId: project.id, sectionId: section.id },
        referenceInstantMs,
        "Australia/Melbourne",
      ),
    ).toEqual({
      title: "",
      notes: "",
      priority: "none",
      dueDatePreset: "none",
      customDueAtMs: null,
      selectedPlacement: taskEditingPlacementKey({ kind: "section", projectId: project.id, sectionId: section.id }),
    });

    expect(
      taskEditingDefaults(
        task({
          projectId: project.id,
          due: { kind: "allDay", date: "2026-08-31" },
        }),
        { kind: "inbox" },
        referenceInstantMs,
        "Australia/Melbourne",
      ),
    ).toMatchObject({
      dueDatePreset: "today",
      customDueAtMs: Date.parse("2026-08-30T14:00:00.000Z"),
      selectedPlacement: taskEditingPlacementKey({ kind: "project", projectId: project.id }),
    });

    expect(
      taskEditingDefaults(
        task({ due: { kind: "timed", instantMs: 2_000_000, timeZone: "Pacific/Auckland" } }),
        { kind: "inbox" },
        referenceInstantMs,
        "America/Los_Angeles",
      ),
    ).toMatchObject({ dueDatePreset: "custom", customDueAtMs: 2_000_000 });
  });

  it.each([
    ["none", { kind: "none" }],
    ["today", { kind: "allDay", date: "2026-08-31" }],
    ["tomorrow", { kind: "allDay", date: "2026-09-01" }],
    ["endOfWeek", { kind: "allDay", date: "2026-09-06" }],
  ] as const)("creates the %s Due preset through one interface", (dueDatePreset, due) => {
    const adapter = mutations();
    const outcome = new TaskEditingInteraction(adapter).save(undefined, values({ dueDatePreset }), context());

    expect(outcome).toMatchObject({ status: "succeeded", operation: "create", task: { due } });
    expect(adapter.createTask).toHaveBeenCalledWith(expect.objectContaining({ due }));
  });

  it("converts custom dates in the explicit viewer timezone", () => {
    const adapter = mutations();
    const customDueAtMs = Date.parse("2026-08-31T06:30:00.000Z");

    new TaskEditingInteraction(adapter).save(
      undefined,
      values({ dueDatePreset: "custom", customDueAtMs }),
      context({ viewerTimeZone: "America/Los_Angeles" }),
    );

    expect(adapter.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ due: { kind: "allDay", date: "2026-08-30" } }),
    );
  });

  it("preserves an unchanged timed Due exactly and treats a changed value as all-day", () => {
    const original = task({ due: { kind: "timed", instantMs: 2_000_000, timeZone: "Pacific/Auckland" } });
    const adapter = mutations();
    const editing = new TaskEditingInteraction(adapter);

    editing.save(
      original,
      values({ dueDatePreset: "custom", customDueAtMs: original.due.kind === "timed" ? original.due.instantMs : 0 }),
      context({ viewerTimeZone: "America/Los_Angeles" }),
    );
    expect(adapter.updateTask).toHaveBeenLastCalledWith(
      original.id,
      expect.objectContaining({ due: { kind: "timed", instantMs: 2_000_000, timeZone: "Pacific/Auckland" } }),
    );

    const changedDueAtMs = Date.parse("2026-08-31T06:30:00.000Z");
    editing.save(
      original,
      values({ dueDatePreset: "custom", customDueAtMs: changedDueAtMs }),
      context({ viewerTimeZone: "America/Los_Angeles" }),
    );
    expect(adapter.updateTask).toHaveBeenLastCalledWith(
      original.id,
      expect.objectContaining({ due: { kind: "allDay", date: "2026-08-30" } }),
    );
  });

  it.each([
    ["Inbox", taskEditingPlacementKey({ kind: "inbox" }), { kind: "inbox" }],
    [
      "Project",
      taskEditingPlacementKey({ kind: "project", projectId: project.id }),
      { kind: "project", projectId: project.id },
    ],
    [
      "Section",
      taskEditingPlacementKey({ kind: "section", projectId: project.id, sectionId: section.id }),
      { kind: "section", projectId: project.id, sectionId: section.id },
    ],
  ] as const)("resolves %s creation against the current catalog", (_label, selectedPlacement, placement) => {
    const adapter = mutations();
    const outcome = new TaskEditingInteraction(adapter).save(undefined, values({ selectedPlacement }), context());

    expect(outcome.status).toBe("succeeded");
    expect(adapter.createTask).toHaveBeenCalledWith(expect.objectContaining({ placement }));
  });

  it.each([
    ["missing Project", taskEditingPlacementKey({ kind: "project", projectId: project.id }), [], [section]],
    [
      "missing Section",
      taskEditingPlacementKey({ kind: "section", projectId: project.id, sectionId: section.id }),
      [project],
      [],
    ],
    [
      "mismatched Project and Section",
      taskEditingPlacementKey({ kind: "section", projectId: otherProject.id, sectionId: section.id }),
      [project, otherProject],
      [section],
    ],
  ] as const)("returns a stable Placement failure for %s", (_label, selectedPlacement, projects, sections) => {
    const adapter = mutations();
    const outcome = new TaskEditingInteraction(adapter).save(
      undefined,
      values({ selectedPlacement }),
      context({ projects, sections }),
    );

    expect(outcome).toEqual({
      status: "failed",
      operation: "create",
      field: "placement",
      message: "Choose an existing project or section",
    });
    expect(adapter.createTask).not.toHaveBeenCalled();
  });

  it("returns field-aware validation and persistence failures", () => {
    const adapter = mutations();
    const editing = new TaskEditingInteraction(adapter);

    expect(editing.save(undefined, values({ title: "  " }), context())).toEqual({
      status: "failed",
      operation: "create",
      field: "title",
      message: "Title cannot be empty",
    });
    expect(editing.save(undefined, values({ dueDatePreset: "custom", customDueAtMs: null }), context())).toEqual({
      status: "failed",
      operation: "create",
      field: "due",
      message: "Choose a custom due date",
    });

    adapter.createTask.mockImplementationOnce(() => {
      throw new Error("Database unavailable");
    });
    expect(editing.save(undefined, values(), context())).toEqual({
      status: "failed",
      operation: "create",
      field: "form",
      message: "Database unavailable",
    });

    adapter.updateTask.mockImplementationOnce(() => {
      throw new DomainError("INVALID_DUE_VALUE", "Stored Due is invalid");
    });
    expect(editing.save(task(), values(), context())).toEqual({
      status: "failed",
      operation: "update",
      field: "due",
      message: "Stored Due is invalid",
    });
  });

  it("uses identical create semantics for long-lived and operation-scoped adapters", () => {
    const direct = mutations();
    const scoped = mutations();
    const close = vi.fn();
    const submission = values({
      title: " Shared values ",
      dueDatePreset: "tomorrow",
      selectedPlacement: taskEditingPlacementKey({ kind: "project", projectId: project.id }),
    });

    new TaskEditingInteraction(direct).save(undefined, submission, context());
    new TaskEditingInteraction(createOperationScopedTaskEditingMutations(() => ({ service: scoped, close }))).save(
      undefined,
      submission,
      context(),
    );

    expect(scoped.createTask).toHaveBeenCalledWith(direct.createTask.mock.calls[0][0]);
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes an operation-scoped session after persistence failure", () => {
    const adapter = mutations();
    adapter.createTask.mockImplementationOnce(() => {
      throw new Error("Write failed");
    });
    const close = vi.fn();
    const editing = new TaskEditingInteraction(
      createOperationScopedTaskEditingMutations(() => ({ service: adapter, close })),
    );

    expect(editing.save(undefined, values(), context())).toMatchObject({ status: "failed", field: "form" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("moves through the same catalog-aware interface without coupling editing to Placement state", () => {
    const adapter = mutations();
    const editing = new TaskEditingInteraction(adapter);
    const selectedPlacement = taskEditingPlacementKey({
      kind: "section",
      projectId: project.id,
      sectionId: section.id,
    });

    expect(editing.move(task().id, selectedPlacement, [project], [section])).toMatchObject({
      status: "succeeded",
      operation: "move",
      task: { projectId: project.id, sectionId: section.id },
    });
    expect(taskEditingPlacementFromKey(selectedPlacement, [project], [section])).toEqual({
      kind: "section",
      projectId: project.id,
      sectionId: section.id,
    });
  });
});
