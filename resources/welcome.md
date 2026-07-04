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

Board getting cluttered with finished work? Click a card's **archive**
button to strike it through in the note (`- [a] ...`) and drop it off the
board — nothing is deleted, and un-archiving is as simple as editing the
`a` back to a space, `x`, or `/`.

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
- The **Tags** panel (sidebar) browses every tag in the vault.
- The right panel (toggle from the command palette) shows **backlinks**
  and **properties** (frontmatter) for the open note.

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
machine work" inserts a dated entry tied to a machine at your cursor, and
"Open machine log" gives you a filterable, searchable view of every
logged entry across the vault, grouped by machine.

## Vaults & appearance

- Switch or open another vault from the ribbon or command palette
  ("Open another vault…"). A vault is just a folder — open as many as
  you like, one at a time.
- Toggle light/dark theme from the command palette.
- Everything above (and more) is reachable from the **command palette**
  (`Ctrl+P`) — it's the fastest way to discover features.

## Settings

Open **Settings** from the toolbar or command palette to configure weekly
notes, templates, attachments folder, Kanban columns, and registered
machines. This guide is always the first item there if you want to come
back to it.

## Version & release notes

The current app version is shown in the window's title bar (next to
"KNote") and in the top-right of the **Settings** dialog. **Settings →
Release notes** shows what changed in each version — bundled with the app
itself, like this guide.
