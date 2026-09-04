import { describe, expect, it } from "vitest";
import { taskLifecycleActionKindForViewKind } from "../../src/shared/application/task-lifecycle-interaction";
import type { Project, Section, Task } from "../../src/shared/domain/model";
import { taskLifecycleMutationPresentation } from "../../src/shared/presentation/task-lifecycle";
import {
  buildAllTaskListSections,
  buildTaskListItems,
  extractTaskNoteLinks,
  taskListRowPresentation,
  taskNotesMarkdown,
} from "../../src/shared/presentation/task-list";

const project: Project = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Personal",
  position: 1_024,
  createdAtMs: 1_000,
  updatedAtMs: 1_000,
};
const section: Section = {
  id: "00000000-0000-4000-8000-000000000002",
  projectId: project.id,
  name: "Next",
  position: 1_024,
  createdAtMs: 1_000,
  updatedAtMs: 1_000,
};

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "00000000-0000-4000-8000-000000000003",
    title: "Review plan",
    notes: "Open the planning workspace",
    priority: "high",
    position: 1_024,
    projectId: project.id,
    sectionId: section.id,
    due: { kind: "allDay", date: "2026-10-04" },
    createdAtMs: 1_000,
    updatedAtMs: 1_000,
    completedAtMs: null,
    trashedAtMs: null,
    ...overrides,
  };
}

