# KNote — Agent Instructions

These instructions apply to both GitHub Copilot and Claude working in this
repo (this file and `CLAUDE.md` at the repo root are kept identical —
update both together).

## What this is

KNote is Bradley's personal note-taking system, built for his own
note-taking needs (modeled closely on Obsidian, plus a built-in Kanban
board driven by checkboxes in notes). It is a **VS Code extension**
(TypeScript + React webviews); it was previously a standalone Electron app,
retired in July 2026 — the engine survived the port intact. Full
scope/feature spec lives in [REQUIREMENTS.md](../REQUIREMENTS.md) — read it
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
  MiniSearch, unlinked mentions), `tagRename.ts`, `linkRename.ts`
  (vault-wide `[[link]]` rewrite when a note is renamed/moved),
  `attachments.ts`, `attachmentCleanup.ts`.
- **`src/extension/`** — the extension host. `extension.ts` (activation:
  a workspace folder containing `.knote/` is the vault; returns the
  `extendMarkdownIt` API VS Code's Markdown preview picks up), `engine.ts`
  (wires index + watcher, fans out index deltas, `whenIndexBuilt()`),
  `docSync.ts` (editor → index live sync), `verifiedEdit.ts` (the write
  half of two-way sync: WorkspaceEdit on open buffers, `core/lineEdit`
  otherwise, KNOTE_STALE on mismatch), `frontmatterEdit.ts`,
  `renameLinks.ts` (onWillRenameFiles → one WorkspaceEdit, so the link
  rewrite shares the rename's undo step), `markdownItKnote.ts` (KNote
  syntax in Reading mode), `attachmentAutoCleanup.ts`, `providers/`
  (wiki-link DocumentLinks, completions, hover, decorations, paste-image),
  `commands/` (tasks, formatting, weekly notes, templates, machine
  entries, maintenance), `views/` (board/planner/machineLog/graph/settings
  panels + the Live Preview custom editor + sidebar webview views),
  `trees/tagsTree.ts`, `rpc/` (webview RPC router + HostApi handlers).
- **`src/webviews/`** — React 18 apps bundled per view (board, planner,
  machineLog, graph, search, backlinks, outline, properties, settings)
  plus `editor/` — the CodeMirror 6 Live Preview editor, which is *not*
  React and is the default `.md` editor (live-preview decorations, tables,
  mermaid, note embeds, hover previews, spell check) — and `shared/`
  (typed RPC client, Zustand stores mirrored from index deltas,
  pickers/dialogs, `webview.css` mapped onto `--vscode-*` theme colors).
- **`src/shared/`** — types, the parser (`parser/parseNote.ts`,
  `parser/patterns.ts`), `hostApi.ts` (the host ↔ webview RPC contract),
  `wikiResolve.ts`, `renderMarkdown.ts` (markdown-it + KNote's wiki-link
  and tag rules, shared by embeds, hover previews and Reading mode),
  `embedSlice.ts`, `deliverables.ts` (the project-planner data model),
  path/search utilities. Pure TS, used by all layers.

Key invariants:
- A **vault** is just a folder on disk. That's the entire data model — no
  database, beyond an ephemeral in-memory search index rebuilt from files.
- Notes are plain UTF-8 `.md` files, fully readable/editable outside KNote.
- Every write to a note goes through a **verified edit**: the expected line
  text must still match (or the whole write is refused with `KNOTE_STALE`)
  — nothing ever clobbers an edit it didn't see.
- `src/core/` must stay free of `vscode` imports.
- **Providers, views and the custom editor are all registered before the
  engine starts**, so anything that resolves during activation can be
  handed an empty index. Whatever needs the whole vault must await
  `engine.whenIndexBuilt()` — `getIndexSnapshot` does, which is what keeps
  a restored Live Preview tab from hydrating its store with nothing and
  leaving `[[` completion, backlinks and tags near-empty.

### The project planner (Gantt chart)

The Planner (`src/webviews/planner/`, opened by **KNote: Open Project
Planner**) is a Gantt chart drawn entirely from markdown — there is no
project database, and adding one would break the vault-is-the-data-model
invariant above. The whole model lives in `src/shared/deliverables.ts`, so
the board and the planner agree without importing each other:

- A **project** is a note whose frontmatter says `type: project`. Its slug
  is `project:` frontmatter, else its kebab-cased title. `status: completed`
  closes it (no new deliverables/tasks; its tags drop out of completion).
- A **deliverable** is a *top-level* checkbox task in that note carrying
  `@deliverable(<project>/<name>)` — exactly two segments inside the parens,
  enforced by `DELIVERABLE_TAG_RE`/`DELIVERABLE_REF_RE`. What makes a line
  the *defining* one rather than a member is purely structural (top-level,
  in the project's own note, carrying a span) — never the marker itself, so
  the same marker also doubles as the join syntax below. Notes written before
  this switch may still carry a defining line's identity as a literal
  `#deliverable/…` tag; that legacy form still reads, but nothing writes it
  any more.
- Its **bar** spans `🛫`/`@start(YYYY-MM-DD)` → `📅`/`@due(...)`
  (`START_RE`, `DUE_RE`). No `🛫` means start falls back to end — a point,
  not a span.
- **Dependencies** are `⛓ @deliverable(<project>/<name>)` on the deliverable
  line, read as "comes after that one" (`DEPENDS_RE`, global — several
  allowed; legacy `⛓ #deliverable/…` still reads too). They draw the arrows
  and constrain drag. Because a dependency is text-identical to a join
  marker apart from its `⛓ ` prefix, `deliverableRefsOf` has to exclude any
  `@deliverable(...)` match that falls inside a `DEPENDS_RE` span, or a
  deliverable would "join" everything it merely waits on.
- Ordinary tasks **join** a deliverable by carrying that same
  `@deliverable(<project>/<name>)` marker anywhere in the vault — deliberately
  not a `#tag`, so joining never clutters the Tags sidebar or `#`
  autocomplete with structural plumbing.
- Any new inline marker must be added to `AFTER_ANCHOR` in
  `parser/patterns.ts` (so it can't be pushed past a `^block-id`) *and* to
  `stripInlineMarkers` — strip dependencies before the generic tag strip or
  a bare `⛓` is left in the label.
- Which projects are charted is stored in `VaultConfig.hiddenProjects` —
  the *hidden* set, so a newly created project shows up on its own.
- Dragging a bar rewrites the task line through the ordinary verified-edit
  path (`plannerActions.ts` → `verifiedEdit` / `core/lineEdit`); it is not a
  special case. Layout maths live in `plannerLayout.ts` and are unit-tested
  in `tests/plannerLayout.test.ts` — keep them pure.

## Dev workflow

- `npm run watch` + F5 (Run KNote Extension) — Extension Development Host
- `npm run build` — bundle host + all webviews to `dist/` (esbuild)
- `npm run typecheck` — TypeScript check (host and webview tsconfigs)
- `npm test` / `npm run test:watch` — vitest unit tests (`tests/`, plural)
- `npm run test:integration` — VS Code integration harness (`test/`, singular):
  builds, compiles the tests, and runs `knote.*` commands inside a real
  Extension Development Host against a disposable vault (`@vscode/test-cli`).
  First run downloads a VS Code build into `.vscode-test/` (needs network
  once; the extension itself stays offline).
- `npm run package` — `vsce package`, produces the installable `.vsix`

### Validating a change

There are **two** test layers — mind the singular/plural directory split:

- **`tests/` (plural) = vitest unit tests.** Pure `core`/`shared`/webview
  logic and selectors, no `vscode` import. Fast; run constantly with
  `npm test`. This is where parser, selector, line-edit, and watcher logic
  is covered.
- **`test/` (singular) = the VS Code integration harness.** Black-box Mocha
  tests (import only `vscode` + Node, never app source) that activate the
  extension, drive commands via `vscode.commands.executeCommand('knote.…')`,
  and assert on the live editor buffer **and** on disk. See `test/README.md`.

**What to run before calling a change done:**

1. `npm run typecheck` and `npm test` — always.
2. `npm run test:integration` — whenever the change touches runtime behavior
   the unit tests can't see: activation, command wiring, verified edits,
   two-way board/disk sync, the live-preview editor, or anything that only
   manifests in a real `vscode` host. Add a `test/integration/*.test.ts`
   case for the new behavior (use `test/integration/helpers.ts`); this is the
   automated replacement for manual F5 verification, so prefer it over
   "verified by hand." Pure-logic changes need only a `tests/` unit test.
3. For UI/webview visuals that no assertion covers, still eyeball it in the
   F5 dev host against a real vault.

## Documenting new features

Whenever a new **major user-facing feature** is added, add a short section
about it to `resources/welcome.md` — the bundled "Welcome & feature guide"
doc, opened via **KNote: Open Welcome & Feature Guide**. It's shipped with
the extension itself, not stored in any vault, so it always reflects the
current feature set regardless of which vault is open. Match its existing
terse, table/bullet style. Do this as part of the same change, not as a
follow-up.
