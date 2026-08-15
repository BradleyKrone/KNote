# Release notes

The current version number is shown on the KNote entry in VS Code's
Extensions view.

## 2.7.0

- **A Files panel in the sidebar.** The KNote sidebar gains a vault file
  browser at the top — one folder at a time rather than an expanding tree.
  Click a folder to go into it; the path row at the top of the list shows
  where you are and jumps back to any level of it. It shows the vault as it
  sits on disk: notes plus images, PDFs and `.drawio` diagrams, each opening
  in its normal editor.
- **Create, rename, move and delete from the Files panel.** Title-bar
  buttons make a note or folder in the folder you're in; right-click a row
  to rename it, move it to any folder in the vault, copy its full or
  vault-relative path, or send it to the system trash. Rows can also be
  dragged onto a folder to move them. Renaming or moving a note rewrites its
  `[[links]]` vault-wide, and one undo reverses the move and the rewrites
  together.
- The Files panel follows the note you're editing — open a note from search,
  a backlink or a `[[wiki link]]` and it browses to that note's folder and
  highlights it.

## 2.6.0

- **Collapsed sections are remembered per note.** Folding a heading or task
  block in the Live Preview editor now persists — closing and reopening a
  note leaves the same sections folded instead of resetting to fully
  expanded.
- **The planner opens with every deliverable collapsed**, showing just the
  deliverable bars rather than every task under them.
- **Bars are locked by default in the planner.** A new **Locked/Unlocked**
  button in the toolbar has to be clicked before a bar can be dragged, so a
  stray click while scrolling or reading the chart can't nudge a date by
  accident. Right-click actions (Edit dates…, Depends on ▸, etc.) still work
  either way.
