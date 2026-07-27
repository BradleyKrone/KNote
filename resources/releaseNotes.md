# Release notes

The current version number is shown on the KNote entry in VS Code's
Extensions view.

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
