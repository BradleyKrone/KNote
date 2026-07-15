# KNote — Requirements Document

> **Platform note (July 2026):** KNote was converted from a standalone
> Electron desktop app into a **VS Code extension**. The data model, file
> formats, and feature scope below are unchanged; anywhere this document
> says "application window/pane/palette," read the VS Code equivalent
> (editor tabs, webview panels, the native Command Palette). Features VS
> Code provides natively (file explorer, tabs/splits, quick switcher,
> hotkey editing, themes, full-text search UI) are deliberately no longer
> implemented by KNote itself. The built-in live-preview editor was
> retired in favor of VS Code's native Markdown editor plus KNote
> enhancements (wiki links, completions, decorations).

## 1. Overview

KNote is a personal note-taking application modeled closely on
[Obsidian](https://obsidian.md/). It stores notes as local Markdown files in
a user-owned "vault" (a folder on disk) and links notes together. It runs
entirely on the local machine — no server, no cloud, no network calls of
any kind. KNote adds one capability Obsidian does not have natively: a
**Kanban board that is automatically populated from checkbox items (tasks)
found anywhere in the vault**, with two-way sync between the board and the
source note.

This document defines the scope, features, and behavior required to build
KNote. It is intended to guide implementation, not to prescribe a specific
tech stack — technology choices are called out separately in section 8 as
recommendations.

## 2. Goals

- Provide a note-taking experience that feels "dead on" identical to
  Obsidian for anyone who already uses it: same core interaction model,
  same file format, same keyboard-driven workflow.
- Store everything as plain local Markdown files — no proprietary format,
  no cloud account, no lock-in. The vault is just a folder.
- Add a first-class Kanban board that stays in sync with checkboxes
  (`- [ ]` / `- [x]`) written in any note.
- Be a single-user, fully local desktop application. KNote makes no network
  calls and has no server component — everything it does happens on the
  user's machine against files on disk.

## 3. Non-Goals

- Real-time multi-user collaboration.
- Mobile apps.
- A plugin marketplace or plugin API.
- Publishing/sharing notes to the web.
- A graph view or any knowledge-graph visualization of note relationships.
- Any built-in sync, telemetry, analytics, or cloud/network service of any
  kind. Users who want to sync a vault do so with their own external tool
  (Syncthing, Dropbox, git, etc.), entirely outside KNote.

## 4. Core Concepts

| Concept | Description |
|---|---|
| **Vault** | A folder on the local filesystem containing all notes. Opening KNote means opening a vault. |
| **Note** | A single `.md` file inside the vault. |
| **Link** | A `[[wiki-link]]`-style reference from one note to another. |
| **Tag** | A `#tag` written anywhere in a note's content or frontmatter. |
| **Frontmatter** | YAML metadata block at the top of a note (`--- ... ---`). |
| **Task** | A Markdown checkbox line (`- [ ] text` or `- [x] text`) inside any note. |
| **Board** | A Kanban board, either a single implicit global board or a note-scoped board (see §6). |

## 5. Feature Requirements — Core Note-Taking (Obsidian Parity)

### 5.1 Vault & File Management
- Open/create a vault by picking a local folder.
- File explorer panel showing the vault's folder/file tree.
- Create, rename, move, and delete notes and folders from the file explorer.
- Support nested folders of arbitrary depth.
- Watch the filesystem for external changes (files edited/added outside the
  app) and reflect them live.
- Notes are plain UTF-8 Markdown files with `.md` extension — fully readable
  outside KNote.

### 5.2 Editor
- Markdown editor with **live preview** ("what you see is what you mean"
  style, matching Obsidian's default editing mode): headings, bold/italic,
  lists, code blocks, etc. render styled while remaining editable as raw
  text.
- Separate **Source Mode** (raw Markdown) and **Reading (preview-only) Mode**,
  toggleable per note.
- Syntax support: headings, bold, italic, strikethrough, blockquotes,
  ordered/unordered lists, checkboxes/tasks, tables, code blocks with syntax
  highlighting, horizontal rules, images, embeds.
- Markdown checkbox syntax: `- [ ] task` (open) and `- [x] task` (done),
  clickable directly in the editor/preview to toggle state.
- Command palette (`Ctrl/Cmd+P`) for fuzzy-searching and running commands.
- Quick switcher (`Ctrl/Cmd+O`) for fuzzy-jumping to any note by name.
- Full vault-wide text search with filters (path, tag, file type) and
  in-file "find and replace".
- Multiple open notes via tabs and split panes (vertical/horizontal).
- Auto-save on edit (no explicit save step required), consistent with
  Obsidian's behavior.

### 5.3 Linking
- `[[Note Name]]` wiki-link syntax that creates a link to another note,
  auto-creating the target note on click if it doesn't exist yet.
- `[[Note Name#Heading]]` and `[[Note Name#^block-id]]` linking to a specific
  heading or block within a note.
- `[[Note Name|Display Text]]` link aliasing.
- Autocomplete/suggestion popup while typing `[[` that fuzzy-matches
  existing note titles.
- **Backlinks panel**: for the currently open note, list every other note
  that links to it, with context snippet.
- **Unlinked mentions panel**: notes that mention this note's title as
  plain text but haven't linked to it, with a one-click "link it" action.
- Embeds: `![[Note Name]]` transcludes another note's content inline;
  `![[image.png]]` embeds an image.

### 5.4 Tags
- `#tag` and `#nested/tag` syntax recognized anywhere in note body or in a
  `tags:` frontmatter list.
- Tag pane listing all tags in the vault with usage counts.
- Click a tag to see every note containing it.
- Tag autocomplete while typing `#`.

### 5.5 Frontmatter / Properties
- YAML frontmatter block at the top of a note for structured metadata
  (e.g. `tags`, `aliases`, `created`, custom fields).
- UI panel to view/edit frontmatter as form fields rather than raw YAML.
- `aliases` frontmatter field: alternate names a note can be linked/found by.

### 5.6 Search
- Global full-text search across the vault with live results and preview
  snippets.
- Search operators at parity with Obsidian: `path:`, `tag:`, `file:`,
  quoted exact phrases, `-` exclusion.

### 5.7 Appearance & UX
- Light and dark theme, matching Obsidian's default look and feel closely.
- Resizable/collapsible side panels (file explorer, backlinks, tags, graph).
- Customizable keyboard shortcuts (parity set with Obsidian's defaults).
- Command palette extensible list of built-in commands (create note, open
  graph, toggle preview, etc.).

### 5.8 Weekly Notes (Obsidian core-plugin parity, weekly instead of daily)
- One-click "open this week's note," auto-created from a configurable template
  and stored in a configurable folder, using a configurable week-based
  filename format (default: ISO week, e.g. `2026-W27.md`).

### 5.9 Templates
- A templates folder; inserting a template stamps its contents (with basic
  placeholders like `{{date}}`, `{{title}}`) into the current note.

## 6. Feature Requirements — Kanban Board (New Capability)

This is KNote's signature addition beyond Obsidian.

### 6.1 Task Discovery
- KNote scans the vault for Markdown checkbox lines: `- [ ] ...` and
  `- [x] ...` (also nested/indented checkboxes), in **every** note.
- Each discovered checkbox line becomes a **task item**, carrying:
  - task text (the content after `[ ]`/`[x]`)
  - completion state (checked/unchecked)
  - source note path and line number (so the task can be located and
    updated in the original file)
  - any inline tags/metadata on that line (e.g. `#urgent`, `@due(2026-07-10)`)
- Rescans happen incrementally on file save/change — no manual refresh
  required.

### 6.2 The Kanban Board View
- A dedicated "Board" view, opened like any other pane, showing tasks as
  draggable cards organized into columns.
- **Default column mapping**:
  - "To Do" — unchecked tasks (`- [ ]`)
  - "Done" — checked tasks (`- [x]`)
- Support for **custom columns beyond the checked/unchecked binary** (e.g.
  "To Do / In Progress / Done"), where a task's column is stored via an
  inline marker on the checkbox line (e.g. a tag such as `#in-progress`, or
  a bracket status like `- [/]` for "in progress", matching common Obsidian
  Kanban-plugin conventions) so the board state round-trips cleanly to plain
  Markdown.
- Each card displays: the task text, source note (as a link back to that
  note), and any tags found on the line.
- Board scope options:
  - **Global board**: one board aggregating checkbox tasks from the entire
    vault.
  - **Per-note/per-folder board**: a board scoped to tasks within a single
    note or folder, for project-specific boards.
- Ability to filter/group the board by tag, folder, or source note.

### 6.3 Drag-and-Drop, Two-Way Sync
- Cards can be dragged between columns using mouse drag-and-drop, and
  reordered within a column.
- **Moving a card between columns updates the source Markdown file**:
  - Dragging a card into "Done" rewrites its checkbox line from `- [ ]` to
    `- [x]` in the originating note.
  - Dragging into a custom column updates the line's status marker/tag
    accordingly (per the convention chosen in §6.2).
  - The edit is a targeted, minimal line rewrite — the rest of the note's
    content and formatting must be left untouched.
- **Editing a checkbox from within a note updates the board**: if a user
  checks/unchecks a box directly in the editor, or edits the task text,
  the corresponding card reflects the change immediately without requiring
  the board to be reopened.
- Creating a new card directly on the board (e.g. via an "Add card" button
  in a column) appends a new checkbox line to the associated note (for a
  per-note board) or to a designated inbox note (for the global board).
- Deleting a card from the board removes (or optionally archives) the
  corresponding checkbox line from its source note.
- Conflict handling: if the source file changes on disk from an external
  editor while the board is open, the board reconciles and re-renders
  rather than silently overwriting the external edit.

### 6.4 Task Metadata (stretch within v1)
- Optional due dates and simple priority markers embedded in the task line
  using a lightweight inline syntax (e.g. `📅 2026-07-10`, `!!` for high
  priority), displayed on the card and usable as board filters/sort keys.

## 7. Data & File Format Requirements

- No database required for note content — the vault folder of `.md` files
  *is* the source of truth, exactly like Obsidian.
- The application may maintain a local cache/index (e.g. for search and
  the task/board index) to avoid full-vault rescans on every action, but
  this cache must be derivable/rebuildable entirely from the Markdown files
  — never the sole source of truth.
- All storage — vault content, cache/index, and any app settings — lives
  on the local filesystem. Nothing is ever transmitted off the machine.
- All Kanban board state (columns, task status) must be representable and
  persisted as plain Markdown so notes remain fully readable/editable in
  any other Markdown editor, with no loss of board fidelity.

## 8. Suggested Technical Approach (non-binding)

- **Shell**: Electron (or Tauri) desktop app, matching Obsidian's
  cross-platform desktop model.
- **Editor**: CodeMirror 6, which is what Obsidian itself uses, for the
  live-preview Markdown editing experience.
- **Markdown parsing**: `remark`/`unified` (or `markdown-it`) with a custom
  plugin to extract checkbox lines with source position info for the board
  sync.
- **Kanban board**: a drag-and-drop library such as `dnd-kit` or
  `react-beautiful-dnd`/`@hello-pangea/dnd`.
- **File watching**: `chokidar` for detecting external filesystem changes.
- **Frontend framework**: React or Svelte; state via a lightweight store
  (Zustand/Redux or Svelte stores).

## 9. Open Questions

- Should the "in progress"/custom-column convention use a tag
  (`#status/in-progress`), a custom checkbox character (`- [/]`), or a
  dedicated `kanban:` frontmatter field on a per-note board's controlling
  note? This decision affects Markdown portability and should be settled
  before implementing §6.2/6.3.
- Should there be one global inbox note for cards created directly on the
  global board, or should the user be prompted to pick a target note each
  time?

## 10. Acceptance Criteria Summary

- [ ] A vault (folder) can be opened, and notes within it created, edited,
      renamed, moved, and deleted.
- [ ] `[[wiki-links]]`, backlinks, and unlinked mentions all function
      against a multi-note test vault.
- [ ] Tags and frontmatter are parsed and browsable.
- [ ] Full-text search returns correct, ranked results with operators.
- [ ] Any checkbox line in any note appears as a card on the Kanban board.
- [ ] Dragging a card to a different column updates the correct line in
      the correct source file, and only that line.
- [ ] Toggling a checkbox in the editor updates the board without a manual
      refresh.
- [ ] Closing and reopening the vault preserves all notes and board state,
      since both are stored entirely in the Markdown files.
