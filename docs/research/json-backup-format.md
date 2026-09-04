# Worktodo JSON Backup Format

Status: implemented
Last verified: 2026-09-04

## Version 2 contract

A backup is UTF-8 JSON with this top-level shape:

```ts
type WorktodoBackupDocument = {
  format: "worktodo-backup";
  version: 2;
  exportedAtMs: number;
  projects: Project[];
  labels: Label[];
  tasks: Task[];
};
```

The Project, Label, and Task definitions come from [task-model.md](task-model.md). Each Task stores
its complete canonical `labelIds` set. Every stable ID, display value, position, Due value,
lifecycle timestamp, and Task timestamp is preserved.

Serialization uses two-space JSON indentation, a final newline, Project/Label/Task collections
ordered by ID, and each Task assignment ordered by canonical Label order. Import rejects unknown
fields, malformed IDs, invalid timestamps or Due values, duplicate entity IDs, duplicate normalized
Label names, duplicate Task Label IDs, and missing Project or Label relationships.

## Version 1 compatibility

Version 1 is import-only. Its `sections` collection and each Task `sectionId` are parsed with a
strict isolated schema, validated, and converted to the version 2 model before preview or
replacement.

Conversion follows the production database migration:

- Sections are visited in canonical Project and Section order.
- The first Section for a normalized name retains identity; later collisions merge.
- Empty Sections produce Labels.
- Direct Project Tasks precede converted Section Tasks.
- Section Tasks remain in their Project and receive the converted Label.
- Content, Due values, lifecycle state, identity, and timestamps are preserved.

Every new export and automatic recovery backup uses version 2.

## Import workflow

Worktodo accepts one absolute `.json` file up to 100 MiB, verifies it did not change while being
read, parses the complete document, and then shows mutually exclusive lifecycle counts for the
current and incoming Projects, Labels, and Tasks.

Replacement requires explicit confirmation. In one database transaction Worktodo:

1. publishes an owner-only version 2 recovery backup of current data;
2. deletes Task associations, Tasks, Labels, and Projects in foreign-key-safe order;
3. inserts the selected canonical snapshot;
4. runs SQLite integrity and foreign-key checks; and
5. compares the stored result with the selected backup.

Any failure rolls the database back and reports whether a recovery file was already published.
Recovery files are never overwritten.

## Verification

The backup contract, export, preview, replacement, recovery, file-stability, and presentation suites
exercise version 2 round trips and version 1 compatibility. The repository-wide gate is
`corepack pnpm run verify`.