describe("task presentation mapping", () => {
  it("groups All Tasks under Inbox and non-empty projects in project order", () => {
    const work: Project = { ...project, id: "work", name: "Work", position: 2_048 };
    const empty: Project = { ...project, id: "empty", name: "Empty", position: 3_072 };
    const inboxTask = task({ id: "inbox", projectId: null, sectionId: null });
    const workTask = task({ id: "work-task", projectId: work.id, sectionId: null });
    const directPersonalTask = task({ id: "personal-direct", sectionId: null });
    const sectionPersonalTask = task({ id: "personal-section" });

    const groups = buildAllTaskListSections(
      [inboxTask, workTask, directPersonalTask, sectionPersonalTask],
      [work, empty, project],
      [section],
      "Australia/Melbourne",
    );

    expect(groups.map(({ key, title }) => ({ key, title }))).toEqual([
      { key: "all:inbox", title: "Inbox" },
      { key: "all:project:work", title: "Work" },
      { key: `all:project:${project.id}`, title: "Personal" },
    ]);
    expect(groups.map((group) => group.items.map((item) => [item.id, item.subtitle]))).toEqual([
      [["inbox", "Inbox"]],
      [["work-task", "Work"]],
      [
        ["personal-direct", "Personal"],
        ["personal-section", "Personal / Next"],
      ],
    ]);
  });

  it("preserves query order and supplies due, priority, and placement metadata", () => {
    const first = task();
    const second = task({
      id: "00000000-0000-4000-8000-000000000004",
      title: "Inbox task",
      projectId: null,
      sectionId: null,
      priority: "none",
      due: { kind: "none" },
    });
    const items = buildTaskListItems(
      [{ task: first, todayStatus: "overdue" }, { task: second }],
      [project],
      [section],
      "Australia/Melbourne",
    );
    expect(items.map((item) => item.id)).toEqual([first.id, second.id]);
    expect(items[0]).toMatchObject({
      subtitle: "Personal / Next",
      metadata: ["high priority", "Overdue 2026-10-04"],
      keywords: ["Personal / Next", "Open the planning workspace"],
    });
    expect(items[1]).toMatchObject({ subtitle: "Inbox", metadata: [] });
  });

  it("builds deterministic detail metadata for every placement and due kind", () => {
    const timedAtMs = Date.parse("2026-10-04T02:30:00.000Z");
    const timedLabel = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Australia/Melbourne",
    }).format(new Date(timedAtMs));
    const sourceTasks = [
      task({
        id: "00000000-0000-4000-8000-000000000010",
        projectId: null,
        sectionId: null,
        priority: "none",
        due: { kind: "none" },
      }),
      task({
        id: "00000000-0000-4000-8000-000000000011",
        projectId: project.id,
        sectionId: null,
        priority: "low",
        due: { kind: "allDay", date: "2026-10-04" },
      }),
      task({
        id: "00000000-0000-4000-8000-000000000012",
        priority: "medium",
        due: { kind: "timed", instantMs: timedAtMs, timeZone: "Australia/Melbourne" },
      }),
    ];
    const before = structuredClone(sourceTasks);
    const entries = [
      { task: sourceTasks[0] },
      { task: sourceTasks[1], todayStatus: "overdue" as const },
      { task: sourceTasks[2], todayStatus: "dueToday" as const },
    ];

    const first = buildTaskListItems(entries, [project], [section], "Australia/Melbourne");
    const second = buildTaskListItems(entries, [project], [section], "Australia/Melbourne");

    expect(first.map((item) => item.detail.metadata.slice(0, 3))).toEqual([
      [
        { title: "Project", text: "Inbox" },
        { title: "Priority", text: "None" },
        { title: "Due Date", text: "None" },
      ],
      [
        { title: "Project", text: "Personal" },
        { title: "Priority", text: "Low" },
        { title: "Overdue", text: "2026-10-04" },
      ],
      [
        { title: "Project", text: "Personal / Next" },
        { title: "Priority", text: "Medium" },
        { title: "Today", text: timedLabel },
      ],
    ]);
    expect(second.map((item) => item.detail)).toEqual(first.map((item) => item.detail));
    expect(sourceTasks).toEqual(before);
  });

  it("renders notes literally and extracts distinct valid web links", () => {
    const notes = "# Heading\n- [ ] Use *literal* text\n[Docs](https://example.com/path).";
    expect(taskNotesMarkdown(notes)).toBe(
      "## Notes\n\n\\# Heading  \n\\- \\[ \\] Use \\*literal\\* text  \n\\[Docs\\]\\(https\\:\\/\\/example\\.com\\/path\\)\\.",
    );
    expect(taskNotesMarkdown("")).toBe("## Notes\n\n_No notes_");
    expect(
      extractTaskNoteLinks(
        "https://example.com/path, HTTPS://EXAMPLE.COM/path. https://example.org/a_(b). https://? http://localhost:8080/test ftp://example.net",
      ),
    ).toEqual(["https://example.com/path", "https://example.org/a_(b)", "http://localhost:8080/test"]);
  });

  it("maps lifecycle actions for safe secondary placement", () => {
    for (const viewKind of ["all", "today", "upcoming", "inbox", "project", "section"]) {
      const kind = taskLifecycleActionKindForViewKind(viewKind);
      expect({ kind, ...taskLifecycleMutationPresentation(kind) }).toEqual({
        kind: "complete",
        title: "Complete Task",
        successTitle: "Task completed",
      });
    }
    const reopen = taskLifecycleActionKindForViewKind("completed");
    expect({ kind: reopen, ...taskLifecycleMutationPresentation(reopen) }).toEqual({
      kind: "reopen",
      title: "Reopen Task",
      successTitle: "Task reopened",
    });
    const restore = taskLifecycleActionKindForViewKind("trash");
    expect({ kind: restore, ...taskLifecycleMutationPresentation(restore) }).toEqual({
      kind: "restore",
      title: "Restore Task",
      successTitle: "Task restored",
    });
  });

  it("shows completion acknowledgement without changing the task title or source item", () => {
    const source = task({ priority: "medium", due: { kind: "none" } });
    const [item] = buildTaskListItems([{ task: source }], [], [], "Australia/Melbourne");
    const before = structuredClone(item);
    const completed = { ...source, completedAtMs: 2_000, updatedAtMs: 2_000 };

    expect(taskListRowPresentation(item, completed)).toEqual({
      title: source.title,
      accessories: ["Completed"],
      isCompletionAcknowledged: true,
    });
    expect(taskListRowPresentation(item, undefined)).toEqual({
      title: source.title,
      accessories: ["medium priority"],
      isCompletionAcknowledged: false,
    });
    expect(item).toEqual(before);
    expect(source.completedAtMs).toBeNull();
  });

  it("shows independent completion and trash timestamps", () => {
    const completedAtMs = Date.parse("2026-10-04T01:00:00.000Z");
    const trashedAtMs = Date.parse("2026-10-04T02:00:00.000Z");
    const format = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Australia/Melbourne",
    });
    const [item] = buildTaskListItems(
      [
        {
          task: task({
            priority: "none",
            due: { kind: "none" },
            completedAtMs,
            trashedAtMs,
          }),
        },
      ],
      [project],
      [section],
      "Australia/Melbourne",
    );

    expect(item.metadata).toEqual([
      `Completed ${format.format(new Date(completedAtMs))}`,
      `Trashed ${format.format(new Date(trashedAtMs))}`,
    ]);
    expect(item.detail.metadata).toEqual([
      { title: "Project", text: "Personal / Next" },
      { title: "Priority", text: "None" },
      { title: "Due Date", text: "None" },
      { title: "Created", text: format.format(new Date(1_000)) },
      { title: "Updated", text: format.format(new Date(1_000)) },
      { title: "Completed", text: format.format(new Date(completedAtMs)) },
      { title: "Trashed", text: format.format(new Date(trashedAtMs)) },
    ]);
  });
});
