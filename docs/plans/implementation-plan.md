# Worktodo Implementation Plan

**Status:** Foundation validation

**Updated:** 2026-08-28

**Research:** [Raycast v2 foundation](../research/raycast-v2-foundation.md)

This is the living implementation plan. Update it in place as validation changes a decision. Keep completed work, current work, blockers, and acceptance evidence explicit.

## Product target

Build a local-first personal task system with:

- Raycast v2 as the primary human interface;
- a real macOS menu-bar item showing the Today count and task menu;
- one shared local SQLite database;
- a local MCP stdio server as the Codex interface;
- a personal-use release first, without blocking a later public release.

Today means incomplete, non-trashed tasks that are overdue or due today in the current local timezone.

## V1 scope

- Inbox
- Flat projects with optional sections
- Tasks with title, plain-text notes containing clickable URLs, priority, and one due value
- All-day and timed due values
- Today, Inbox, project, deadline, search, completed, and Trash views
- Create, edit, complete, move, trash, and restore actions
- Title-first Quick Add with a small, deterministic optional shortcut surface
- Menu-bar count, Today task list, direct completion, and navigation to full views
- MCP read and mutation tools using the same domain rules
- Local backup and restore

Not in V1: accounts, cloud sync, collaboration, OS notifications, recurrence, labels, subtasks, attachments, natural-language date parsing, a public CLI, or a separate native macOS app.

## Foundation decisions

1. Target the current `@raycast/api` 2.x line and React 19; record exact generated versions after validation.
2. Keep all domain rules and queries independent of Raycast components and MCP handlers.
3. Use stable opaque string IDs across UI, storage, deep links, and MCP.
4. Store task data in a filesystem SQLite database, not Raycast `LocalStorage`.
5. Model due dates explicitly as either an all-day local date or a timed instant; do not collapse both into an unqualified JavaScript `Date`.
6. Treat completion and Trash as recoverable states with timestamps.
7. Use MCP stdio for agents. Do not add a CLI or daemon unless a demonstrated requirement appears.
8. Use Raycast's `menu-bar` command for V1. Do not build a native helper unless Raycast cannot meet a measured requirement.
9. Keep stdout protocol-only in the MCP process; diagnostics go to stderr.
10. Use the [validated SQLite policy](../research/sqlite-runtime-validation.md): DELETE journal mode, synchronous FULL, foreign keys, disabled extensions/DQS, a provisional 2-second busy timeout, short BEGIN IMMEDIATE writes, locked migrations, and verified no-clobber backups. Database placement, MCP packaging, and an external menu-refresh bridge remain subject to their own gates.

## Provisional system boundary

```text
Raycast views / Quick Add / menu bar
                 |
                 v
        shared domain operations
                 |
                 v
        SQLite storage adapter
                 ^
                 |
          MCP stdio server
                 ^
                 |
               Codex
```

Raycast and MCP are separate clients of the same domain and database. Neither client owns an alternative cache or interpretation of Today, completion, Trash, ordering, or due dates.

The repository and package layout remain provisional until the API scaffold and Store-packaging validations are complete.

## Initial repository shape

Use a single npm package with the Raycast extension at the repository root:

```text
worktodo/
├── assets/                     # Extension and command icons
├── docs/
│   ├── research/              # Evidence and validation notes
│   └── plans/                 # Living plans, updated in place
├── src/
│   ├── my-tasks.tsx           # Thin Raycast entry points
│   ├── quick-add-task.ts
│   ├── create-task.tsx
│   ├── search-tasks.tsx
│   ├── menu-bar.tsx
│   ├── raycast/               # Shared Raycast views, actions, and hooks
│   ├── domain/                # Task rules and use cases; no Raycast imports
│   └── storage/               # SQLite connection, queries, and migrations
├── mcp/                       # Stdio server and MCP-only adapters
├── tests/                     # Domain, storage, MCP, and process tests
├── package.json               # npm manifest plus Raycast commands
├── package-lock.json
├── tsconfig.json              # Raycast and shared source
├── tsconfig.mcp.json          # MCP build boundary
├── eslint.config.js
├── .prettierrc
├── .gitignore
└── .nvmrc                     # Pin after host runtime validation
```

Keep manifest-mapped files at the top of `src/` because Raycast resolves a command named `my-tasks` to `src/my-tasks.tsx`. Those files should only adapt Raycast inputs and rendering to shared domain operations. Do not add npm workspaces, a second application package, an ORM, or a generic service layer until a concrete constraint requires one.

## Delivery phases

### Phase 0 — Validate the foundation

**Status:** Current

Complete these before locking the storage or package architecture:

