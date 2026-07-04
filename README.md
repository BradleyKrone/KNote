# KNote

KNote is a local-first, plain-Markdown note-taking desktop app modeled
closely on [Obsidian](https://obsidian.md/), with a built-in Kanban board
driven by checkboxes in your notes. It's an Electron + React + TypeScript
app that runs entirely on your machine — **no server, no account, no
network calls of any kind.**

Notes are just `.md` files in a folder you choose (a **vault**). That
folder is the entire data model — no database, no proprietary format,
nothing that isn't readable and editable in any other text editor.

## Features

### Core note-taking (Obsidian parity)
- **Vault & file explorer** — open any folder as a vault; create, rename,
  move, and delete notes/folders; live-reflects external file changes.
- **Editor** — CodeMirror 6 markdown editor with three modes: live
  preview (WYSIWYG-style), source mode (raw markdown), and reading mode
  (read-only render).
- **Wiki-links** — `[[Note Name]]`, `[[Note Name#Heading]]`,
  `[[Note Name|display text]]`, and `![[Note Name]]` embeds, with
  autocomplete, backlinks, and unlinked-mentions.
- **Tags** — `#tag` / `#nested/tag` anywhere in a note or in frontmatter,
  with a sidebar tag browser.
- **Frontmatter / properties** — YAML metadata block per note, viewable
  as form fields in the properties panel.
- **Search** — vault-wide full-text search with operators (`path:`,
  `tag:`, `file:`, quoted phrases, exclusion).
- **Command palette** (`Ctrl+P`) and **quick switcher** (`Ctrl+O`) for
  fast, keyboard-driven navigation.
- **Weekly notes** — one-click open-this-week's-note, auto-created from a
  configurable template, folder, and filename format.
- **Templates** — a templates folder with `{{date}}` / `{{time}}` /
  `{{title}}` placeholder support.
- **Paste-to-embed images** — paste a screenshot directly into a note;
  it's saved to your attachments folder and embedded automatically.
- **Spell check** — native right-click suggestions and "Add to
  dictionary."
- **Light/dark theme**, matching Obsidian's look and feel.

### Kanban board (KNote's signature addition)
- Every checkbox line in every note (`- [ ]`, `- [x]`, `- [/]`, and
  custom statuses) becomes a task card, automatically discovered and
  kept in sync as you edit.
- **Global board** (all notes) or **per-note board**, opened from the
  command palette.
- **Two-way sync**: dragging a card between columns rewrites the
  checkbox character in the source file; editing a checkbox in the
  editor updates the board immediately — no manual refresh.
- Custom columns/statuses configurable in **Settings → Kanban board**.
- Cards carry tags, due dates (`📅 2026-07-15` / `@due(2026-07-15)`), and
  priority markers (`!`, `!!`, `!!!`).
- New cards created on the global board land in a configurable **Inbox**
  note.
- Archive finished cards (`- [a] ...`) to strike them through and drop
  them off the board without deleting anything.

### Timeline
- A chronological view of every dated task, `🏁` milestone, and note with
  a `date:` frontmatter field across the vault, with a marker for today.

### Machine log
- Register machines (serial number, model, config attributes) in
  **Settings → Machines**; log dated work entries against them and browse
  a filterable, searchable log grouped by machine.

## Why fully offline?

This is a deliberate, permanent design constraint, not a missing feature:
no telemetry, analytics, crash reporting, update checks, or any call to a
remote host — ever. If you want to sync a vault across machines, use an
external tool of your choice (Syncthing, Dropbox, git, etc.) entirely
outside KNote.

## Architecture

Three-process Electron split under `src/`:

- **`src/main/`** — Node/Electron main process; owns the filesystem
  (vault CRUD, file watching via chokidar, search/backlink indexing,
  settings, IPC handlers).
- **`src/preload/`** — the only bridge between main and renderer, via
  `contextBridge` (`contextIsolation: true`, `nodeIntegration: false`).
- **`src/renderer/`** — React 18 + Vite UI: editor, Kanban board,
  timeline, machine log, panels, command palette, settings.
- **`src/shared/`** — shared types, IPC channel definitions, and the
  markdown parser.

See [REQUIREMENTS.md](REQUIREMENTS.md) for the full feature/scope
specification, and [CLAUDE.md](CLAUDE.md) for the contributor/agent
guide to this codebase.

## Development

```sh
npm install
npm run dev          # run the app (electron-vite dev)
npm run typecheck    # TypeScript check (main + renderer)
npm test             # run the test suite (vitest)
npm run dist         # build a Windows installer (electron-builder)
```

## License

[MIT](LICENSE) © Bradley Krone
