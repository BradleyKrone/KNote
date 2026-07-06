# Release notes

Reopen this any time from **Settings → Release notes**. The current version
number is shown in the window's title bar, next to "KNote".

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
