# Using GitHub Copilot with a KNote vault

You are helping the user write and organize notes in a **KNote vault**. KNote
is a local, offline note-taking desktop app (like Obsidian, plus a built-in
Kanban board driven by checkboxes). This file teaches you the exact Markdown
conventions KNote understands so that anything you create or edit works
correctly inside the app.

> **For the user:** Save this file as `.github/copilot-instructions.md` in the
> root of your vault folder, then open that folder in VS Code. GitHub Copilot
> reads it automatically — there is nothing else to configure. See the
> "How to install this" section at the bottom.

## Ground rules

- **A vault is just a folder of Markdown files.** Every note is a plain
  UTF-8 `.md` file. There is no database and no proprietary format — what you
  write on disk is exactly what KNote reads.
- **Stay 100% offline.** KNote never makes network calls. Do not add remote
  images, CDN links, tracking pixels, or anything that fetches from the
  internet. External `[text](https://…)` links are allowed in note text but
  KNote won't open them — keep them as reference only.
- **Keep it plain Markdown.** Every KNote feature below is expressed in
  ordinary Markdown so notes stay readable in any editor. Never invent
  proprietary syntax; use only the conventions documented here.
- **Preserve existing content when editing.** When asked to change one line
  (e.g. a task's status), rewrite only that line and leave the rest of the
  note — spacing, frontmatter, other tasks — untouched.

## Frontmatter (note properties)

Notes may start with a YAML frontmatter block. KNote auto-stamps a `created`
date on new notes. Use frontmatter for structured metadata:

```markdown
---
created: 2026-07-07
tags:
  - project/knote
  - reference
aliases:
  - Alternate Name
date: 2026-07-15
---
```

- `tags:` — a YAML list of tags (same tags you'd write inline as `#tag`).
- `aliases:` — alternate names the note can be linked to / found by.
- `date:` — makes the note appear on KNote's **Timeline** on that day.
- You may add any custom fields; KNote shows them in the Properties panel.

## Tasks and the Kanban board

Any checkbox line, in **any** note, automatically becomes a card on KNote's
Kanban board. The character inside the brackets is the task's **status /
board column** — not just done vs. not done:

```markdown
- [ ] A To Do task
- [r] A task that's Ready to Work
- [w] A task that's Waiting on something
- [/] An In Progress task
- [x] A Done task
```

Default status characters (configurable by the user in **Settings → Kanban
board**, so confirm if unsure):

| Char  | Column        |
|-------|---------------|
| space | To Do         |
| `r`   | Ready to Work |
| `w`   | Waiting       |
| `/`   | In Progress   |
| `x`   | Done          |
| `a`   | Archived (hidden from the board, struck through in the note) |

To move a task to another column, rewrite just the bracket character on that
line — e.g. change `- [ ]` to `- [/]`. Do not touch the task text or other
lines.

### Task metadata (shown on the card)

Add any of these inline on the task line:

- **Tags:** `#project/knote`, `#urgent` — nested tags use `/`.
- **Due date:** `📅 2026-07-15` **or** `@due(2026-07-15)` (ISO `YYYY-MM-DD`).
- **Priority:** `!` (low), `!!` (medium), `!!!` (high) — must stand alone
  surrounded by spaces.

```markdown
- [/] Ship the release notes #project/knote 📅 2026-07-15 !!
```

### Subtasks

Indent a checkbox under another checkbox to make it a subtask. Only the
top-level task gets a board card — subtasks keep the parent uncluttered:

```markdown
- [ ] Main task
  - [ ] First step
  - [ ] Second step
```

### Attached notes on a task

A plain (non-checkbox) indented line under a task is treated as that task's
**attached note** and renders as a boxed note under the card in the editor:

```markdown
- [ ] Call the vendor
    Notes: they only answer mornings
    - a plain bullet works here too
```

### "Waiting" tasks need a reason

The **Waiting** column requires a reason. When you set a task to `- [w]`, add
an indented reason line directly under it in this exact format
(`Reason for <Column>: <text> 📅 <date>`):

```markdown
- [w] Order the replacement part
  Reason for Waiting: Vendor quoted 2 weeks 📅 2026-07-15
```

## Links and embeds

KNote uses Obsidian-style wiki-links:

| Syntax | Meaning |
|---|---|
| `[[Note Name]]` | Link to another note |
| `[[Note Name#Heading]]` | Link to a heading in that note |
| `[[Note Name\|Display text]]` | Link with custom display text |
| `![[Note Name]]` | Embed (transclude) another note inline |
| `![[image.png]]` | Embed an image from the Attachments folder |

Use `[[wiki-links]]` (not `[text](note.md)` paths) to connect notes — that's
what powers backlinks. Pasting an image into KNote saves it to the
Attachments folder and inserts the `![[…]]` embed automatically, so you
rarely need to write image embeds by hand.

## Timeline entries

- **Milestones:** a line starting with `🏁` is a dated timeline marker. It is
  deliberately *not* a checkbox, so it never becomes a Kanban card:

  ```markdown
  🏁 Project kickoff 📅 2026-07-10
  ```

- Any task with a `📅`/`@due` date and any note with a `date:` frontmatter
  field also appear on the Timeline automatically.

## Machine work log (optional feature)

If the user tracks work against specific machines, a log entry starts with
`🚜` followed by the machine's serial/identifier, then the activity. Like
milestones, it is not a checkbox:

```markdown
🚜 SN12345 Replaced power supply #repair 📅 2026-07-07
  Base Machine Software:
  Testing Software:
  Notes:
```

## Weekly notes & templates

- **Weekly notes** live in a configured folder (default `Weekly/`) with a
  date-based filename. The same note is used all week.
- **Templates** live in `Knote Resources/Templates/` by default. When writing
  a template, you may use these placeholders, which KNote fills in on insert:
  `{{date}}`, `{{time}}`, `{{title}}`.
- App-managed files (templates, pasted attachments) live under
  `Knote Resources/` by default to keep them out of the way — avoid putting
  the user's real notes there.

## Standard Markdown

Everything else is ordinary Markdown and works as expected: `#`/`##`/`###`
headings, `**bold**`, `*italic*`, `~~strikethrough~~`, `` `inline code` ``,
fenced code blocks with language hints, `>` blockquotes, `-`/`*` bullets,
`1.` ordered lists, tables, and `---` horizontal rules.

## Quick reference — what to generate

When the user asks you to…

- **Add a task / to-do** → write a `- [ ]` checkbox line, with tags, `📅`
  due date, and `!`/`!!`/`!!!` priority if they gave any.
- **Mark something done / in progress / waiting** → rewrite only that line's
  bracket char (`x` / `/` / `w`), adding a Waiting reason line if it's `w`.
- **Link notes** → use `[[Note Name]]`.
- **Add a project milestone / deadline marker** → use a `🏁 … 📅 date` line.
- **Tag a note** → add `#tag` inline or a `tags:` list in frontmatter.
- **Make a new note** → plain `.md` with optional frontmatter; put tasks,
  links, and headings in the body.

---

## How to install this (for the vault owner)

1. In your vault folder, create a folder named `.github` if it doesn't exist.
2. Put this file inside it as `.github/copilot-instructions.md`.
3. Open the vault folder in VS Code (**File → Open Folder…**).

GitHub Copilot Chat automatically loads `.github/copilot-instructions.md` for
every request in that workspace — no settings to change. From then on, Copilot
knows KNote's task syntax, Kanban statuses, wiki-links, and the rest.

To confirm it's active, open Copilot Chat and ask something like
*"add a high-priority task to call the vendor, due next Friday"* — you should
get back a `- [ ] … 📅 … !!!` line rather than a generic checkbox.
