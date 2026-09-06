# Public repository readiness review

- Reviewed: 2026-09-05
- Reconciled: 2026-09-06
- Baseline: `da2e890679ff1f1e1e8f01acd9e18892ff49b836`
- Public-readiness implementation baseline: `6ca6947`
- Scope: source publication, documentation, tracked assets, reachable Git history, dependency checks, and local data handling.

## Current conclusion

The code and documentation work in the agreed public-source scope is complete. The repository passes its complete verification gate and a fresh install from a generated source archive. Repository visibility was not changed.

One known publication risk remains because the owner explicitly excluded it from this implementation:

- the reachable Git history contains a company author and committer email.

That exclusion is a decision for the owner when changing repository visibility. No Git history was rewritten, and no publication or Store submission was performed. A later visual-identity update replaced the template icon with a Worktodo-specific extension icon and a separate theme-aware menu-bar icon.

## Findings and resolution

| Finding                                                                  | Resolution                                                                                                                                                             | Evidence                                |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Historical author-email disclosure                                       | Excluded from implementation. Reachable history was left unchanged.                                                                                                    | Baseline history review; owner decision |
| Default Raycast template icon                                            | Resolved after the original implementation scope. The manifest now uses a 512 × 512 Worktodo PNG, and the menu-bar command uses a separate tintable SVG.               | Current assets, manifest, and native UI |
| Unrepresentable timestamps could persist and break presentation          | Resolved. Domain, backup, MCP, and presentation boundaries now accept only Unix-millisecond values representable by JavaScript `Date`.                                 | `b79e95b`, `96f6c4d`                    |
| A stale restore preview could replace newer data                         | Resolved. Preparation records a canonical snapshot fingerprint and replacement compares it inside the transaction before publishing recovery or changing rows.         | `ed6bb9b`                               |
| Recovery publication lacked directory durability barriers                | Resolved. Publication synchronizes the candidate file and relevant directories, and failure preserves the current database.                                            | `7f122d0`                               |
| Generated JSON backups were not ignored                                  | Resolved with narrow final-name and hidden-candidate patterns that leave ordinary JSON fixtures trackable.                                                             | `3ff2f9c`                               |
| README lacked practical public-source guidance                           | Resolved with a concise overview, source install and update steps, optional MCP setup, data and recovery boundaries, verification, research links, and the MIT notice. | `67ce284`                               |
| Historical research blurred superseded assumptions and current contracts | Resolved with dated current-contract notices, the implemented storage policy, current contract links, and removal of the machine-specific temporary path.              | `67ce284`                               |

## Verification

- `corepack pnpm run verify` passed in the working repository: formatting, lint, TypeScript, 23 test files / 199 tests, Raycast build, and MCP build.
- A fresh `git archive` extraction of `96f6c4d`, without local `node_modules` or generated files, passed `corepack pnpm install --frozen-lockfile` and the same complete verification command. Installation reused the local pnpm content-addressable store; this was not a clean-machine network download.
- `corepack pnpm audit --json` reported zero known vulnerabilities across 263 dependency entries at reconciliation time.
- Raycast lint accepts the replacement extension icon, and native Raycast inspection shows the Worktodo icon in command results and the theme-aware icon in the macOS menu bar.
- Ignore checks covered root and nested generated backup final names and hidden candidates. Ordinary JSON, example backup, and unrelated temporary names remained visible to Git.
- Focused suites exercise timestamp boundaries, stale-preview rejection across two database connections, synchronization ordering and failure injection, rollback, and recovery content.
- Raycast lint still reports four non-blocking title-case warnings. Sentence case is an intentional product convention.

## Baseline security and privacy evidence

The baseline review inspected 87 tracked files, 552 unique blobs across 79 reachable commits, available logs for nine GitHub Actions runs, and the Actions artifact inventory. The bounded scans covered common provider tokens, private keys, credential assignments, credential-bearing URLs, email addresses, and personal home paths.

No credential-pattern match was found in tracked file content, commit messages, or downloaded Actions logs. No tracked database, environment file, generated build directory, personal backup, or Actions artifact was found. Generic `/Users/example` test fixtures were the only file-content home paths. These scans reduce accidental-disclosure risk but cannot prove the absence of every possible secret format.

The database, exported JSON, and recovery backups are not encrypted by Worktodo. The product requests owner-only permissions for data directories and files where supported. Restore replaces the full dataset after validation and confirmation; it does not merge. MCP returns selected task content to the configured client, so local storage alone does not imply local-only client processing.

## Validation limits

The stale-preview behavior was verified with automated two-connection integration coverage and Raycast presentation tests. A destructive native confirmation attempt was not run against the user's production database because a failed guard would replace that database.

Durability failure paths were verified through injected file and directory synchronization failures and SQLite state checks. No power-loss or operating-system crash was induced. Store packaging, Store review, third-party rights clearance, repository publication, and release distribution remain outside this review.
