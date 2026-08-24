# Worktodo

Worktodo is a local-first personal task manager built for Raycast, with a local MCP interface for agents.

The project is currently validating its Raycast v2 and MCP foundations. Task storage and product behavior have not been implemented yet.

## Requirements

- Raycast v2 on macOS
- Node 24.18.0
- npm 11.16.0

## Development

```sh
npm install
npm run dev
```

Use `npm run verify` for the complete automated check. Build and run the diagnostic MCP server with `npm run dev:mcp`.

Research lives in `docs/research/`. The living implementation plan is `docs/plans/implementation-plan.md`.