1. **Complete:** The clean `@raycast/api` 2.0.5 scaffold builds and runs in Raycast v2.0.5. The managed extension runtime is Node 22.22.2 with SQLite 3.51.2. See [runtime validation](../research/raycast-v2-runtime-validation.md).
2. **Complete:** Cross-runtime SQLite validation passed all 12 native checks using Raycast Node 22.22.2/SQLite 3.51.2 and Node 24.18.0/SQLite 3.53.1. Controlled migration contention, committed-read isolation, bidirectional busy handling, rollback, killed-writer recovery, and verified backup passed; the separate automated suite passes 19 tests. See [SQLite runtime validation](../research/sqlite-runtime-validation.md). WAL remains prohibited. Keep `sqlite-spike` through Phase 0 and remove the command before product implementation or release; retain the policies and reusable tests.
3. Prove an official TypeScript SDK MCP stdio server against the installed Codex build: negotiation, discovery, structured results, errors, cancellation, shutdown, restart, and approvals.
4. Establish the personal-use database path and test discovery from both processes without silently creating a second database.
5. Measure menu freshness after Raycast and MCP writes, including menu-open refresh, background refresh, cached restoration, and Raycast restart.
6. Prototype Raycast root arguments and decide the smallest useful deterministic Quick Add shortcut contract.
7. Record the public-release question for Raycast: acceptable MCP distribution, shared data ownership, source/binary review, update, and uninstall behavior.

**Exit gate:** Each experiment has a short evidence note in `docs/research/`; the exact runtime baseline, database path, journal/locking policy, MCP compatibility target, Quick Add contract, and menu freshness guarantee are decided or explicitly deferred.

### Phase 1 — Establish the shared domain

Define the behavior before building UI:

- task, project, section, due-value, priority, completion, and Trash contracts;
- stable identifiers and deterministic ordering;
- one Today query and timezone/DST truth table;
- validated commands for create, read, update, complete, trash, restore, and search;
- schema versioning and transactional migrations;
- bounded errors for invalid references, conflicts, busy storage, and missing data.

**Verification:** Unit tests cover domain invariants and date boundaries. Migration tests cover a fresh database, upgrade, concurrent startup, and interrupted writes.

### Phase 2 — Build the Raycast task experience

Create focused host-native commands:

- My Tasks, opening on Today;
- Quick Add Task as a no-view title-first command;
- Create/Edit Task using Form;
- Search Tasks;
- project and section management within the main task flow;
- Completed and Trash views with restore actions.

Use Raycast List, Form, Detail, ActionPanel, navigation, preferences, aliases, and hotkeys rather than custom UI systems.

**Verification:** Build, lint, domain tests, and manual Raycast v2 checks for navigation, keyboard flow, validation, drafts, empty/loading/error states, notes, URLs, and destructive-action wording.

### Phase 3 — Add the menu-bar surface

- Show the app icon and Today count.
- Group overdue and due-today tasks.
- Complete tasks directly from the menu.
- Link to Today, Inbox, projects, and Add Task.
- Refresh promptly after Raycast mutations and within the validated guarantee after MCP mutations.
- Cap unusually large menus and direct users to the full Today view.

**Verification:** Test empty, typical, and large Today sets; direct actions; loading and cached states; background cadence; Raycast restart; accessibility; and constrained menu-bar space.

### Phase 4 — Add the Codex MCP interface

Expose bounded task-domain tools, never SQL or shell execution:

- list/search/get tasks;
- create and update a task;
- complete, trash, and restore a task;
- list and manage projects and sections as required by the human UI.

Use strict input schemas, stable structured output with text fallback, result bounds, pagination where needed, and accurate read-only/destructive/idempotent annotations. Treat titles, notes, and URLs as untrusted data.

**Verification:** SDK protocol tests, Codex end-to-end tool calls, concurrent Raycast/MCP mutations, cancellation, timeout, invalid input, database contention, crash/restart, and protocol-pure stdout.

### Phase 5 — Personal release hardening

- Add SQLite-aware backup and verified restore.
- Confirm reload, update, disable, reinstall, and missing-path behavior.
- Document local Raycast import and Codex MCP setup.
- Audit dependencies for telemetry and unnecessary permissions.
- Run the complete acceptance suite on the supported macOS and Raycast v2 versions.

**Exit gate:** The system can be used daily without development commands, both clients agree on all task state, data recovery is proven, and known freshness limitations are documented.

### Phase 6 — Public-release track

Deferred until personal use is stable. Revalidate Raycast Store policy, package the extension according to the accepted MCP distribution model, prepare Store metadata and privacy documentation, and complete public review requirements. Do not publish without explicit authorization.

## V1 acceptance criteria

- Today produces the same ordered result and count in Raycast, the menu bar, and MCP.
- Inbox, projects, sections, notes, URLs, priority, all-day due dates, and timed due dates round-trip without loss.
- Completing, trashing, and restoring a task is consistent from every surface.
- Quick Add works title-only and rejects invalid optional shortcuts clearly.
- The menu-bar item is a real Raycast-controlled macOS status item and does not require a second native helper icon.
- Concurrent Raycast and MCP writes do not corrupt, fork, or silently lose data.
- Migrations and backup/restore are tested with interruption and active readers.
- MCP exposes only bounded domain operations and remains compatible with the validated Codex protocol mode.
- No account, cloud, analytics, notification, CLI, or native-helper dependency enters V1.
- Automated checks and manual Raycast acceptance evidence are reported separately.

## Current next action

Design the actual project, section, task, note, and due-date model using the validated SQLite policies. This is model design, not permission to implement product persistence yet. Phase 0 gates 3–7 remain unresolved: Codex MCP acceptance, database placement, menu freshness, Quick Add arguments, and public-release packaging. Do not mark the whole foundation phase complete.
