# KNote — Agent Instructions

These instructions apply to both Claude and GitHub Copilot working in this
repo (this file and `.github/copilot-instructions.md` are kept identical —
update both together).

## What this is

KNote is Bradley's personal note-taking system, built for his own
note-taking needs (modeled closely on Obsidian, plus a built-in Kanban
board driven by checkboxes in notes). It is a **VS Code extension**
(TypeScript + React webviews); it was previously a standalone Electron app,
retired in July 2026 — the engine survived the port intact. Full
scope/feature spec lives in [REQUIREMENTS.md](REQUIREMENTS.md) — read it
before implementing anything non-trivial.

## Hard rule: fully offline, no exceptions

KNote must work with **zero network connectivity**, always. This is a
deliberate design decision, not an oversight to "fix":

- Never add `fetch`/`http`/`https` calls, telemetry, analytics, crash
  reporters, update checks, license pings, or any call to a remote host.
- No CDN-hosted scripts, fonts, or assets — everything ships bundled in the
  VSIX (esbuild inlines all runtime deps; webviews run under a strict CSP
  that blocks remote loads).
- Don't add a dependency whose normal operation phones home; if a library
  has telemetry baked in, disable it explicitly rather than leaving it on.
- The only I/O KNote does is local filesystem access (the vault folder) in
  the extension host, and postMessage RPC between the host and its
  webviews. There is no server component and never should be.
- If a task seems to call for cloud sync, an account system, or "checking
  for updates," that's out of scope — flag it rather than implementing it.

## Architecture

A VS Code extension in four layers under `src/`:

- **`src/core/`** — pure Node services, no `vscode` imports (so vitest can
  run them directly): `vaultService.ts` (vault root + path safety + CRUD +
  atomic writes; trash is injected by the host), `watcher.ts` (chokidar
  with own-write echo suppression and byte-identical dedupe),
  `lineEdit.ts` (verified single-line rewrites — the disk half of board
  sync), `vaultConfig.ts` (`.knote/config.json`), `indexer/` (note index,
  MiniSearch, unlinked mentions), `tagRename.ts`, `attachmentCleanup.ts`.
- **`src/extension/`** — the extension host. `extension.ts` (activation:
  a workspace folder containing `.knote/` is the vault), `engine.ts`
  (wires index + watcher, fans out index deltas), `docSync.ts` (editor →
  index live sync), `verifiedEdit.ts` (the write half of two-way sync:
  WorkspaceEdit on open buffers, `core/lineEdit` otherwise, KNOTE_STALE on
  mismatch), `frontmatterEdit.ts`, `providers/` (wiki-link DocumentLinks,
  completions, hover, decorations, paste-image), `commands/` (tasks,
  formatting, weekly notes, templates, machine entries, maintenance),
  `views/` (board/timeline/machineLog/graph/settings panels + sidebar
  webview views), `trees/tagsTree.ts`, `rpc/` (webview RPC router +
  HostApi handlers).
- **`src/webviews/`** — React 18 apps bundled per view (board, timeline,
  machineLog, graph, search, backlinks, properties, settings) plus
  `shared/` (typed RPC client, Zustand stores mirrored from index deltas,
  pickers/dialogs, `webview.css` mapped onto `--vscode-*` theme colors).
- **`src/shared/`** — types, the parser (`parser/parseNote.ts`,
  `parser/patterns.ts`), `hostApi.ts` (the host ↔ webview RPC contract),
  `wikiResolve.ts`, path/search utilities. Pure TS, used by all layers.

Key invariants:
- A **vault** is just a folder on disk. That's the entire data model — no
  database, beyond an ephemeral in-memory search index rebuilt from files.
- Notes are plain UTF-8 `.md` files, fully readable/editable outside KNote.
- Every write to a note goes through a **verified edit**: the expected line
  text must still match (or the whole write is refused with `KNOTE_STALE`)
  — nothing ever clobbers an edit it didn't see.
- `src/core/` must stay free of `vscode` imports.

## Dev workflow

- `npm run watch` + F5 (Run KNote Extension) — Extension Development Host
- `npm run build` — bundle host + all webviews to `dist/` (esbuild)
- `npm run typecheck` — TypeScript check (host and webview tsconfigs)
- `npm test` / `npm run test:watch` — vitest (`tests/`)
- `npm run package` — `vsce package`, produces the installable `.vsix`

There is no automated end-to-end harness (the old Electron CDP harness was
retired with the app); verify UI changes manually in the F5 dev host
against a real vault.

## Documenting new features

Whenever a new **major user-facing feature** is added, add a short section
about it to `resources/welcome.md` — the bundled "Welcome & feature guide"
doc, opened via **KNote: Open Welcome & Feature Guide**. It's shipped with
the extension itself, not stored in any vault, so it always reflects the
current feature set regardless of which vault is open. Match its existing
terse, table/bullet style. Do this as part of the same change, not as a
follow-up.
