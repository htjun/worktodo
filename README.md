# Worktodo

Worktodo is a local-first personal task manager built for Raycast, with a local MCP interface for agents.

The current Raycast app provides persistent Today, Upcoming, Inbox, project, section, Completed, and Trash views backed by a production SQLite database. Users can create, edit, move, complete, reopen, trash, and restore tasks with notes, priority, and optional all-day or timed due values. Projects and sections can be created, renamed, and removed without deleting their tasks. A title-first Quick Add command captures a task directly to Inbox. An actionable menu-bar command shows overdue and due-today tasks, supports direct completion, and opens the larger task views and full creation form. It can be hidden from its own menu and restored by running `Worktodo Menu Bar` from Raycast.

JSON backup/export/import and task-domain MCP tools remain deferred.

## Requirements

- Raycast v2 on macOS
- Node 24.18.0
- pnpm 11.24.0 via Corepack

## Development

```sh
corepack pnpm install
corepack pnpm run dev
```

Use `corepack pnpm run verify` for the complete automated check. Build and run the MCP server, which currently exposes its diagnostic `ping` tool, with `corepack pnpm run dev:mcp`.

Worktodo stores personal task data at `~/Library/Application Support/Worktodo/worktodo.sqlite`.

Durable product research lives in `docs/research/`.
