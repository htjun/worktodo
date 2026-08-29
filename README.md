# Worktodo

Worktodo is a local-first personal task manager built for Raycast, with a local MCP interface for agents.

The current Raycast slice provides persistent Today and Inbox views backed by a production SQLite database. Users can create, edit, and complete tasks with notes, priority, and optional all-day or timed due values.

Project and section management, Completed and Trash views, Quick Add, menu-bar behavior, and task-domain MCP tools remain deferred.

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
