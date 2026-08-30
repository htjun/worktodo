# Worktodo JSON Backup Format

**Status:** Version 1 product contract.

Worktodo uses one lossless JSON document for manual exports, automatic pre-import recovery backups, and imports. SQLite remains the canonical store. Import version 1 replaces the complete store; it does not merge records or regenerate imported values.

## Document

```ts
type WorktodoBackupV1 = {
  format: "worktodo-backup";
  version: 1;
  exportedAtMs: number;
  projects: Project[];
  sections: Section[];
  tasks: Task[];
};
```

The `Project`, `Section`, and `Task` fields and meanings are the approved model in [task-model.md](task-model.md). Every ID, timestamp, position, placement, due value, priority, note, and lifecycle value is preserved. `exportedAtMs` is a non-negative safe integer Unix epoch millisecond describing when the snapshot was captured.

JSON is UTF-8, indented with two spaces, and ends with one newline. Each entity array is sorted by lowercase ID so equivalent snapshots serialize deterministically. Array order does not define product order; the stored `position`, creation time, and ID fields retain the approved ordering semantics.

## Validation

- Objects are strict. Unknown top-level or entity fields are invalid in version 1.
- IDs are lowercase UUID v4 strings and are unique within their entity collection.
- Names and task titles are non-empty and already trimmed. Notes remain arbitrary strings.
- Positions and timestamps are non-negative safe integers. Entity updates and task lifecycle timestamps obey the approved timestamp ordering.
- Due values use the approved closed union. All-day dates are real Gregorian `YYYY-MM-DD` values; timed values contain a non-negative safe integer instant and canonical IANA timezone.
- Every section references an included project. Every task project is included, and every task section belongs to its recorded project.

Malformed JSON, invalid model values, duplicate IDs, and broken relationships are rejected before production mutation. A document with `format: "worktodo-backup"` and any version other than `1` is reported as unsupported rather than interpreted as version 1.

## Compatibility

Version 1 readers accept only version 1. A future format version requires an explicit reader and migration decision; unknown fields or versions are not silently ignored. Manual exports and automatic recovery backups share this exact contract so either artifact can be selected by the import workflow.
