---
name: verify
description: Build, launch, and drive an isolated KNote instance end-to-end via CDP to verify changes at the running app's surface
---

# Verifying KNote changes end-to-end

## Build & launch (isolated — never drive the user's own window)

```powershell
$env:ELECTRON_RUN_AS_NODE=$null   # Claude Code sets it to 1; it breaks Electron
npm run build
$env:KNOTE_DEBUG_PORT="9223"; $env:KNOTE_USER_DATA="<isolated temp dir>"
npx electron .                    # run in background
```

Dev-only hooks for both env vars live in `src/main/index.ts`. Create a
throwaway vault (a temp folder of `.md` files), then from the driver:
`window.knote.openVaultPath(root)` followed by `page.reload()` (the vault
picker only switches on its own button click).

## Driving via puppeteer-core

Run driver scripts (kept in the scratchpad) with
`NODE_PATH="<repo>/node_modules" node script.js`, connecting with
`puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })`.

Gotchas on this Electron + Windows setup — these **hang forever** (never
resolve, never error):

- `page.click()` / `elementHandle.click()` / `page.setViewport()` /
  `page.screenshot()`. Click via
  `page.evaluate(() => document.querySelector(sel).click())` instead, and
  capture visuals via `canvas.toDataURL()` in-page (for canvas views) or
  skip pixel capture.
- `page.bringToFront()` works (guard with a `Promise.race` timeout anyway).

Input quirks:

- Global hotkeys: dispatch
  `window.dispatchEvent(new KeyboardEvent('keydown', {key, ctrlKey, bubbles:true}))`
  in-page; `page.keyboard.down/press` combos don't reach `App.tsx`'s handler.
- Typing into React-controlled inputs: `page.evaluate(() => el.focus())`
  then real `page.keyboard.type(...)` / `press('Enter')` (these do NOT hang).
  Synthetic `Event('input')` dispatch is unreliable; to clear a controlled
  input use the native value setter + `input` event.

**rAF is paused while the window is occluded/backgrounded** — canvas
render loops (e.g. the graph view) draw nothing until the window is
visible. Call `page.bringToFront()` before verifying anything
rAF-driven, or captures race a paused compositor and come back blank.

Clean shutdown: `puppeteer.connect(...)` then `browser.close()`.

## Conventions to check alongside a feature

- New major user-facing feature → section in `resources/welcome.md`.
- Release-worthy change → bump `package.json` version + add a section to
  `resources/releaseNotes.md` (nothing automates this).
