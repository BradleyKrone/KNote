# Welcome to KNote

KNote is a local-first, plain-Markdown notes app with a Kanban board and a
timeline built in. Everything you write is a `.md` file on disk in your
**vault** (a folder you choose) — no proprietary format, no account, no
network calls of any kind.

This guide is bundled with the app itself, not stored in your vault — it
won't show up in your file explorer or search results. Reopen it any time
from **Settings → Welcome & feature guide**.

## The command palette

`Ctrl+P` opens the **command palette** — the fastest way to reach every
feature in KNote by name (search, board, timeline, settings, formatting,
mode switches, and more). Skim it once and you'll rarely need a menu.

## Editing modes

Switch between them from the command palette (`Ctrl+P`) or the mode
buttons in the toolbar:

- **Live preview** — Markdown renders inline as you type (bold, links,
  checkboxes) while staying editable, like Obsidian.
- **Source mode** — raw Markdown text, no rendering.
- **Reading mode** (`Ctrl+E`) — fully rendered, read-only view. Press
  `Ctrl+E` again to jump back to live preview.

## Formatting

Select text and use these hotkeys (or the formatting toolbar above the
editor) — they toggle the markers on/off, and with no selection they act
on the word under the cursor:

| Hotkey | Effect |
|---|---|
| `Ctrl+B` | Bold |
| `Ctrl+I` | Italic |
| `Ctrl+Shift+X` | Strikethrough |
| `` Ctrl+` `` | Inline code |

Standard Markdown also works as you'd expect: `#` headings, `> ` quotes,
` ``` ` fenced code blocks, `1.` ordered lists, and `-`/`*` bullets.
Right-click a misspelled word (red squiggle) for spelling suggestions and
"Add to dictionary."

## Keyboard shortcuts

| Hotkey | Effect |
|---|---|
| `Ctrl+P` | Command palette |
| `Ctrl+O` | Quick switcher |
| `Ctrl+N` | New note |
| `Ctrl+J` | Quick capture |
| `Ctrl+E` | Toggle reading mode |
| `Ctrl+B` / `Ctrl+I` / `Ctrl+Shift+X` / `` Ctrl+` `` | Bold / italic / strikethrough / code |

## Tasks and the Kanban board

Any line written as a checkbox becomes a task:

```
- [ ] An open task
- [x] A completed task
- [/] An in-progress task
```

The character inside the brackets is a **status**, not just done/undone —
`x` = Done, `/` = In Progress, and a space = To Do by default. You can add
your own custom statuses and column names in **Settings → Kanban board**.

Open the board with the command palette ("Open Kanban board (all notes)")
to see every task across the vault as cards grouped by column, or "Open
Kanban board for current note" to scope it to just the open file. Drag
cards between columns to change their status — it rewrites the checkbox
character right back in the source file. Cards can carry:

- **Tags** — `#project/knote`
- **Due dates** — `📅 2026-07-15` or `@due(2026-07-15)`
- **Priority** — `!`, `!!`, or `!!!`

New cards added from the global board land in your configured **Inbox**
note (default `Inbox.md`, changeable in **Settings**).

Columns can be marked **Require reason** in **Settings → Kanban board** —
moving a task into one of these (drag-and-drop, the checkbox right-click
menu, or adding a card straight into the column) pops a dialog asking why
and since when, and won't let the move through without both. The answer is
written as an indented line right under the task:

```
- [w] Waiting on vendor reply
  Reason for Waiting: Vendor quoted 2 weeks for the part 📅 2026-07-15
```

and shown on the card as a small badge (hover it to read the reason) —
handy for a **Waiting** column, so you're never left wondering why
something got parked there. It's on by default for the **Waiting** column.

Board getting cluttered with finished work? Click a card's **archive**
button to strike it through in the note (`- [a] ...`) and drop it off the
board — nothing is deleted, and un-archiving is as simple as editing the
`a` back to a space, `x`, or `/`. The **Done** column's header has an
**Archive all** button to clear out finished cards in one click, instead of
archiving each one individually.

Indent a checkbox under another one to make it a **subtask**:

```
- [ ] Main task
  - [ ] Subtask
```

Subtasks still work as normal checkboxes in the editor, but they never get
their own card — only the top-level task shows on the Kanban board, so
breaking work into steps doesn't clutter it up.

Plain (non-checkbox) indented lines under a task are treated as that task's
**attached note** instead, and render as a bordered box right under it in
the live-preview editor:

