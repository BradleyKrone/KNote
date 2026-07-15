# KNote

KNote is a local-first, plain-Markdown note system modeled closely on
[Obsidian](https://obsidian.md/), with a built-in Kanban board driven by
checkboxes in your notes — packaged as a **VS Code extension**. It runs
entirely on your machine: **no server, no account, no network calls of
any kind.**

Notes are just `.md` files in a folder you choose (a **vault** — any VS
Code workspace folder containing `.knote/`). That folder is the entire
data model — no database, no proprietary format, nothing that isn't
readable and editable in any other text editor.

## Features

### Note-taking
- **Vault = workspace folder** — open any folder as a vault (run
  *KNote: Initialize Vault in This Workspace* on a fresh one); external
  file changes are live-reflected, sync-client noise is filtered out.
- **Native editor, enhanced** — notes open in VS Code's Markdown editor
  with KNote's wiki-link navigation, autocomplete, hover previews, and
  tag/priority/milestone decorations layered on top. Copilot, Vim mode,
  and every other extension keep working in your notes.
- **Wiki-links** — `[[Note Name]]`, `[[Note Name#Heading]]`,
  `[[Note Name#^block-id]]`, `[[Note Name|display text]]`, with `[[` and
  `#` autocomplete, create-on-click, backlinks, and unlinked mentions.
- **Tags** — `#tag` / `#nested/tag` in notes or frontmatter, with an
  Activity Bar tag browser, vault-wide rename/merge, and deprecation.
- **Frontmatter / properties** — YAML metadata per note, editable as form
  fields in the Properties panel.
- **Search** — vault-wide full-text search with operators (`path:`,
  `tag:`, `file:`, quoted phrases, exclusion) in the KNote sidebar.
- **Weekly notes** (`Ctrl+Alt+W`), **quick capture** (`Ctrl+Alt+J`), and
  **templates** with `{{date}}` / `{{time}}` / `{{title}}` /
  `{{weekdays}}` placeholders.
- **Paste-to-embed images** — paste a screenshot into a note; it's saved
  to your attachments folder and embedded automatically, with an
  orphan-cleanup command when notes stop referencing them.

### Kanban board (KNote's signature addition)
- Every checkbox line in every note (`- [ ]`, `- [x]`, `- [/]`, and
  custom statuses) becomes a task card, automatically discovered and
  kept in sync as you edit.
- **Global board** (`Ctrl+Alt+K`) or **per-note board**.
- **Two-way sync**: dragging a card between columns rewrites the checkbox
  character in the source file — landing in your open editor buffer when
  the note is open, or as a verified disk write that refuses to clobber
  external edits; editing a checkbox in a note updates the board live.
- Custom columns/statuses in **KNote Settings → Kanban board**, including
  require-reason columns (`Reason for Waiting: … 📅 date`) and automatic
  `Status Changed:` stamping.
- Filter by text, tag, and Status Changed / Date Entered / Due date.
- Cards carry tags, due dates (`📅 2026-07-15` / `@due(2026-07-15)`), and
  priority markers (`!`, `!!`, `!!!`); archive with `- [a]`.

### Timeline, Machine Log, Graph
- **Timeline** — a chronological view of every dated task, `🏁` milestone,
  and `date:`-frontmatter note across the vault, with right-click date
  editing.
- **Machine log** — register machines (serial, model, config attributes)
  in KNote Settings; log dated `🚜` work entries against them and browse a
  filterable log grouped by machine.
- **Graph** — a force-directed map of your notes and their wiki links.

## Why fully offline?

This is a deliberate, permanent design constraint, not a missing feature:
no telemetry, analytics, crash reporting, update checks, or any call to a
remote host — ever. Everything ships bundled in the VSIX. If you want to
sync a vault across machines, use an external tool of your choice
(Syncthing, Dropbox, git, etc.) entirely outside KNote.

## Architecture

A VS Code extension in four layers under `src/`:

- **`src/core/`** — pure Node engine (vault CRUD + atomic writes, chokidar
  watching with echo suppression, note/search indexing, verified line
  edits, tag rename, attachment cleanup). No `vscode` imports — vitest
  runs it directly.
- **`src/extension/`** — the extension host: activation/vault detection,
  editor providers (links, completions, hover, decorations, paste-image),
  commands, webview panels/views, and the two-way-sync write path
  (`verifiedEdit.ts`).
- **`src/webviews/`** — React apps for the board, timeline, machine log,
  graph, search, backlinks, properties, and settings, themed with VS Code
  color variables.
- **`src/shared/`** — types, the markdown parser, the host↔webview RPC
  contract, and path/search utilities.

See [REQUIREMENTS.md](REQUIREMENTS.md) for the full feature/scope
specification, and [CLAUDE.md](CLAUDE.md) for the contributor/agent
guide to this codebase.

## Development

```sh
npm install
npm run watch        # esbuild in watch mode; then F5 → Extension Development Host
npm run build        # bundle host + webviews to dist/
npm run typecheck    # TypeScript check (host + webviews)
npm test             # run the test suite (vitest)
npm run package      # build the installable .vsix (vsce)
```

Install locally with **Extensions → … → Install from VSIX…** pointing at
the packaged file.

## License

[MIT](LICENSE) © Bradley Krone
