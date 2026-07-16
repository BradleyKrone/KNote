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

## Live Preview editing

Notes open in **Live Preview** by default — an Obsidian-style editor that
renders Markdown as you type while keeping the file byte-for-byte plain
Markdown:

- Headings, **bold**/*italic*/~~strike~~, `code`, blockquotes and lists
  render inline; the raw syntax reveals on the line your cursor is on, so
  you always edit the source directly.
- **Checkboxes are clickable** — a click advances the task to the next
  Kanban column (stamping `Status Changed:`, and prompting for a reason on
  Require-reason columns), exactly like dragging its card on the board.
- **`[[Wiki links]]`** render as clickable chips (click to open, creating
  the note if it doesn't exist), `#tags` as pills, and **`![[image]]`** /
  `![](image)` embeds show inline.
- `Ctrl+B` / `Ctrl+I` / `Ctrl+Shift+X` / `` Ctrl+E `` toggle bold / italic /
  strikethrough / inline code on the selection.
- Need the raw source? **KNote: Reopen as Raw Text** (or the `</>` button in
  the editor title bar) switches this note to the plain text editor; **KNote:
  Open in Live Preview** (the book button) switches back. Right-click a note →
  **Reopen Editor With…** also works.

Everything native still works on the underlying file: `Ctrl+P` quick open,
source control, and — from the raw text editor — KNote's wiki-link
autocomplete, hover previews, and paste-image. VS Code's built-in Markdown
preview (`Ctrl+Shift+V`) is still available too.

### Right-click menu

Right-click anywhere in a Live Preview note for a context menu that acts on
the clicked line:

| Item | Effect |
|---|---|
| Bold / Italic / Strikethrough / Inline code | Toggle the marker on the selection |
| Insert wiki link | Insert `[[]]` (wraps the selection if any) |
| Add checkbox | Insert a `- [ ]` task line |
| Add milestone | Insert a dated `🏁 Milestone 📅 …` line |
| Log machine work… | Pick a serial + date → insert a `🚜` entry with the detail template |
| Add tag… / Set priority… / Set due date… | *(task/milestone lines)* edit that line's `#tag` / `!!!` / `📅` |
| Edit machine entry… | *(🚜 lines)* change the serial + date, keeping the activity text |

**Right-click a checkbox glyph** for a quick Kanban switcher: pick any
column (the current one is checked) or **Archived** — same behavior as
`Ctrl+L`, including reason prompts and the `Status Changed:` stamp.

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

**KNote: Open Kanban Board** (`Ctrl+Alt+K`), or the Kanban icon in the
Activity Bar, opens the board; **KNote: Open
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

## Activity Bar icons

KNote adds four icons to the Activity Bar. The KNote icon holds the note
panels; the other three are quick-access launchers — the top row of each
opens the full panel, the rows under it jump straight to one thing.

| Icon | Section | Top row opens | Rows below |
| --- | --- | --- | --- |
| Kanban columns | **Boards** | **All Tasks** — the whole-vault board | One row per note that has tasks, `open/total`, busiest first — click for that note's board |
| Tractor | **Machines** | **Full Machine Log** | Registered machines (then any unregistered serial found in a note); expand for its 🚜 entries, newest first — click to jump to the line |
| Timeline | **Milestones** | **Full Timeline** | Dated `🏁` milestones — upcoming soonest-first, then past — click to jump to the line |

All three track the index live, so counts follow your edits.

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