- The planner's **Depends on ▸** menu now only lists deliverables from the
  same project (a dependency can't cross projects) and drops completed ones
  unless already linked, instead of listing every deliverable in the vault.
- Fixed a bug where a dated task in a project note could be mistaken for a
  deliverable's own defining line, overwriting that deliverable's schedule
  and sweeping its whole task list off the Kanban board.

## 2.5.0

- **Double-click a card to edit it.** The pencil button on a card is gone —
  double-clicking the card body now opens the task-and-block edit dialog
  directly. Click the note name under a card (where it's shown) to jump to
  the note instead.
- **Link a card to a deliverable from the board.** The task dialog's toolbar
  gains a 📦 button that opens the same deliverable picker the planner uses,
  so a card can be tied to a project deliverable without hand-typing
  `@deliverable(project/name)`.
- **Indent or outdent a table under a task.** Right-click a table and choose
  **Table ▸ Indent table** / **Outdent table** to nest the whole table under
  a task's checkbox, or pull it back out — a rendered table has no caret to
  park on for the ordinary Tab-to-indent, since it's one atomic block.
- The task dialog's title field is a real single-line editor now: `#tags`,
  `!!` priority and 📅 dates render styled the same way they do on the card
  and in a note, instead of showing raw markup as plain text. Pasting
  multi-line text into it is flattened onto one line instead of splitting
  the task across lines.
- Fixed a popup (the tag/priority/date/deliverable picker) in the task
  dialog sometimes not closing on an outside click.
- Fixed right-clicking an indented table losing its **Table ▸** submenu
  entirely.
- Cards added from the board now get the same `Status Changed` / `Date
  Entered` stamp a task typed straight into a note gets, instead of a bare
  checkbox line.

## 2.4.0

- **The board's task editor now edits the whole block, in a real editor.**
  The pencil on a card used to open a plain-text box holding just the task's
  own note lines; it now opens the task's entire attached block — sub-tasks,
  their notes, nested bullets, tables, fenced code — in the same Live Preview
  editor notes use, with clickable checkboxes, `[[link]]`/`#tag`
  autocomplete, rendered tables, Mermaid, note embeds, hover previews,
  paste-an-image and spell check. Saving still writes the task line and its
  whole block back as one verified edit — one undo step, refused outright
  rather than half-written if anything in the block changed on disk
  meanwhile, including a sub-task ticked elsewhere while the dialog was open.
- **Add card opens that same dialog, empty.** Instead of a one-line text
  input, **➕ Add card** now opens the full task editor so tags, due date and
  notes/sub-tasks can be filled in before the task exists at all — nothing
  is written until **Create** (or **Cancel** to discard it). On a board
  that isn't scoped to a single note, new cards now land under the
  **Tasks** heading of this week's weekly note instead of the inbox note.

## 2.3.0

- **Edit a task's full notes from the Kanban board.** The pencil on a card
  used to open a one-line box that could only edit the task text — and it
  silently flattened anything you typed onto multiple lines. It now opens a
  dialog holding both the task line and the task's own indented note block,
  so the notes you keep under a task are editable from the board instead of
  only from the note. Saving writes the line and the notes back to the source
  note as a single verified edit: one undo step, and refused outright rather
  than half-applied if the note changed on disk while the dialog was open.
- `Reason for <Column>`, `Status Changed` and `Date Entered` are shown in the
  dialog but not hand-editable — KNote maintains those itself, and a line
  typed into the notes box that looks like one of them is no longer able to
  hijack the real stamp. A `Date Entered` line can no longer be lost when the
  note body around it is rewritten.

## 2.2.2

- Fixed Kanban cards having no way to open their task once **Group by note**
  was ticked — the note name under a card is what opened it, and grouping
  hides that name. Double-clicking a card now opens its note at the task's
  line, on every board (including **Open Board for This Note**, which never
  had a click-through either).

## 2.2.1

- Fixed Gantt bars showing through the Planner's sticky task-name column
  when scrolling horizontally; the column now stays layered above the bars,
  matching the header row.

## 2.2.0

- **Draw.io diagrams**: right-click in Live Preview → **Insert ▸ Draw.io
  Diagram** (or **KNote: Insert Draw.io Diagram** from the Command Palette)
  creates a blank diagram in your attachments folder, embeds it, and opens
  it for editing. It renders inline like any other image and double-clicking
  it in Live Preview reopens it for editing. Diagrams are stored as
  `.drawio.svg`/`.drawio.png` — a real image with the diagram data embedded
  inside — and editing needs the free Draw.io Integration extension
  (`hediet.vscode-drawio`), which KNote offers to install the first time you
  try to edit one; that extension runs fully offline too.
- **Deliverables switch to `@deliverable(project/name)`**: replaces the old
  `#deliverable/project/name` tag, so joining a deliverable no longer
  clutters the Tags sidebar or `#` autocomplete. Notes written with the old
  tag still read fine, but nothing writes it any more.
- **Edit a deliverable from its own note**: right-click a deliverable's task
  line and its **Task ▸** submenu becomes **Deliverable ▸**, with **Set
  start date… / Set due date… / Depends on ▸** alongside the usual tag and
  priority items — the same editing the Planner's right-click menu offers,
  without leaving the note.
- Fixed deliverable tasks appearing on the Kanban board before their
  deliverable had actually started; they now stay hidden until the
  deliverable's window opens, then stay visible for good once it has.
- Fixed a deliverable's own board card not showing a filled "Deliverable"
  badge with member-task progress, and its overdue state not flagging every
  task that joins it — even ones with no due date of their own — once the
  deliverable's end date passes with work still open.
- Fixed dragging a deliverable bar's right edge (or editing its due date)
  not carrying dependent bars along with it, unlike a full-bar drag; edge
  drags on the end date now cascade the same way.

## 2.1.0

- **Code block highlighting**: fenced code blocks are syntax-highlighted in
  both Live Preview and Reading mode/embeds/hover previews, for JS/TS,
  Python, JSON, HTML, CSS, Bash, Markdown, YAML, C/C++, Java, Go, Rust and
  SQL. Right-click → **Insert → Code block** adds an empty fence.
- **Filter the board by project**: the Boards sidebar section gained a
  **Filter by Project** row — All, Unassigned, or one row per project,
  expandable to its individual deliverables. Clicking one opens (or narrows)
  the whole-vault board to just that scope, shown as a chip in the board's
  header with a ✕ to clear it.
- **Hanging indent on wrapped lines**: in Live Preview a long list item or
  task that wraps now tucks its continuation under its own text instead of
  falling back flush-left, so nesting stays readable at any window width.
  Code blocks and tables keep their existing layout.
- Fixed the Planner's today line and milestone diamonds sitting at the start
  edge of their day column instead of centered on it, so they read as
  marking the boundary before the day rather than the day itself.
- Fixed the sidebar's past weekly notes list ordering by last-edited time
  instead of the week each note is actually for, so touching an old weekly
  note bounced it to the top of the list out of chronological order.

## 2.0.0

- **Project Planner**: the Timeline panel is now a Gantt-style project
  planner (**KNote: Open Project Planner**). A note with `type: project`
  frontmatter is a project; its deliverables are top-level tasks carrying a
  `🛫 start 📅 end` span and their own `#deliverable/<project>/<name>` tag.
  The chart draws each deliverable as a bar with a % complete fill,
  milestones as diamonds, and a today line, at day/week/month zoom.
- **Drag to re-plan**: drag a bar to move it — everything that depends on
  it moves by the same number of days, and nothing else does. Drag an edge
  to change one date, or drag the 🔗 grip onto another bar to make it wait
  on this one. A link that would create a loop is refused, and a bar that
  starts before something it depends on finishes is outlined in red.
- **Edit a deliverable without dragging**: right-click it for **Edit dates…**
  (a calendar for both ends, with day-length presets and nudges that slide
  the span without resizing it) or **Depends on ▸**, which lists every other
  deliverable with a tick beside the ones it already waits on — click to add
  or remove. Anything that would create a loop is greyed out.
- **New project**: pick where the note goes by browsing the vault the way
  you would in a file manager — a breadcrumb, one folder level at a time,
  files shown greyed for context, and **New folder here** to make one on
  the spot.
- **Projects have a deadline and a status**: give a project note an
  `end: 2026-06-30` frontmatter date and it's flagged **overdue** in the
  planner and the Projects sidebar once that date passes with work still
  open. Right-click a project to set the date, or to **Mark project
  completed** — a completed project sorts to the bottom, shows a **done**
  badge, and is closed for business: you can't add deliverables, tasks or
  milestones to it, and its `#deliverable/…` tags stop appearing in `#` tag
  autocomplete so nothing new gets filed against it. Reopening restores it.
- **Tasks anywhere can belong to a deliverable**: tag any checkbox line in
  the vault with a deliverable's `#deliverable/…` tag and it joins that
  deliverable — no need to keep project work in the project note.
- **The board now shows only current project work**: a task carrying a
  `#deliverable/…` tag appears on the Kanban board while its deliverable is
  running, or after its end date if it's still unchecked. Untagged tasks
  are unaffected; tick **All deliverables** in the board header to see
  everything.
- The **Projects** activity-bar section replaces Milestones: one row per
  project with its deliverable count and span. **Each has a checkbox that
  decides whether it appears on the Planner chart** — untick the ones you
  aren't working on to clear the view. The choice is saved per vault.
- **The Timeline panel is gone**, replaced by the Planner. **KNote: Open
  Timeline** no longer exists — use **KNote: Open Project Planner**. Notes
  are untouched; dated tasks that weren't deliverables simply no longer have
  a chart of their own.

## 1.9.2

- Fixed a right-click menu (or other popover) that opened near the edge of
  the window from being clamped to the wrong position — it now stays fully
  on screen without shifting away from the point you clicked.

## 1.9.1

- **The editor's right-click menu is grouped into submenus**, the way
  Obsidian's is: Cut/Copy/Paste stay at the top, and everything else opens
  from **Format**, **Insert**, **Task** or **Table** — each shown only when
  the clicked line can use it. Spell suggestions and hyperlink actions stay
  at the top level. A right-click inside a table on a task line used to list
  about 25 items; it now lists seven.
- Fixed the table right-click menu acting on the wrong cell: Insert row
  above/below, Delete row and the column actions all landed on the header row
  and the first column instead of the cell that was clicked. A right-click on a
  table now opens the menu only — it no longer opens that cell for editing.

## 1.9.0

- **Tables are edited by clicking straight into a cell**, the way Obsidian
  does it — the table stays a rendered grid, and you never have to drop into
  raw pipes to enter data. `Tab`/`Shift+Tab` and the arrow keys move between
  cells, `Enter` moves to the cell below (adding a row past the last one),
  `Shift+Enter` inserts a line break, and `Esc` leaves the table.
  `[[link]]`/`#tag` autocomplete and bold/italic shortcuts work inside a
  cell. Pasting tab-separated data fills cells around the caret and grows
  the table to fit. Right-click anywhere for **Insert table…**, or on a cell
  to insert/delete its row or column, or to drop to **Edit table source**
  for the raw Markdown.

## 1.8.1

- Fixed notes being corrupted on save, with characters dropped in scattered
  places throughout the file while the editor itself still showed the text
  correctly. It affected any note using Windows line endings — which is most of
  them — and only when typing directly in the editor; edits made from the board,
  or by ticking a checkbox, were never affected. The editor and the file
  underneath it counted a line ending differently, so each edit was written a
  little further off the mark the further down the note it was. Anything typed
  in a note now lands exactly where it was typed.
- Fixed the editor silently missing a change made to the note from somewhere
  else — a card moved on the board, an undo, or the file changing on disk —
  if it arrived at the same moment you were typing. The editor kept showing the
  old text and drifted out of step with the note from then on.

## 1.8.0

- **Hyperlinks are a real construct now.** `[text](https://…)` links used to
  render with the URL sitting in the middle of your prose and did nothing when
  clicked. They now show as just their link text — hover to see where they
  point, and the raw Markdown reappears when your cursor is on the line, like
  every other construct — and clicking one opens it in your browser. To make
  one, right-click → **Insert link…** and fill in the text and URL (the text
  pre-fills from whatever you had selected, and a bare `example.com` is treated
  as `https://`). Right-click an existing link for **Open link**, **Copy link**
  (the bare URL, ready to paste anywhere), **Edit link…** or **Remove link**,
  which unwraps it back to plain text. Only `http`, `https` and `mailto`
  addresses will open; anything else is refused. `![](image)` embeds are
  untouched, and KNote still makes no network calls of its own — opening a link
  just hands it to your browser.
- **The right-click menu has Cut / Copy / Paste, and icons.** The clipboard
  actions sit at the top of the menu where a native editor puts them — Cut and
  Copy grey out when nothing is selected rather than disappearing, and
  `Ctrl+X`/`C`/`V` keep working as they always did. Every entry in the menu now
  also carries an icon on the left, so you can find the one you want by shape
  instead of reading the whole list.
- Fixed a task's hidden `^anchor` becoming visible once you gave the task a due
  date. Every marker — due date, priority, tag, a sub-task's completion date —
  is written by appending to the line, which pushed the anchor into the middle
  of it. That didn't just look wrong: an anchor that isn't last isn't a block
  anchor, so the task quietly stopped being linkable and existing
  `[[Note#^anchor]]` links to it broke. Markers now go in front of the anchor,
  and notes already affected are repaired the next time the line is written —
  their links resolve and their anchors hide again straight away, without
  waiting for that.

## 1.7.0

- **Waiting tasks now need a follow-up date, and it shows on the board.** Moving
  a card into a require-reason column already asked why; it now also asks *when
  you'll come back to it*, pre-filled a week out. Both fields are mandatory, and
  the date is stamped on the same line as the reason
  (`Reason for Waiting: … ⏳ date`). The card grows an ⏳ chip showing that date,
  coloured on exactly the same scale as due dates — red once you've blown past
  it, yellow on the day, green inside the next week, plain grey beyond — so a
  Waiting card you've quietly stopped chasing turns red instead of sitting there
  looking fine. Hovering the chip gives the distance in words plus the reason.
  Moving the card back out (or archiving it) deletes the reason and its
  follow-up date together, as before. `KNote: Set Task Status` asks for the date
  too, rather than silently assuming today.

## 1.6.0

- **A Waiting reason no longer outlives the Waiting column.** Moving a card into
  a require-reason column still asks why and stamps the
  `Reason for Waiting: … 📅 date` line under the task — but moving it back out
  (or archiving it) now deletes that line in the same edit, instead of leaving a
  stale reason in the note and an hourglass chip on a card that isn't waiting on
  anything any more. Applies wherever the status changes: a board drag, the
  live-preview right-click status menu, and `Ctrl+L`.

## 1.5.0

- **Kanban due dates now colour themselves by urgency.** A card's 📅 chip turns
  red once the task is overdue, yellow on the day it's due, and green when it
  falls inside the next week — anything further out stays plain grey, so the
  colours only fire when something actually needs attention. Hovering the chip
  spells out the distance ("in 4 days", "3 days ago"). Cards in a Done column
  stay grey however overdue they are; finished work shouldn't nag.

## 1.4.0

- **Links to a task now read as the task.** The hidden `^anchor` on a task is
  named after the task itself (`- [ ] Rewire the pump ^rewire-the-pump`)
  instead of a random `^k3f9d1`, so the raw Markdown still makes sense opened
  anywhere else, and **Copy link to task** copies
  `[[Note#^rewire-the-pump|Rewire the pump]]` — which renders as just the
  task's text rather than a cryptic `Note > ^k3f9d1`. Anchors you already have
  keep working exactly as before; nothing is rewritten.
- **Copy a task's link from the Kanban board** — hover a card and click the 🔗
  button. If that task has no anchor yet, one is added to its note first, so
  there's no need to open the note and hunt for it.
- **`[[Note#^` autocomplete shows each anchor's task text**, so you pick the
  task by reading it instead of by recognizing its id — typing the task's own
  words finds it, including for older random anchors — and accepting a
  suggestion writes the aliased `[[Note#^id|Task text]]` form for you.
- Fixed editing a card on the board exposing that task's `^anchor` in the edit
  box, where tidying it away would quietly break every link pointing at the
  task. The anchor is now kept out of the box and reattached on save.

## 1.3.0

- **`![[Another Note]]` embeds that note inline** in Live Preview — an embed
  on its own line renders as a bordered card holding the note's content,
  Obsidian-style. Click the card to open the embedded note (Alt+click to edit
  the raw `![[…]]` instead); `![[Note#Heading]]` embeds one section and
  `![[Note#^task-id]]` a single task with its detail block. Edit the embedded
  note and the card follows along.
- **Hover a `[[wiki link]]` for a preview of its note** — a card shows the
  note's rendered content (about 15 lines' worth); a `[[Note#Heading]]` link
  previews just that section, and a link to a note that doesn't exist yet says
  so.
- **Renaming or moving a note rewrites the `[[links]]` that point at it**
  across the vault — from the Explorer, `F2`, drag-and-drop, anything.
  It's part of the rename's own undo step, so `Ctrl+Z` puts both back;
  renaming a folder updates the links to every note inside it; and your
  writing style is kept (bare names stay bare, paths stay paths, `#headings`,
  `|display text` and the `!` embed prefix survive untouched). Links in code
  blocks and frontmatter are never touched, and neither are links written
  through a note's `aliases:`, since those still resolve. Turn it off in
  **Vault Settings → Links**.
- **Reading mode understands KNote syntax**: VS Code's built-in Markdown
  preview (`Ctrl+Shift+V`) now renders `[[wiki links]]` as real links you can
  click to open the note (unresolved ones show dotted and inert), `#tags` as
  pills, and `![[image]]` embeds inline.
- Fixed a Live Preview tab restored on window reopen coming up with `[[`
  completion, backlinks and the tag list near-empty — views that need the
  whole vault now wait for the index to finish building instead of hydrating
  from an empty one.

## 1.2.0

- **`` ```mermaid `` code blocks render as real diagrams** in Live Preview
  (flowcharts, sequence diagrams, and anything else Mermaid supports); click
  a diagram to drop your cursor in and edit the raw source. Invalid syntax
  shows an inline error instead of breaking the editor.
- **Outline panel moved to the KNote sidebar**: a new **Outline** view sits
  alongside Search/Backlinks/Tags/Properties in the KNote Activity Bar
  container — a heading tree (H1–H6) for the active note, indented by
  level; click a heading to jump the editor there.

## 1.1.0

- **Attachments clean themselves up automatically**: delete the last
  `![[embed]]`/`![](image)` of an image from a note (and save), or delete a
  note that embedded images, and KNote moves the now-orphaned file out of
  the attachments folder to the OS trash / Recycle Bin — never permanently
  deleted, and an image still embedded by any other note is left untouched.
  Also catches edits made outside VS Code (the file watcher). **KNote:
  Clean Up Orphaned Attachments** still exists for a full manual sweep.
- Fixed milestones in the Timeline view showing an **overdue** badge and
  countdown once their date passed — they're now treated like completed
  items, not open tasks.
- Fixed the date picker (tasks, milestones, due dates) applying and closing
  the moment you navigated the native calendar to a different month — it
  now only commits when you pick a quick option or click away.
- Fixed pasting an image (screenshot, copied bitmap) doing nothing in Live
  Preview, the default editor — it only worked in the raw text editor.
  Paste now saves the image to the attachments folder and inserts its embed
  in Live Preview too.

## 1.0.1

- Repo cleanup — no feature changes: built `.vsix` packages are no longer
  committed to git (`.gitignore` now excludes them); use `npm run package`
  to build one locally when you need it

## 1.0.0

- **KNote is now a VS Code extension.** The standalone Electron app is
  retired; your vault is any workspace folder containing `.knote/` (run
  **KNote: Initialize Vault in This Workspace** on a fresh folder). All
  data stays plain Markdown — existing vaults open unchanged.
- **Live Preview is the default editor for every note** — an Obsidian-style
  custom editor that renders Markdown as you type (styled headings/lists/
  quotes/code, pipe tables as real grids) while revealing raw syntax on
  your cursor's line, so you're always editing the plain-text source
  directly; clickable `[[wiki links]]` (create-on-click, `#heading`/
  `#^block`/alias forms), `[[`/`#` autocomplete, link hover previews,
  tag/priority/milestone decorations, paste-image into the attachments
  folder, and bold/italic/strikethrough/inline-code toggles all carry
  over. **KNote: Reopen as Raw Text** drops to the plain text editor when
  you want it; **KNote: Open in Live Preview** switches back
