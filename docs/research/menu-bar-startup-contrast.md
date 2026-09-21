# Menu-bar startup contrast investigation

Date: 2026-09-19

## Report and verified configuration

The user reports that Worktodo sometimes appears incorrectly after starting the Mac. Their screenshot shows a black Worktodo status icon while its task count and adjacent icons are white. The timing of the appearance change and whether a manual refresh corrects it have not been reproduced.

Worktodo uses `worktodo-menu-bar-template.png` with `Color.PrimaryText`. The PNG is a black alpha mask; the word `template` in its filename does not establish that Raycast creates an AppKit template image. The earlier PNG change addressed the sharpness hypothesis and retained the automatic tint, so it did not remove this failure path.

The installed Raycast version is 2.4.1.0 and the extension API dependency is 2.2.0. The public `Image` type exposes `source`, `fallback`, `mask`, and `tintColor`; it does not expose AppKit's `isTemplate` property. `MenuBarExtra` does not expose that property either.

## Renderer evidence

Read-only inspection of Raycast's installed `image-render.worker-veUN27I_.js` shows:

- Its color resolver maps `raycast-primary-text` to `#000000` for light appearance and `#FFFFFF` for dark appearance.
- Its custom-image renderer loads the source, draws it on an `OffscreenCanvas`, and applies the resolved tint using `source-atop` before returning PNG data.
- Theme-specific asset sources and dynamic tint objects also select using the supplied appearance. Substituting either for `PrimaryText` therefore does not by itself fix an incorrect or stale appearance input.
- The native executable contains status-item image-rendering and frontend-readiness diagnostics. This establishes that the native host coordinates rendering, but does not prove the startup race or caching mechanism responsible for this report.

Raycast's API changelog says that `PrimaryText` and `SecondaryText` menu-bar icons should follow the menu bar's appearance. The current Worktodo configuration already uses that documented behavior. The screenshot is consistent with a stale or incorrect appearance at rendering time, or the resulting bitmap remaining on screen; the exact host failure is unconfirmed.

## Fix boundary

A fixed white tint would resemble the supplied screenshot's neighboring icons but would fail on a menu bar that needs dark icons. Renaming the PNG with `Template` in the filename is not a documented Raycast template-image API. Neither is a verified general fix.

Using the existing green/yellow Worktodo logo without a tint would avoid the appearance-dependent tint path, but the user explicitly requires a monochrome icon. Preserve that requirement. Native appearance handling must be verified further; a timer, repeated refresh, or speculative tint substitution should not be presented as a confirmed startup fix.

No production code has been changed for this report. Raycast's refresh action was invoked, and its UI confirmed `Refreshed menu bar item Worktodo Menu Bar`. That confirms the command refreshed, not that the status icon's color recovered: the status icon was not available in the capture. The user's answer about whether the icon returns to white after this refresh is pending. No reboot, appearance setting change, application patch, or cache deletion was performed.

## Sources

- [Raycast API changelog, version 1.64.0](https://developers.raycast.com/misc/changelog)
- [Raycast menu-bar API](https://developers.raycast.com/api-reference/menu-bar-commands)
- Local `@raycast/api` image and menu-bar type declarations.
- Installed Raycast image-render worker and native diagnostic strings.
- User-supplied startup screenshot.
