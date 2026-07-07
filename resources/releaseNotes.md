# Release notes

Reopen this any time from **Settings → Release notes**. The current version
number is shown in the window's title bar, next to "KNote".

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