```
- [ ] Main task
    a note about the task, wrapped and indented under it
    - can include plain bullets too
```

Click the arrow on the task line to fold the note away, or unfold it again —
the task itself always stays visible, box and all, whether or not it has a
note to expand.

Press **Enter** at the end of a task line to start typing its note right
away — the new line is indented automatically instead of starting another
`- [ ]` task.

## Timeline

"Open timeline" in the command palette shows every dated task (`📅`/`@due`),
every `🏁` milestone, and every note with a `date:` frontmatter field, laid
out chronologically with a marker for **today** — a quick way to see
what's coming up across the whole vault. Use "Insert timeline milestone"
(or "…important milestone" for one marked `!!!`) to drop a `🏁` marker with
today's date at your cursor.

## Weekly notes & templates

- **Open this week's note** creates/opens a note named from your
  configured week format (default `Weekly/GGGG-[W]WW.md`, e.g.
  `Weekly/2026-W27.md`), optionally stamped from a template. The same note
  opens all week — no more starting a fresh page every day.
- **Insert template…** drops a template's contents at your cursor.
- **Quick capture** (`Ctrl+J`) — jot a thought from anywhere, even with no
  note open. It appends a timestamped line to this week's note (creating
  it from your weekly template if it doesn't exist yet) and leaves you
  right where you were — no navigating away to write it down.

Every new note is automatically stamped with a `created` date in its
frontmatter, so notes carry a reliable timestamp even if a sync tool later
resets the file's modified time.

Templates support placeholders: `{{date}}`, `{{time}}`, `{{title}}`.
Configure the weekly note folder/format/template and the templates folder
in **Settings**. A brand-new vault (or any vault whose configured
templates folder doesn't exist yet) is seeded with a starter `Note
Template.md` — edit or delete it freely, it's a normal note. If the
**Template note** setting for weekly notes is still empty at that point, it's
automatically pointed at this starter note too, so weekly notes have a
template from the start.

By default, templates and attachments live under a shared **`Knote Resources/`**
folder (`Knote Resources/Templates`, `Knote Resources/Attachments`) to keep
app-managed files out of the way of your actual notes. Both folders are
configurable independently in **Settings** and can point anywhere in the
vault, nested or not.

## Finding things

- `Ctrl+O` — **Quick switcher**: jump to any note by name.
- **Search in all files** (command palette) — full-vault text search.
- The **Tags** panel (sidebar) browses every tag in the vault. A
  **(no tags)** row at the top lists notes you haven't tagged yet — a
  quick way to periodically review and process fleeting captures.
- The right panel (toggle from the command palette) shows an **outline**
  (click a heading to jump to it, collapsible), **backlinks**, and
  **properties** (frontmatter) for the open note.

## Links, images, and embeds

Wiki-links work like `[[Note Name]]`, `[[Note Name#Heading]]`,
`[[Note Name|display text]]`, and `![[Note Name]]` to embed a note's
content inline. Regular Markdown links (`[text](url)`) work too, though
external links stay inert — KNote makes no network calls, ever.

Paste an image (e.g. a screenshot) directly into the editor and KNote
saves it into your configured **Attachments** folder and inserts an
embed automatically — no manual file handling needed.

## Machine log

If you track work against specific machines (serial number, model,
config attributes), register them in **Settings → Machines**. "Log
machine work" inserts a dated entry tied to a machine at your cursor,
followed by a blank **Base Machine Software / Testing Software / Notes**
template so you can fill in details right below it, and "Open machine
log" gives you a filterable, searchable view of every logged entry
across the vault, grouped by machine — registered models are listed
first in the filter list, ahead of config attributes and inline tags.

## Vaults & appearance

- Switch or open another vault from the ribbon or command palette
  ("Open another vault…"). A vault is just a folder — open as many as
  you like, one at a time.
- Toggle light/dark theme from the command palette.
- Everything above (and more) is reachable from the **command palette**
  (`Ctrl+P`) — it's the fastest way to discover features.

## Settings

Open **Settings** from the toolbar or command palette. It's laid out like
Obsidian's — a category list on the left (General, Weekly notes,
Templates, Attachments, Kanban board, Machines) and that category's
options on the right. This guide is always reachable from **Settings →
General**.

## Version & release notes

The current app version is shown in the window's title bar (next to
"KNote") and on the **Settings → General** page. **Settings → General →
Release notes** shows what changed in each version — bundled with the app
itself, like this guide.
