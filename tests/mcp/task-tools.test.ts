import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport, type CallToolResult } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "../../mcp/create-server";
import { TaskService } from "../../src/shared/domain/task-service";
import { openWorktodoDatabase } from "../../src/shared/storage/database";
import { applyMigrations } from "../../src/shared/storage/schema";
import { SqliteTaskRepository } from "../../src/shared/storage/sqlite-task-repository";

const temporaryDirectories: string[] = [];

function id(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

async function createContext() {
  const directory = await mkdtemp(join(tmpdir(), "worktodo-mcp-test-"));
  temporaryDirectories.push(directory);
  const db = openWorktodoDatabase(join(directory, "worktodo.sqlite"));
  applyMigrations(db);
  const repository = new SqliteTaskRepository(db);
  let nextId = 1;
  let closeCount = 0;
  const service = new TaskService(repository, { createId: () => id(nextId++), now: () => 1_000 });
  const server = createServer({
    openSession: () => ({
      service,
      close: () => {
        closeCount += 1;
      },
    }),
    now: () => Date.parse("2026-08-31T02:00:00.000Z"),
    viewerTimeZone: () => "Australia/Melbourne",
  });
  const client = new Client({ name: "worktodo-task-tools-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    server,
    service,
    getCloseCount: () => closeCount,
    close: async () => {
      await client.close();
      await server.close();
      db.close();
    },
  };
}

async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  return client.callTool({ name, arguments: args });
}

function taskFrom(result: CallToolResult): Record<string, unknown> {
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toHaveProperty("task");
  return result.structuredContent?.task as Record<string, unknown>;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Worktodo MCP task tools", () => {
  it("advertises bounded tools, server instructions, and accurate safety annotations", async () => {
    const context = await createContext();
    try {
      const { tools } = await context.client.listTools();
      const byName = new Map(tools.map((tool) => [tool.name, tool]));

      expect([...byName.keys()].sort()).toEqual(
        [
          "complete_task",
          "create_task",
          "get_task",
          "list_projects",
          "list_tasks",
          "move_task",
          "ping",
          "reopen_task",
          "restore_task",
          "trash_task",
          "update_task",
        ].sort(),
      );
      expect(byName.get("list_tasks")?.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      expect(byName.get("create_task")?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      });
      for (const name of ["update_task", "move_task", "complete_task", "reopen_task", "trash_task", "restore_task"]) {
        expect(byName.get(name)?.annotations).toMatchObject({
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        });
      }
      expect(context.client.getInstructions()).toContain("Use list_projects and list_tasks to resolve stable IDs");
    } finally {
      await context.close();
    }
  });

  it("lists placements and runs the complete recoverable task lifecycle", async () => {
    const context = await createContext();
    try {
      const project = context.service.createProject("Work");
      const section = context.service.createSection(project.id, "Next");
      const projectsResult = await callTool(context.client, "list_projects", { query: "next" });

      expect(projectsResult.isError).not.toBe(true);
      expect(projectsResult.structuredContent).toMatchObject({
        total: 1,
        projects: [{ id: project.id, name: "Work", sections: [{ id: section.id, name: "Next" }] }],
      });

      const created = taskFrom(
        await callTool(context.client, "create_task", {
          title: "Ship MCP tools",
          notes: "Follow the roadmap",
          priority: "high",
          placement: { kind: "section", projectId: project.id, sectionId: section.id },
          due: { kind: "allDay", date: "2026-08-31" },
        }),
      );
      expect(created).toMatchObject({
        title: "Ship MCP tools",
        priority: "high",
        placement: { kind: "section", projectId: project.id, sectionId: section.id },
      });
      const taskId = created.id as string;

      const listed = await callTool(context.client, "list_tasks", {
        view: "section",
        sectionId: section.id,
        query: "roadmap",
        limit: 1,
      });
      expect(listed.structuredContent).toMatchObject({
        view: "section",
        query: "roadmap",
        offset: 0,
        limit: 1,
        total: 1,
        hasMore: false,
        tasks: [{ id: taskId }],
      });

      expect(taskFrom(await callTool(context.client, "get_task", { id: taskId }))).toMatchObject({ id: taskId });
      expect(
        taskFrom(
          await callTool(context.client, "update_task", {
            id: taskId,
            title: "Ship bounded MCP tools",
            priority: "medium",
            due: { kind: "timed", instantMs: 1_788_139_800_000, timeZone: "Australia/Melbourne" },
          }),
        ),
      ).toMatchObject({ title: "Ship bounded MCP tools", priority: "medium", due: { kind: "timed" } });
      expect(
        taskFrom(await callTool(context.client, "move_task", { id: taskId, placement: { kind: "inbox" } })),
      ).toMatchObject({ placement: { kind: "inbox" } });

      const completed = taskFrom(await callTool(context.client, "complete_task", { id: taskId }));
      expect(completed.completedAtMs).toEqual(expect.any(Number));
      const completedList = await callTool(context.client, "list_tasks", { view: "completed" });
      expect(completedList.structuredContent).toMatchObject({ total: 1, tasks: [{ id: taskId }] });

      expect(taskFrom(await callTool(context.client, "reopen_task", { id: taskId }))).toMatchObject({
        completedAtMs: null,
      });
      expect(taskFrom(await callTool(context.client, "trash_task", { id: taskId }))).toMatchObject({
        trashedAtMs: expect.any(Number),
      });
      const trashList = await callTool(context.client, "list_tasks", { view: "trash" });
      expect(trashList.structuredContent).toMatchObject({ total: 1, tasks: [{ id: taskId }] });
      expect(taskFrom(await callTool(context.client, "restore_task", { id: taskId }))).toMatchObject({
        completedAtMs: null,
        trashedAtMs: null,
      });

      expect(context.getCloseCount()).toBe(12);
    } finally {
      await context.close();
    }
  });

  it("paginates after filtering and evaluates Today in the selected timezone", async () => {
    const context = await createContext();
    try {
      context.service.createTask({
        title: "First report",
        placement: { kind: "inbox" },
        due: { kind: "allDay", date: "2026-08-31" },
      });
      context.service.createTask({
        title: "Second report",
        placement: { kind: "inbox" },
        due: { kind: "allDay", date: "2026-08-31" },
      });
      context.service.createTask({ title: "Unscheduled", placement: { kind: "inbox" } });

      const result = await callTool(context.client, "list_tasks", {
        view: "today",
        timeZone: "Australia/Victoria",
        query: "report",
        offset: 1,
        limit: 1,
      });

      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        view: "today",
        query: "report",
        timeZone: "Australia/Melbourne",
        evaluatedAtMs: Date.parse("2026-08-31T02:00:00.000Z"),
        offset: 1,
        limit: 1,
        total: 2,
        hasMore: false,
        tasks: [{ title: "Second report" }],
      });
    } finally {
      await context.close();
    }
  });

  it("exposes every canonical task view through the adapter", async () => {
    const context = await createContext();
    try {
      const project = context.service.createProject("Work");
      const section = context.service.createSection(project.id, "Next");
      const inbox = context.service.createTask({ title: "Inbox", placement: { kind: "inbox" } });
      const today = context.service.createTask({
        title: "Today",
        placement: { kind: "project", projectId: project.id },
        due: { kind: "allDay", date: "2026-08-31" },
      });
      const upcoming = context.service.createTask({
        title: "Tomorrow",
        placement: { kind: "section", projectId: project.id, sectionId: section.id },
        due: { kind: "allDay", date: "2026-09-01" },
      });
      context.service.completeTask(today.id);
      context.service.trashTask(inbox.id);

      const views: Array<[Record<string, unknown>, string[]]> = [
        [{ view: "all" }, [upcoming.id]],
        [{ view: "today" }, []],
        [{ view: "upcoming" }, [upcoming.id]],
        [{ view: "inbox" }, []],
        [{ view: "completed" }, [today.id]],
        [{ view: "trash" }, [inbox.id]],
        [{ view: "project", projectId: project.id }, [upcoming.id]],
        [{ view: "section", sectionId: section.id }, [upcoming.id]],
      ];

      for (const [args, expectedIds] of views) {
        const result = await callTool(context.client, "list_tasks", args);
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).toMatchObject({
          view: args.view,
          evaluatedAtMs: Date.parse("2026-08-31T02:00:00.000Z"),
          timeZone: "Australia/Melbourne",
        });
        const tasks = result.structuredContent?.tasks as Array<{ id: string }>;
        expect(tasks.map((task) => task.id)).toEqual(expectedIds);
      }

      expect(context.getCloseCount()).toBe(8);
    } finally {
      await context.close();
    }
  });

  it("returns bounded domain errors and suppresses unexpected infrastructure details", async () => {
    const context = await createContext();
    try {
      const invalidView = await callTool(context.client, "list_tasks", { view: "project" });
      expect(invalidView).toMatchObject({ isError: true });
      expect(invalidView.content).toEqual([
        { type: "text", text: "INVALID_ARGUMENT: The project view requires only projectId" },
      ]);

      const invalidSection = await callTool(context.client, "list_tasks", {
        view: "section",
        projectId: id(1),
        sectionId: id(2),
      });
      expect(invalidSection).toMatchObject({ isError: true });
      expect(invalidSection.content).toEqual([
        { type: "text", text: "INVALID_ARGUMENT: The section view requires only sectionId" },
      ]);

      const missingSection = await callTool(context.client, "list_tasks", { view: "section", sectionId: id(999) });
      expect(missingSection).toMatchObject({ isError: true });
      expect(missingSection.content).toEqual([{ type: "text", text: "NOT_FOUND: Section not found" }]);

      const invalidTimeZone = await callTool(context.client, "list_tasks", {
        view: "inbox",
        timeZone: "not/a-zone",
      });
      expect(invalidTimeZone).toMatchObject({ isError: true });
      expect(invalidTimeZone.content).toEqual([
        { type: "text", text: "INVALID_DUE_VALUE: Timed due timezone is invalid" },
      ]);

      const missingTask = await callTool(context.client, "get_task", { id: id(999) });
      expect(missingTask).toMatchObject({ isError: true });
      expect(missingTask.content).toEqual([{ type: "text", text: "NOT_FOUND: Task not found" }]);

      const emptyUpdate = await callTool(context.client, "update_task", { id: id(999) });
      expect(emptyUpdate).toMatchObject({ isError: true });
      expect(emptyUpdate.content).toEqual([
        { type: "text", text: "INVALID_ARGUMENT: Provide at least one task field to update" },
      ]);
      expect(context.getCloseCount()).toBe(6);
    } finally {
      await context.close();
    }

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const server = createServer({
      openSession: () => {
        throw new Error("private database path");
      },
    });
    const client = new Client({ name: "worktodo-failure-test", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const result = await callTool(client, "get_task", { id: id(1) });
      expect(result).toMatchObject({ isError: true });
      expect(result.content).toEqual([
        { type: "text", text: "INTERNAL_ERROR: Worktodo could not complete the operation" },
      ]);
      expect(JSON.stringify(result)).not.toContain("private database path");
      expect(consoleError).toHaveBeenCalledWith("Worktodo MCP get_task failed", expect.any(Error));
    } finally {
      await client.close();
      await server.close();
    }
  });
});
