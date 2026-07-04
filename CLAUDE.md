# KNote — Agent Instructions

These instructions apply to both Claude and GitHub Copilot working in this
repo (this file and `.github/copilot-instructions.md` are kept identical —
update both together).

## What this is

KNote is Bradley's personal note-taking app, built for his own note-taking
needs (modeled closely on Obsidian, plus a built-in Kanban board driven by
checkboxes in notes). It's an Electron + React + TypeScript desktop app. Full
scope/feature spec lives in [REQUIREMENTS.md](REQUIREMENTS.md) — read it
before implementing anything non-trivial.

## Hard rule: fully offline, no exceptions

KNote must work with **zero network connectivity**, always. This is a
deliberate design decision, not an oversight to "fix":

- Never add `fetch`/`http`/`https` calls, telemetry, analytics, crash
  reporters, update checks, license pings, or any call to a remote host.
- No CDN-hosted scripts, fonts, or assets — everything ships bundled/local.
- Don't add a dependency whose normal operation phones home; if a library
  has telemetry baked in, disable it explicitly rather than leaving it on.
- The only I/O KNote does is local filesystem access (the vault folder) in
  the main process, and Electron IPC between main/preload/renderer. There is
  no server component and never should be.
- If a task seems to call for cloud sync, an account system, or "checking
  for updates," that's out of scope — flag it rather than implementing it.

## Architecture

Three-process Electron split under `src/`:

- **`src/main/`** — Node/Electron main process. Owns the filesystem:
  `vaultService.ts` (CRUD on notes/folders), `watcher.ts` (chokidar-based
  external file-change watching), `indexer/` (search index, backlinks,
  unlinked mentions), `settings.ts`, `ipcHandlers.ts` (registers every IPC
  endpoint), `lineEdit.ts` (safe single-line rewrites for task/board sync),
  `attachmentCleanup.ts`.
- **`src/preload/`** — `contextBridge` script; the *only* bridge between
  main and renderer. `index.ts` exposes a typed `window.knote` API (see
  `src/shared/ipc.ts` for the full channel list and payload types).
- **`src/renderer/`** — React 18 + Vite UI, under `src/renderer/src/`:
  - `editor/` — CodeMirror 6 markdown editor with live preview
  - `board/` — the Kanban board (drag-and-drop, two-way sync to source files)
  - `timeline/`, `machineLog/` — other views
  - `components/` — panels, popovers, command palette, dialogs, settings
  - `stores/` — Zustand state stores
  - `commands/` — command palette command registry
- **`src/shared/`** — types, IPC channel definitions, the markdown parser
  (`parser/parseNote.ts`, `parser/patterns.ts`), and path/search utilities
  used by both main and renderer.

Key invariants:
- `contextIsolation: true`, `nodeIntegration: false` — the renderer never
  touches Node or the filesystem directly, only through the preload API.
- A **vault** is just a folder on disk. That's the entire data model — no
  database, beyond an ephemeral in-memory search index rebuilt from files.
- Notes are plain UTF-8 `.md` files, fully readable/editable outside KNote.

## Dev workflow

- `npm run dev` — run the app (electron-vite dev)
- `npm run typecheck` — TypeScript check (both node and web tsconfigs)
- `npm test` / `npm run test:watch` — vitest (`tests/`)
- `npm run dist` — electron-builder Windows build

## Documenting new features

Whenever a new **major user-facing feature** is added, add a short section
about it to `resources/welcome.md` — the bundled "Welcome & feature guide"
doc, opened from **Settings → Welcome & feature guide** (first item in the
list, rendered read-only via `WelcomeDialog.tsx`). It's shipped with the
app itself, not stored in any vault, so it always reflects the app's
current feature set regardless of which vault is open. Match its existing
terse, table/bullet style. Do this as part of the same change, not as a
follow-up. 
