# Welcome to KNote

KNote is a local-first, plain-Markdown note system with a Kanban board and
a timeline built in — now running as a **VS Code extension**. Everything
you write is a `.md` file on disk in your **vault** (a workspace folder) —
no proprietary format, no account, no network calls of any kind.

This guide is bundled with the extension itself, not stored in your vault.
Reopen it any time with **KNote: Open Welcome & Feature Guide** from the
Command Palette (`Ctrl+Shift+P`).

## Your vault is a workspace folder

Open your vault folder in VS Code (**File → Open Folder…**). A folder
containing a `.knote/` directory is recognized as a vault automatically;
for a fresh folder run **KNote: Initialize Vault in This Workspace** once.
Per-vault settings live in `.knote/config.json` (edit them comfortably via
**KNote: Open Vault Settings**).

Because notes are ordinary Markdown files in an ordinary VS Code workspace,
everything native just works: the Explorer, tabs and split editors, `Ctrl+P`
quick open, `Ctrl+Shift+F` full-text search, source control, and any other
extension you run (Copilot, Vim, spell checkers, …).

## Editing notes

Notes open in VS Code's normal Markdown editor, enhanced by KNote:

- **`[[Wiki links]]`** are clickable (Ctrl+click) — including
  `[[Note#Heading]]`, `[[Note#^block-id]]`, and `[[Note|alias]]` forms.
  Clicking a link to a note that doesn't exist yet creates it.
- **Autocomplete**: type `[[` for note titles and aliases, `[[Note#` for
  headings/block IDs, and `#` for existing tags.
- **Hover** a wiki link for a preview of the target note.
- **Decorations** highlight `#tags`, `!`/`!!`/`!!!` priority markers, and 🏁
  milestone lines, and dim task-meta lines. Toggle with the
  `knote.decorations.enabled` setting.
- **Paste an image** and it's saved into your configured attachments folder
  and embedded as `![[/path]]` — same format the notes always used.
- Reading view: VS Code's built-in Markdown preview (`Ctrl+Shift+V`).

## Formatting & task hotkeys

All in Markdown editors only:

| Hotkey | Effect |
|---|---|
| `Ctrl+B` / `Ctrl+I` | Bold / italic |
| `Ctrl+Shift+X` | Strikethrough |
| `Ctrl+Alt+C` | Inline code |
| `Ctrl+L` | Cycle the task's status (column) on the cursor line |
| `Ctrl+Alt+L` | Set task status from a list (includes Archive) |
| `Ctrl+Alt+X` | Toggle a `- [ ]` checkbox on the current line |
| `Ctrl+Alt+Enter` | Seed/extend the task's attached note (Status Changed / Date Entered / Notes) |

All hotkeys are ordinary VS Code keybindings — rebind them in **Keyboard
Shortcuts** (`Ctrl+K Ctrl+S`).

## The Kanban board

**KNote: Open Kanban Board** (`Ctrl+Alt+K`) opens the board; **KNote: Open
Board for This Note** scopes it to one note. Everything on it is a checkbox
task somewhere in your vault:

- Columns map to checkbox status chars (`- [ ]`, `- [/]`, `- [x]`, …) —
  configure them in Vault Settings → Kanban board.
- **Dragging a card rewrites exactly one line** in the source note. If the
  note is open (even with unsaved edits) the change lands in your editor
  buffer; otherwise it's a verified disk write that refuses to clobber
  external changes.
- Columns marked **Require reason** (e.g. Waiting) prompt for a reason +
  date and stamp a `Reason for <Column>: … 📅 date` line under the task.
  Every column change stamps/refreshes a `Status Changed:` line.
- Filter by text, tag, and three date filters: **Status Changed**,
  **Date Entered**, and **Due** (any / today / this week / date / range).
- Cards support edit-in-place, archive (`- [a]` — struck through, off the
  board), delete, add-card (into the scoped note or your Inbox note), and
  same-note reordering.
- Typing in a note updates the board live, and vice versa.

## Sidebar: Search, Backlinks, Tags, Properties

The **KNote icon in the Activity Bar** opens four panels:

- **Search** — full-text with operators: `path:`, `tag:`, `file:`, quoted
  `"phrases"`, and `-excludes`. `tag:none` finds untagged notes.
- **Backlinks** — every note linking to the active note, plus **unlinked
  mentions** of its title/aliases with a one-click **Link** button.
- **Tags** — every tag with usage counts; click to search, right-click to
  rename across the vault or deprecate (hide from pickers).
- **Properties** — form-style frontmatter editing for the active note.

## Timeline, Machine Log, Graph

- **KNote: Open Timeline** — everything dated, chronologically: tasks with
  `📅 2026-07-15`, notes with `date:`/`due:`/`deadline:` frontmatter, and
  standalone `🏁 Milestone 📅 date` lines (`!!!` renders large). Right-click
  an item to change its date.
- **KNote: Open Machine Log** — 🚜 work entries collected from every note,
  filterable by serial, config attribute, tag, and text, optionally grouped
  per machine. Insert entries with **KNote: Insert Machine Log Entry**;
  register machines (serial → model + attributes) in Vault Settings →
  Machines.
- **KNote: Open Graph View** — force-directed map of your notes and their
  wiki links, with unresolved-target ghosts and orphan toggles. Click a
  node to open it.

## Weekly notes, templates, capture

| Command | Effect |
|---|---|
| **KNote: Open This Week's Note** (`Ctrl+Alt+W`) | Opens/creates this ISO week's note from your weekly template |
| **KNote: Quick Capture** (`Ctrl+Alt+J`) | Appends a timestamped bullet to this week's note from anywhere |
| **KNote: Insert Template** | Inserts a template at the cursor with `{{date}}`, `{{time}}`, `{{title}}`, `{{weekdays}}` expanded |
| **KNote: Insert Milestone** (± Important) | Inserts a dated 🏁 line |
| **KNote: Clean Up Orphaned Attachments** | Finds images in the attachments folder no note references and moves them to the trash (after you confirm) |

## Data rules (unchanged)

- Your vault of `.md` files is the sole source of truth. The index is
  in-memory only, rebuilt from files, never authoritative.
- All board/timeline state persists as plain Markdown — checkboxes, status
  chars, and indented meta lines you can read and edit by hand.
- KNote makes **zero network calls**. Nothing leaves your machine.
