# Worktodo

Worktodo is a local-first personal task manager built for Raycast, with a local MCP interface for agents.

The current Raycast app opens by default to All Tasks, which groups active tasks under Inbox and their projects and sorts each group by due date. It also provides persistent Today, Upcoming, Inbox, project, section, Completed, and Trash views backed by a production SQLite database. Users can create, edit, move, complete, reopen, trash, and restore tasks with notes, priority, and optional due values. Projects and sections can be created, renamed, and removed without deleting their tasks. Quick Add and the full task form share a Project selector and optional Due Date presets for Today, Tomorrow, End of This Week, or a custom date. Quick Add also captures optional notes and defaults to Inbox with no due date. An actionable menu-bar command shows overdue tasks and tasks due through the end of the week, grouped into Today, Tomorrow, and Later This Week, with compact project labels. It supports direct completion, opens each task in the matching larger task view, and opens the full creation form. It can be hidden from its own menu and restored by running `Worktodo Menu Bar` from Raycast. A `Backup & Restore` command exports complete version 1 JSON backups and validates, previews, and atomically restores them after explicit confirmation while retaining an automatic recovery backup.

Task-domain MCP tools remain deferred.

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
