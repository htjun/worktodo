# Worktodo

Worktodo is a local-first personal task manager built for Raycast, with a local MCP interface for agents.

The current Raycast app opens by default to All Tasks, which groups active tasks under No project and their projects and sorts each group by due date. Its primary dropdown presents All tasks, Today, and This week, followed by projects, with Completed and Trash in a final status section. This week includes overdue tasks and tasks due through Sunday in the viewer's timezone. Users can create, edit, move, complete, reopen, trash, and restore tasks with notes, priority, optional due values, and any number of global Labels. Projects and Labels can be managed independently; removing either never deletes a task. Quick Add and the full task form share a flat optional Project selector, a multi-Label picker, and optional Due Date presets for Today, Tomorrow, End of This Week, or a custom date. Task rows show up to two Label tags plus an overflow count, while Task details show every assigned Label. Label names participate in Task search, while Labels stay out of primary dropdown navigation. Quick Add captures optional notes and defaults to no project, no Labels, and no due date. An actionable menu-bar command uses the same This week definition and groups tasks into Overdue, Today, Tomorrow, and Later This Week with compact project names. Each task can be completed, opened, edited, or moved to recoverable Trash directly from its submenu, and the menu also opens the full creation form or the All Tasks view. It can be hidden from its own menu and restored by running `Worktodo Menu Bar` from Raycast. A `Backup & Restore` command exports complete version 2 JSON backups and validates, previews, and atomically restores version 1 or version 2 backups after explicit confirmation while retaining an automatic version 2 recovery backup.

The local MCP server exposes bounded tools to discover Projects and Labels, list tasks by standard, Project, or Label view, and get, create, update, move, complete, reopen, trash, or restore tasks. Task reads and writes include complete Label assignment sets, while Label definitions remain read-only through MCP. It never exposes arbitrary SQL or permanent deletion.

## Requirements

- Raycast v2 on macOS
- Node 24.18.0
- pnpm 11.24.0 via Corepack

## Development

```sh
corepack pnpm install
corepack pnpm run dev
```

Use `corepack pnpm run verify` for the complete automated check. Build and run the MCP server with `corepack pnpm run dev:mcp`.

To connect a local Codex client to the compiled server, replace the example path with this repository's absolute path:

```sh
corepack pnpm run build:mcp
codex mcp add worktodo -- node /absolute/path/to/worktodo/dist/mcp/server.js
```

Codex can then discover the task tools through its shared MCP configuration. Read and write tools carry safety annotations so Codex can apply its configured approval policy.

Worktodo stores personal task data at `~/Library/Application Support/Worktodo/worktodo.sqlite`.

Durable product research lives in `docs/research/`.
