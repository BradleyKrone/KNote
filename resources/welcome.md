# Welcome to KNote

KNote is a local-first, plain-Markdown note system with a Kanban board and
a project planner built in — now running as a **VS Code extension**. Everything
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
  render as a styled document — proportional body text in a centered reading
  column, boxed code blocks, tinted quotes, and long lines that wrap with a
  hanging indent so a list item's continuation tucks under its own text —
  while the raw syntax reveals on the line your cursor is on, so you always
  edit the source directly.
- **Pipe tables render as real grids you type straight into** (with column
  alignment) — click any cell and start typing, the way Obsidian does it. The
  table stays a rendered grid; you never edit raw pipes to enter data. Keys
  while a cell is open:

  | Key | Does |
  | --- | ---- |
  | `Tab` / `Shift+Tab` | Next / previous cell. `Tab` off the last cell adds a row. |
  | `Enter` | Cell below; on the last row, adds one. |
  | `Shift+Enter` | Line break inside the cell. |
  | `←` `→` | Move within the cell; at its edge, to the next/previous one. |
  | `↑` `↓` | Cell above / below; past the edge, out of the table. |
  | `Esc` | Leave the table. |

  `[[link]]` and `#tag` autocomplete and `Ctrl+B`/`Ctrl+I` work inside a cell.
  Pasting spreadsheet data (tab-separated, one line per row) fills the cells
  around the caret and grows the table to fit. Right-click anywhere for
  **Insert ▸ Table…** (pick a row/column count), or right-click a cell for
  **Table ▸** to insert/delete the row or column under it — or
  **Table ▸ Edit table source** to hand-edit the raw Markdown.
