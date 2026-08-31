# Raycast v2 Runtime Validation

**Status:** Raycast scaffold and host runtime validated

**Checked:** 2026-08-24

This note records local evidence used to choose the initial repository shape. It does not validate product behavior.

**Package-manager update (2026-08-30):** The initial validation below used npm. The repository now uses pnpm 11.24.0 via Corepack, commits `pnpm-lock.yaml`, and remains a single root package without workspace packages.

**Menu-bar feedback update (2026-08-31):** Raycast 2.1.2 retains the background launch type on action callbacks registered by a background-rendered menu. Its installed backend rejects `showToast` for those callbacks with `Toast API is not available when command is launched in background`. In a local reproduction, the task mutation committed before the success Toast was rejected, and a second Toast from the catch block escaped as a menu callback error. Worktodo now relays Toast-bearing Complete and Hide actions into a user-initiated menu command, uses HUD feedback for any remaining background path, and keeps feedback failures outside mutation error handling.

## Confirmed locally

- Installed Raycast host: `2.0.5.0`, bundle ID `com.raycast.macos`.
- Current npm package: `@raycast/api 2.0.5`, requiring Node `>=22.22.2` and React 19.
- Raycast's bundled Create Extension template still declares:
  - `@raycast/api ^1.104.20`
  - `@raycast/utils ^2.2.7`
  - TypeScript `^6.0.3`
  - npm scripts using `ray develop`, `ray build`, and `ray lint`
- The official template maps every manifest command name to a flat `src/<command>.ts(x)` entry point.
- A temporary copy of that template upgraded to exact `@raycast/api 2.0.5` and `@raycast/utils 2.3.0` installed and completed `ray build` successfully.
- The build compiled view, no-view, menu-bar, and tool entry points and generated Raycast TypeScript definitions.
- The validation shell used Node `24.18.0`, npm `11.16.0`, and SQLite `3.53.1`.
- The API 2.0.5 development extension ran successfully in Raycast v2.0.5.
- Raycast's managed extension runtime reported Node `22.22.2` and SQLite `3.51.2`.
- The My Tasks diagnostic view rendered its native empty state.
- Raycast accepted the menu-bar command and reported that the Worktodo item was added to the macOS menu bar.
- The initial clean npm install had no unreviewed lifecycle scripts, and npm audit reported no known vulnerabilities.

## Implications

- Use one package at the repository root so the project remains shaped like a Raycast Store extension.
- Keep Raycast command entry points flat under `src/`; move reusable UI, domain, and storage code into nested folders.
- Keep the MCP executable outside the Raycast entry-point namespace while sharing domain and storage modules.
- Use pnpm 11.24.0 via Corepack and commit `pnpm-lock.yaml`; do not introduce workspace packages or another package manager without a demonstrated need.
- API 2.0.5 is build-compatible with the installed template, despite the template's stale API 1.x declaration.
- Local MCP development can use the pinned Node 24.18.0 toolchain, but shared storage must remain compatible with Raycast's managed Node 22.22.2 runtime.
- SQLite 3.51.2 predates the 3.51.3 WAL race fix identified in the foundation research. Do not enable WAL unless a later Raycast runtime reports a fixed SQLite version and the two-process stress test passes.

## Still unverified

- Store treatment of a sibling MCP entry point and its dependencies.
- The final shared database path and journal/locking policy.
