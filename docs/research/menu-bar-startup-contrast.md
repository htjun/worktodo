# Menu-bar startup contrast investigation

Date: 2026-09-19

## Report and verified configuration

The user reports that Worktodo sometimes appears incorrectly after starting the Mac. Their screenshot shows a black Worktodo status icon while its task count and adjacent icons are white. The timing of the appearance change and whether a manual refresh corrects it have not been reproduced.

At the time of this initial investigation, Worktodo used `worktodo-menu-bar-template.png` with `Color.PrimaryText`. The PNG was a black alpha mask; the word `template` in its filename did not establish that Raycast created an AppKit template image. The earlier PNG change addressed the sharpness hypothesis and retained the automatic tint, so it did not remove this failure path.

The installed Raycast version was 2.4.1.0 and the extension API dependency was 2.2.0 at the time of the initial investigation. The public `Image` type exposes `source`, `fallback`, `mask`, and `tintColor`; it does not expose AppKit's `isTemplate` property. `MenuBarExtra` does not expose that property either.

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

No production code had been changed for the initial report. Raycast's refresh action was invoked, and its UI confirmed `Refreshed menu bar item Worktodo Menu Bar`. That confirmed the command refreshed, not that the status icon's color recovered: the status icon was not available in the capture. No reboot, appearance setting change, application patch, or cache deletion was performed during that investigation.

## 2026-09-23 black and white asset comparison

The current extension uses `@raycast/api` 2.4.1. Following the [Arc menu-bar command](https://github.com/raycast/extensions/blob/main/extensions/arc/src/menu-bar.tsx), Worktodo now supplies separate black and white assets through `source: { light, dark }` without `tintColor`. The two 32-by-32 RGBA PNGs retain the exact alpha channel of the previous black mask, including its 170 partially transparent pixels; only the white variant's RGB channels differ. Asset generation used Sharp 0.35.4 installed under `/tmp`, with no package or lockfile change.

Native observations on macOS with Raycast 2.4.1.0:

| Appearance, wallpaper, menu-bar background | Previous tinted icon           | Separate assets                |
| ------------------------------------------ | ------------------------------ | ------------------------------ |
| Light, Abstract Nature Scene, off          | White, matching adjacent icons | White, matching adjacent icons |
| Light, Mac Yellow, off                     | Black, matching adjacent icons | Black, matching adjacent icons |
| Light, Mac Yellow, on                      | Black, matching adjacent icons | Black, matching adjacent icons |
| Dark, Mac Yellow, on                       | Not retested                   | Black, matching adjacent icons |
| Dark, Abstract Nature Scene, on            | Not retested                   | White, matching adjacent icons |

With the original wallpaper and Light appearance restored, the new icon stayed white after Raycast reported `Refreshed menu bar item Menu Bar` and after quitting and relaunching Raycast. The menu-bar count continued to render; it changed from 11 to 12 during testing. The icon source change does not touch count calculation or menu actions. The original Abstract Nature Scene photo, its Fill Screen setting, Show on all Spaces, Light appearance, and menu-bar background off were restored.

The original inverted-color incident did not recur during this comparison, including with the old implementation. These observations establish that the separate assets render correctly in the tested conditions, not that they prevent the intermittent startup failure. Raycast still selects `light` or `dark` using its supplied appearance; a stale or incorrect appearance input could select the wrong asset just as it could resolve `PrimaryText` incorrectly. A full Mac reboot was not performed. Check the icon after the next natural boot before treating the startup symptom as resolved.

## Sources

- [Raycast API changelog, version 1.64.0](https://developers.raycast.com/misc/changelog)
- [Raycast menu-bar API](https://developers.raycast.com/api-reference/menu-bar-commands)
- Local `@raycast/api` image and menu-bar type declarations.
- Installed Raycast image-render worker and native diagnostic strings.
- User-supplied startup screenshot.