- **`` ```mermaid `` code blocks render as real diagrams** (flowcharts,
  sequence diagrams, and anything else Mermaid supports); click a diagram to
  drop your cursor in and edit the raw source, exactly like every other
  construct. An invalid diagram shows its error inline instead of breaking
  the editor.
- **Enter seeds a task's note** — finish typing a top-level task line and
  press **Enter** to auto-insert its indented `Status Changed` / `Date
  Entered` / `Notes` block, with the cursor left on the Notes line. This also
  stamps a hidden `^anchor` (named after the task) on the line so it's
  immediately linkable — see **Link straight to a task** below. Only fires on a
  fresh, unseeded task; a normal
  newline runs everywhere else. (The `Ctrl+Alt+Enter` command does the same on
  demand.)
- **Click a task to edit it** — clicking anywhere on a task line (checkbox
  included) drops your cursor in to edit the source, like every other
  construct. To change a task's status, **right-click the checkbox** for the
  Kanban switcher (it stamps `Status Changed:` and prompts for a reason on
  Require-reason columns, exactly like dragging its card on the board), or use
  `Ctrl+L` to advance the status on the cursor line.
- **Each task shows its state** — a top-level task carries a small pill right
  after its checkbox naming the Kanban column it currently maps to (To Do, In
  Progress, Done, …), so you can read a note's task states at a glance without
  opening the board. It updates the moment the status changes.
- **Link straight to a task** — every task you create is automatically given a
  hidden `^anchor` named after the task itself
  (`- [ ] Rewire the pump ^rewire-the-pump`), so it's linkable with no manual
  step and still readable if you ever open the file elsewhere. Three ways to
  get a link, none of which require finding that anchor:
  - Right-click a task → **Task ▸ Copy link to task**.
  - On the **board**, hover a card and click the 🔗 button.
  - From the note you're writing in, type `[[Note#^` and pick the task by its
    **text** — see *Autocomplete* below.

  Either way you get `[[Note#^id|The task's text]]` on the clipboard, which
  renders as just the task's text — paste it into your daily "what I did" note
  and click it to jump right back to that task. The `^anchor` stays out of
  sight in Live Preview and only shows when your cursor is on the line.
- **Click a sub-task to check it off** — an *indented* checkbox is a plain
  toggle, not a Kanban card: clicking its box flips checked/unchecked and
  stamps the completion date (`✅ 2026-07-16`) on the line. Unchecking it
  removes the date again.
- **`[[Wiki links]]`** render as clickable chips (click to open, creating
  the note if it doesn't exist), `#tags` as pills, and **`![[image]]`** /
  `![](image)` embeds show inline.
- **`[Hyperlinks](https://…)`** render as just their link text — the URL is
  tucked away (hover to see it) and reappears when your cursor is on the line,
  like every other construct. Click one to open it in your browser. To make
  one, right-click → **Insert ▸ Link…**; right-click an existing link for
  **Copy link** (the bare URL, ready to paste anywhere), **Edit link…** or
  **Remove link**. Only `http`, `https` and `mailto` addresses will open —
  anything else is refused. Opening a link hands it to your browser; KNote
  itself still never touches the network.
- **Hover a link to preview its note** — pause on any `[[wiki link]]` and a
  card shows the note's rendered content (about 15 lines' worth). A
  `[[Note#Heading]]` link previews just that section; a link to a note that
  doesn't exist yet says so.
- **`![[Another Note]]` embeds it inline** — a note embed on its own line
  renders as a bordered card holding that note's content, Obsidian-style.
  Click the card to open the embedded note — an embed follows like a link,
  just as `[[Note]]` does. **Alt+click** the card instead to drop your cursor
  into the raw `![[…]]` source for editing.
  `![[Note#Heading]]` embeds one section (down to the next same-or-higher
  heading) and `![[Note#^task-id]]` embeds a single task with its detail
  block. Edit the embedded note and the card follows along.
- **Autocomplete for tags and links** — type `#` for a list of every tag
  (most-used first), or `[[` for every note (and its aliases); the list
  filters and re-sorts as you keep typing. `[[Note#` then suggests that
  note's headings, `[[Note#^` its block anchors — **each one listed with its
  task's text**, so you pick the task by reading it rather than by knowing its
  id, and accepting one writes the aliased `[[Note#^id|Task text]]` form for
  you. `Enter`/`Tab` accepts, arrows navigate, `Esc` dismisses; `Ctrl+Space`
  reopens the list.
- `Ctrl+B` / `Ctrl+I` / `Ctrl+Shift+X` / `` Ctrl+E `` toggle bold / italic /
  strikethrough / inline code on the selection.
- **Tasks group into cards** — a top-level task with indented detail beneath
  it (its `Status Changed` / `Date Entered` / `Notes` block and any sub-tasks)
  is wrapped in a light box, so it's clear at a glance what belongs to which
  task. A lone task with no detail isn't boxed. That box is exactly what
  double-clicking the board's card opens for editing — see **✏️ Edit a
  task** below.
- **Fold task detail — or a whole heading section — out of the way** — any line
  with indented content below it (a task's detail block and sub-tasks, nested
  lists, note bodies) gets a collapse arrow in the left gutter on hover, and so
  does any heading: folding a heading collapses everything under it, down to the
  next heading at the same or a higher level. Click the arrow to fold the block
  to a `…` (a task's card closes up around the single line), so a long note
  reads as a clean list of top-level tasks or headings; click the `…` or the
  arrow to expand. `Ctrl+Shift+[` / `Ctrl+Shift+]` fold / unfold the current
  line; `Ctrl+Alt+[` / `Ctrl+Alt+]` fold / unfold everything.
- **Spell checking** — misspelled words get a red wavy underline as you type
  (code, `[[wiki links]]`, `#tags`, URLs and frontmatter are skipped).
  **Right-click a flagged word** for suggested corrections; pick one to
  replace it, or **Add to dictionary** (saved to your vault) / **Ignore**
  (this session). Runs fully offline on a bundled English dictionary.
- Need the raw source? **KNote: Reopen as Raw Text** (or the `</>` button in
  the editor title bar) switches this note to the plain text editor; **KNote:
  Open in Live Preview** (the book button) switches back. Right-click a note →
  **Reopen Editor With…** also works.

Everything native still works on the underlying file: `Ctrl+P` quick open,
source control, and — from the raw text editor — KNote's wiki-link
autocomplete, hover previews, and paste-image.

**Reading mode** (`Ctrl+Shift+V`, VS Code's built-in Markdown preview) now
understands KNote's syntax too: `[[wiki links]]` render as real links you can
click to open the note (unresolved ones show dotted and inert), `#tags` as
pills, and `![[image]]` embeds inline.

## Renaming a note keeps its links

Rename or move a note — in the Explorer, `F2`, drag-and-drop, anything — and
every `[[link]]` pointing at it is rewritten across the vault:

- **One undo.** The rewrite is part of the same operation as the rename, so
  `Ctrl+Z` puts both back.
- **Renaming a folder** updates the links to every note inside it.
- **Your writing style is preserved** — `[[Note]]` stays a bare name,
  `[[Folder/Note]]` stays a path, and `#headings`, `|display text` and the `!`
  embed prefix all survive untouched. A pure *move* leaves bare links alone,
  since they still resolve.
- **Aliases are left alone.** A link written through a note's `aliases:` still
  resolves after the rename, so it's not touched.
- Links inside code blocks and frontmatter are never rewritten. Notes that were
  closed get saved; a note you had unsaved edits in stays dirty, so your
  in-progress work is still yours to save.

Turn it off in **Vault Settings → Links** if you'd rather links never move.

### Right-click menu

Right-click anywhere in a Live Preview note for a context menu that acts on
the clicked line. Actions are grouped into submenus that open on hover, so the
menu stays short — the clipboard actions and anything specific to what you
clicked (a misspelling, a hyperlink) sit at the top level. A group only
appears when the clicked line can use it. Every entry carries an icon on the
left, so you can pick one out at a glance instead of reading down the list:

| Item | Effect |
|---|---|
| Cut / Copy / Paste | The usual clipboard actions (Cut and Copy grey out with nothing selected). `Ctrl+X`/`C`/`V` work as always |
| **Format ▸** Bold / Italic / Strikethrough / Inline code | Toggle the marker on the selection |
| **Insert ▸** Wiki link | Insert `[[]]` (wraps the selection if any) |
| **Insert ▸** Link… | Enter link text + a URL → insert a `[text](url)` hyperlink (pre-fills from the selection) |
| **Insert ▸** Checkbox | Insert a `- [ ]` task line |
| **Insert ▸** Milestone | Insert a dated `🏁 Milestone 📅 …` line |
| **Insert ▸** Table… | Pick a row/column count → insert an empty table |
| **Insert ▸** Machine work… | Pick a serial + date → insert a `🚜` entry with the detail template |
| **Insert ▸** Draw.io Diagram | Create a blank diagram in your attachments folder, embed it, and open it for editing |
| **Task ▸** Add tag… / Set priority… / Set due date… | *(task/milestone lines)* edit that line's `#tag` / `!!!` / `📅` |
| **Task ▸** Copy link to task | *(task/milestone lines)* copy a `[[Note#^id\|Task text]]` link to this task (adding a hidden `^anchor` named after the task if needed) — paste it elsewhere to jump back |
| **Table ▸** *(row/column actions)* | *(inside a table)* insert or delete the clicked row or column, or drop to the raw Markdown with Edit table source |
| Open link / Copy link / Edit link… / Remove link | *(on a hyperlink)* open it in your browser, copy the bare URL, change its text/target, or unwrap it back to plain text |
| Edit machine entry… | *(🚜 lines)* change the serial + date, keeping the activity text |
| *Suggestions* / Add to dictionary / Ignore | *(misspelled words)* replace with a correction, add the word to your vault dictionary, or ignore it this session |

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

### Code blocks

Fenced code blocks (```` ```lang ````) are syntax-highlighted, both while
editing in Live Preview and in embeds/hover previews/Reading mode, for a
broad common set of languages — JS/TS, Python, JSON, HTML, CSS, Bash, Markdown,
YAML, C/C++, Java, Go, Rust, SQL. An unrecognized language still renders as
plain, unhighlighted code rather than an error. Right-click in Live Preview →
**Insert → Code block** to add an empty fence with the caret on the language
slot.

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
- Columns marked **Require reason** (e.g. Waiting) prompt for a reason **and a
  follow-up date** — when to come back to it — and stamp a
  `Reason for <Column>: … ⏳ date` line under the task. Both fields are
  mandatory; the date is pre-filled a week out. The follow-up date shows on the
  card as an ⏳ chip, coloured on the same scale as due dates below, so a
  Waiting card you've stopped chasing turns red.
  Moving the task back out (or archiving it) **deletes that line again** — the
  reason *and* its follow-up date only live as long as the column they belong
  to. Every column change stamps/refreshes a `Status Changed:` line.
- Filter by text, tag, and three date filters: **Status Changed**,
  **Date Entered**, and **Due** (any / today / this week / date / range).
- **Due dates and Waiting follow-up dates colour themselves** on one shared
  scale, so what's urgent stands out at a glance:

  | Date | Chip |
  | --- | --- |
  | Overdue | 🔴 red |
  | Today | 🟡 yellow |
  | Within the next 7 days | 🟢 green |
  | Further out, or the task is done | plain grey |

  Hover either chip for the distance in words ("in 4 days", "3 days ago") —
  the ⏳ follow-up chip also shows the reason the task is parked.
- **✏️ Edit a task** — double-clicking a card opens a dialog holding the task line
  (with the #tag / priority / 📅 due-date buttons) and, underneath it,
  **everything nested under that task**: its notes, its sub-tasks, *their*
  notes, nested bullets, tables and fenced code. Not a plain text box — it's the
  same **Live Preview editor** notes use, so you get clickable checkboxes,
  `[[link]]` and `#tag` autocomplete, rendered tables, Mermaid, note embeds,
  hover previews, paste-an-image, spell check and `Ctrl+F` find, right there in
  the dialog.
- **➕ Add card** opens that same dialog empty instead of a one-line input —
  fill in the task text, tags, due date and any notes/sub-tasks up front.
  Nothing is written until you save: **Create** appends the finished task (and
  its `Reason for <Column>` line, for a Require-reason column) in one go;
  **Cancel** discards it.

  | In the dialog | What happens |
  | --- | --- |
  | Tick a sub-task | Changes it *in the dialog only* — nothing is written until Save, and `Ctrl+Z` undoes it |
  | Save | The task line **and the whole block** go back as one verified edit: one undo step, refused outright rather than half-written if anything in the block moved meanwhile |
  | Cancel / `Esc` | Throws the lot away (with a confirm if you've typed something) |
  | `Ctrl/Cmd+Enter` | Saves from anywhere in the dialog |

  This task's own `Reason for <Column>`, `Status Changed` and `Date Entered` are
  KNote's to write, so they show read-only in the row above the editor — and
  typing one into the editor won't hijack the real thing. A **sub-task's** own
  stamps are different: they're part of the block, so they show in the editor
  and are kept exactly as they are. The notes stay in the note; the board is
  just another window onto them.
- Cards also support archive (`- [a]` — struck through, off the board), delete,
  add-card (into the scoped note, or this week's weekly note when the board
  isn't scoped to one note), and same-note reordering.
- **Jump to the task** — click the note name under a card to open its note
  at the task's line, where it's shown (it's hidden when the note is
  already obvious — grouped boards and per-note boards).
- **🔗 Copy link to task** — hovering a card shows a link button that copies a
  `[[Note#^id|Task text]]` link to that task, adding the hidden `^anchor` to
  the source note first if the line doesn't have one. Paste it into any note to
  link back to the task, no need to open its note and hunt for the anchor.
- Typing in a note updates the board live, and vice versa.

## Activity Bar icons

KNote adds five icons to the Activity Bar. The KNote icon holds the note
panels; the rest are quick-access launchers — the top row of each opens
the main thing, the rows under it jump straight to one item.

| Icon | Section | Top row opens | Rows below |
| --- | --- | --- | --- |
| Calendar | **This Week** | **This Week's Note** — opens (creating if needed) the current ISO-week note; just clicking the icon opens it | Past weekly notes, newest first — click to open |
| Kanban columns | **Boards** | **All Tasks** — the whole-vault board | **Filter by Project** — All / Unassigned / one row per project (expand for its deliverables); clicking any of them opens (or narrows) the whole-vault board |
| Tractor | **Machines** | **Full Machine Log** | Registered machines (then any unregistered serial found in a note); expand for its 🚜 entries, newest first — click to jump to the line |
| Timeline | **Projects** | **Open Planner** | One row per `type: project` note (deliverable count + span). **Tick a project to show it on the Planner chart, untick to hide it** — the choice is saved in the vault. Click the name to open its note |

These all track the index live, so counts and lists follow your edits.

## Sidebar: Search, Backlinks, Outline, Tags, Properties

The **KNote icon in the Activity Bar** opens five panels:

- **Search** — full-text with operators: `path:`, `tag:`, `file:`, quoted
  `"phrases"`, and `-excludes`. `tag:none` finds untagged notes.
- **Backlinks** — every note linking to the active note, plus **unlinked
  mentions** of its title/aliases with a one-click **Link** button.
- **Outline** — heading tree (H1–H6) for the active note, indented by
  level; click a heading to jump the editor there.
- **Tags** — every tag with usage counts; click to search, right-click to
  rename across the vault or deprecate (hide from pickers).
- **Properties** — form-style frontmatter editing for the active note.

## Project Planner

**KNote: Open Project Planner** is a Gantt chart over your projects —
deliverables as bars on a schedule, drag them to re-plan. It replaces the
old Timeline panel. Everything it shows lives in plain Markdown:

| Thing | How you write it |
| --- | --- |
| Project | a note with `type: project` (and optionally `project: <slug>`) in its frontmatter |
| Its deadline | `end: 2026-06-30` in the same frontmatter (`due:`/`deadline:` also read) |
| Finishing it | `status: completed` — set it from the planner's right-click menu |
| Deliverable | a top-level task in that note: `- [ ] Design 🛫 2026-04-01 📅 2026-04-20 @deliverable(govalle/design)` |
| Its tasks | any checkbox line **anywhere in the vault** carrying that same `@deliverable(govalle/design)` marker — deliberately *not* a `#tag`, so joining a deliverable never clutters the Tags sidebar or `#` autocomplete |
| Dependency | `⛓ @deliverable(govalle/contracts)` on the deliverable line — "starts after that one"; repeatable |
| Milestone | a `🏁 Permits approved 📅 2026-04-12 @deliverable(govalle/design)` line — a diamond on the chart |

`🛫` is the start date, `📅` the end date (`@start(...)`/`@due(...)` also
read). A deliverable with no `🛫` is a single-day bar. Notes written before
KNote switched to `@deliverable(...)` may still carry a deliverable's or
dependency's identity as a `#deliverable/…` tag — that older form still
reads fine, but nothing writes it any more.

In the chart:

| Action | What it does |
| --- | --- |
| Drag a bar | moves it — **and everything that depends on it**, by the same number of days. Independent bars never move |
| Drag a bar's left edge | changes just the start date |
| Drag a bar's right edge, or edit its due date | changes the end date — **and carries anything waiting on it along by the same number of days**, same as a full drag |
| Drag the 🔗 grip onto another bar | makes that bar wait on this one (a link that would create a loop is refused) |
| Double-click any row | opens the note at that line |
| Right-click a deliverable → **Edit dates…** | a calendar for both ends of the span, with 1/3/5/10/20-day length presets and ±1d/±1w/Today nudges that slide the span without changing its length |
| Right-click a deliverable → **Depends on ▸** | every other deliverable, ticked where it's already a predecessor — click to add or remove. Anything that would create a loop is greyed out and labelled *would loop* |
| Right-click a row | also: add a deliverable / task / milestone |
| day / week / month | zoom; **Today** re-centres on the today line |

Bar fill is % complete — the share of the deliverable's tasks that are
checked (or its own checkbox if it has none). A bar that starts before
something it depends on finishes is outlined in red.

**Editing a deliverable from the editor.** The same **Set start date… /
Set due date… / Depends on ▸** trio is one right-click away in the note
itself, not just the Planner panel: right-click a deliverable's own task
line and its **Task ▸** submenu becomes **Deliverable ▸**, with those three
items plus the usual tag/priority. Depends on ▸ lists every other live
deliverable, ticked where it's already a predecessor — the same picker the
chart's right-click menu uses.

**Project status.** A project carries a badge in the tree:

| Badge | When |
| --- | --- |
| *(none)* | active |
| **overdue** | its `end:` date has passed with work still open. A project with no `end:` date is never overdue — a derived finish isn't a promise |
| **done** | `status: completed` |

Right-click a project for **Set target end date…** and **Mark project
completed** / **Reopen project**. Completed projects sort to the bottom of
the list and are **closed for business**: Add deliverable / task /
milestone are greyed out, and their deliverables disappear from
`@deliverable(...)` and `#` tag autocomplete, so old work can't be filed
against a finished project by accident. Reopening restores all of it.
Nothing is deleted or hidden — the chart still draws everything the
project contains.

**Deliverable tasks and the board:** a task carrying `@deliverable(...)`
only appears on the Kanban board once its deliverable has actually started —
before that it's hidden so future-scheduled work doesn't clutter the board
early. Once started it stays visible for good, checked or not; only
archiving a task removes it. Unjoined tasks are unaffected. Tick **All
deliverables** in the board header to see everything regardless.

**Overdue deliverables flag their tasks too:** once a deliverable's own
`📅` end date has passed with work still open, every task that joins it
shows red on the board — even one with no `📅` of its own — so a slipping
deliverable can't hide behind tasks that were never individually dated.
"Still open" means its member tasks aren't all checked, or (a deliverable
with no members yet) its own checkbox isn't.

## Machine Log, Graph

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

## Attachments clean themselves up

When you delete the last `![[embed]]` of an image from a note (and save), or
delete a note that embedded images, KNote moves the now-orphaned files out of
the attachments folder automatically:

- **To the OS trash / Recycle Bin** — never permanently deleted; restore from
  there if you change your mind.
- **Shared images are safe** — an image still embedded by *any* other note is
  left untouched.
- Works for `![[wiki embeds]]` and `![](markdown)` images alike, and also when
  a note is edited or deleted outside VS Code (the file watcher catches it).
- Moving an embed between notes? Do the cut *and* the paste before saving the
  first note — otherwise the image is trashed in between (recoverable from
  the Recycle Bin).
- **KNote: Clean Up Orphaned Attachments** still exists for a full manual
  sweep of anything that predates this feature.

## Draw.io diagrams

Embed a draw.io diagram in a note and edit it without leaving VS Code:

- **Right-click in Live Preview → Insert ▸ Draw.io Diagram** creates a
  blank diagram in your attachments folder, embeds it (`![[/…]]`) at the
  cursor, and opens it for editing. **KNote: Insert Draw.io Diagram** in the
  Command Palette does the same from the raw text editor (prompting for a
  name first).
- The diagram renders inline like any other image, in both Live Preview and
  Reading mode. **Double-click it in Live Preview** to reopen it for editing
  (a plain `[[link]]` to a `.drawio` file works the same way on a single click).
- Diagrams are stored as `.drawio.svg`/`.drawio.png` — draw.io's own
  "editable image" format, a real SVG/PNG with the diagram data embedded
  inside it, so it's a normal image everywhere else too.
- Editing needs the free **Draw.io Integration** extension
  (`hediet.vscode-drawio`) installed — KNote prompts you to install it the
  first time you try to edit a diagram if it isn't there yet. That
  extension's editor runs fully offline once installed, same as everything
  else in KNote.

## Data rules (unchanged)

- Your vault of `.md` files is the sole source of truth. The index is
  in-memory only, rebuilt from files, never authoritative.
- All board/timeline state persists as plain Markdown — checkboxes, status
  chars, and indented meta lines you can read and edit by hand.
- KNote makes **zero network calls**. Nothing leaves your machine.