- Each top-level task shows a **status pill** next to its checkbox naming
  its Kanban column, updated live; right-click a checkbox for a quick
  column switcher, or right-click anywhere on a line for a context menu
  (formatting toggles, insert wiki link/checkbox/milestone/machine entry,
  set tag/priority/due date, **copy link to task**)
- **Copy link to task**: every task is auto-anchored the moment its note
  is seeded, so its right-click menu always has a `[[Note#^id]]` link
  ready to copy and click back to — no manual anchoring
- **Offline spell check** in Live Preview — misspelled words get a wavy
  underline; right-click for suggested corrections, **Add to dictionary**
  (per-vault), or **Ignore** (this session)
- Sub-tasks (indented checkboxes) are plain toggles, not Kanban cards —
  clicking one stamps or clears a completion date instead of moving a card
- Task detail blocks and other indented content (sub-tasks, nested lists,
  note bodies) collapse behind a gutter arrow, so a long note reads as a
  clean list of top-level tasks
- The Kanban board, Timeline, Machine Log, Graph, and vault Settings open
  as editor tabs; Search (with `path:`/`tag:`/`file:` operators),
  Backlinks + unlinked mentions, Tags, and Properties live in the new
  KNote Activity Bar container
- Two-way sync got stronger: board/timeline/panel edits land directly in
  your open editor buffer (even with unsaved changes) and fall back to
  verified, conflict-refusing disk writes otherwise
