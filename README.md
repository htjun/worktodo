# Worktodo

Worktodo is a local-first personal task manager built for Raycast, with a local MCP interface for agents.

The current Raycast app provides persistent Today, Upcoming, Inbox, project, section, Completed, and Trash views backed by a production SQLite database. Users can create, edit, move, complete, reopen, trash, and restore tasks with notes, priority, and optional all-day or timed due values. Projects and sections can be created, renamed, and removed without deleting their tasks.

Quick Add, actionable menu-bar behavior, JSON backup/export/import, and task-domain MCP tools remain deferred.

## Requirements

- Raycast v2 on macOS
- Node 24.18.0
- npm 11.16.0

## Development

```sh
npm install
npm run dev
```

Use `npm run verify` for the complete automated check. Build and run the MCP server, which currently exposes its diagnostic `ping` tool, with `npm run dev:mcp`.

Worktodo stores personal task data at `~/Library/Application Support/Worktodo/worktodo.sqlite`.

Durable product research lives in `docs/research/`.