- Task hotkeys: `Ctrl+L` cycles a task's column, `Ctrl+Alt+L` picks one
  (with require-reason prompts and `Status Changed` stamping),
  `Ctrl+Alt+X` toggles a checkbox, `Ctrl+Alt+Enter` seeds a task note
- Everything the app duplicated from VS Code is now native: file explorer,
  tabs/splits, quick switcher, command palette, themes, and full-text
  search
- New **KNote: Clean Up Orphaned Attachments** command
- Dropped: the in-app hotkey editor (use VS Code's native Keyboard
  Shortcuts editor, `Ctrl+K Ctrl+S`) and the "Open in VS Code" bridge
  (you're already here)

## 0.12.0

- The Kanban board's filter bar gained three date filters — **Status
  Changed**, **Date Entered**, and **Due date** — each with an Any / Today /
  This week / specific date / custom range option, alongside the existing
  tag and text filters
- Tasks now carry a `Status Changed` line — seeded as `n/a` when the task's
  note template is created, then updated **in place** (never duplicated) to
  today's date every time the task's Kanban column changes (drag-and-drop or
  the checkbox right-click menu) — a running record of when a task last
  changed state, alongside the existing `Date Entered` (when it was added)
  and `Reason for <Column>` (why/since when, for columns that require one)
- **Right-click date editing**: right-click a task, milestone, or note in
  the Timeline view — or a machine log `🚜` entry, either in the log view
  or inline in a note — to change its date (and, for machine entries, the
  machine) with a calendar picker, instead of hunting it down in the note
- **Hyperlinks**: right-click in the editor and choose "Insert link…" to
  wrap the current selection (or fresh text) into a `[text](url)` Markdown
  link
- **Open vault in VS Code**: a new ribbon button (also in the command
  palette and **Settings → General**) opens the current vault as a VS Code
  workspace, creating a `.code-workspace` file in the vault's hidden
  `.knote` folder the first time
- Context menus (file explorer, editor) now show an icon next to each item
  instead of a plain text label
- Fixed archived tasks showing up as overdue in the Timeline view — they're
  now treated as done, like completed tasks
- Fixed the editor's search/replace panel having unreadable input and
  button styling under some themes

## 0.11.0

- **Tabs**: every note you open becomes a tab above the editor — click to
  switch, middle-click or `×` to close, `Ctrl+Tab` / `Ctrl+Shift+Tab` to
  cycle
- **Split panes**: "Split pane: vertical / horizontal" in the command
  palette opens a second pane with its own tabs and editor; "Close split"
  merges back. The same note open in both panes stays in sync
- **Custom keyboard shortcuts**: new **Settings → Hotkeys** section —
  record a new combination for any command palette entry, with conflict
  detection, unbind, and per-command reset to default
- **Block references**: end a line with ` ^some-id` to anchor it, link to
  it with `[[Note#^some-id]]`; typing `[[Note#^` suggests the note's
  anchors

## 0.10.1

- Internal cleanup & stability pass — no feature changes:
  - Fixed two rare write races that could clobber a note edited outside
    KNote at the exact moment KNote wrote to it (quick capture / board
    "add card" appends, and simultaneous saves of the same file)
  - New test coverage for the code that guards your notes during Kanban
    sync and external-edit detection (36 new tests)
  - Removed dead code, consolidated duplicated UI/parser logic, and added
    ESLint/Prettier with CI enforcement

## 0.10.0

- The `[[` link suggester now chains into a **heading suggester**: picking a
  note leaves the cursor right before the closing `]]`, so typing `#`
  immediately lists that note's headings — pick one to link straight to a
  section (`[[Note Name#Heading]]`) instead of typing the heading by hand

## 0.9.0

- Priority markers now render as **Low / Medium / High** word pills instead
  of plain `!`/`!!`/`!!!` marks, both on Kanban cards and in the editor's
  live-preview pill — clicking into the marker still shows the raw `!`s for
  editing
- Added a **Readable line length** toggle (**Settings → General**, on by
  default) to cap note width to a readable column instead of stretching
  text across the full pane in both the editor and reading view
- Pressing **Enter** to seed a task's note template (`Date Entered`/`Notes`)
  now only applies to top-level tasks — a subtask (indented under a parent
  task) gets normal list continuation instead, since subtasks are usually
  short-lived checklist detail rather than something needing its own note

## 0.8.0

- Added a **graph view** (ribbon button under the machine log, or "Open
  graph view" in the command palette) — an interactive connection map of
  the vault like Obsidian's: every note is a dot, every `[[wiki-link]]` a
  line. Zoom with the scroll wheel, pan and rearrange by dragging, hover
  to spotlight a note's connections, click a note to open it. Unresolved
  links and orphan notes can be toggled on/off, and a filter box
  spotlights notes by name

## 0.7.0

- Pressing **Enter** on a fresh task now seeds its attached note with a
  small template — a `Date Entered` line stamped with today's date and an
  empty `Notes:` line, caret ready to type — instead of a single blank
  indented line
- Weekly note templates support a new `{{weekdays}}` placeholder that
  expands to the seven days of the current week as headings, so a weekly
  note comes prefilled with a dated spot for each day; the starter template
  now uses it
- Added a bundled **GitHub Copilot instructions** doc (**Settings → General**)
  that teaches Copilot KNote's note format — copy it into a vault's
  `.github/copilot-instructions.md` to get correctly-formatted tasks, due
  dates, and wiki-links out of Copilot

## 0.6.0

- Fixed a Kanban board bug where clicking a task's note the first time
  jumped to the top of the note instead of the task's line (a second click
  landed correctly) — the editor was scrolling before it had measured its
  layout on a fresh open
- Fixed selecting/highlighting text so it's actually visible — it was
  hidden behind opaque backgrounds on task lines and code blocks in the
  editor, and could blend into the background in the Kanban board's task
  editor
- Tag and `[[link` suggestions (in the editor and the tag picker popover)
  can now be cycled with `Tab`/`Shift+Tab` and chosen with `Enter`, instead
  of requiring a mouse click
- Priority markers (`!`, `!!`, `!!!`) now render as a colored pill badge in
  the live-preview editor, matching the look of `#tags`, instead of plain
  exclamation marks

## 0.5.0

- A task's attached note (the indented lines under a `- [ ]` checkbox) now
  renders as a bordered, collapsible box in the live-preview editor — click
  the arrow on the task line to fold the note away and back. Every task gets
  the same box outline for a consistent look, even ones with no note to fold

## 0.4.0

- **Outline panel**: the right sidebar now shows a collapsible outline of
  the open note's headings — click one to jump to it
- **Archive all**: the Kanban board's Done column has an "Archive all"
  button to clear out finished cards in one click, instead of archiving
  each one individually
- Wrapped lines in a task's attached note now stay visually indented under
  the note text instead of falling back flush-left
- Every new note is automatically stamped with a `created` date in its
  frontmatter, so notes carry a reliable timestamp even if a sync tool
  later resets the file's modified time
- **Quick capture** (`Ctrl+J`): jot a thought from anywhere, even with no
  note open — it appends a timestamped line to this week's note (creating
  it from your weekly template if needed) and leaves you right where you
  were
- The **Tags** panel has a new **(no tags)** row listing notes you haven't
  tagged yet, for periodically reviewing and processing fleeting captures

## 0.3.0

- Added a project README describing the app and its features on GitHub

## 0.2.0

- Automated build: merging to `main` now runs typecheck/tests and publishes a
  built Windows installer as a GitHub Release

## 0.1.0

Initial feature set:

- Markdown editor with live preview, source, and reading modes
- Kanban board driven by checkbox tasks in notes (tags, due dates, priority,
  archiving), with a dedicated Settings section for columns
- Timeline view for dated tasks, milestones, and notes with a `date:` field
- Weekly notes and note templates with placeholder support
- Full-vault search, quick switcher, tag browser, backlinks/properties panel
- Paste-to-attach images directly into notes
- Machine log for tracking work against registered machines
- Spell check with a personal dictionary
- Version number in the title bar and this release notes viewer
