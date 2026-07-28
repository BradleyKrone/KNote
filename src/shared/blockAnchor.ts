// Block anchors — the ` ^id` suffix that makes a single line (a task, a
// milestone, a paragraph) linkable as `[[Note#^id]]`.
//
// Anchors used to be opaque random base36 ("^k3f9d1"), minted only inside the
// live-preview editor. They're now slugs derived from the line's own prose
// ("^rewire-the-pump-controller"), so the raw Markdown stays readable outside
// KNote and the `[[Note#^` completion popup is something a human can scan.
// Pre-existing random anchors still resolve untouched — nothing migrates.
//
// Pure TS (no CodeMirror, DOM, vscode or host imports), because all three
// layers need it: the editor webview mints anchors, the board webview mints
// them through a verified edit, and both completion providers render them.

import { BLOCK_ID_RE, MILESTONE_LINE_RE, stripInlineMarkers, TASK_LINE_RE } from './parser/patterns'

/** Longest slug we'll mint. Long enough to stay recognizable, short enough not to bloat the line. */
const MAX_SLUG_LEN = 48
/** Longest auto-alias we'll put in a link, so a wordy task doesn't swamp the sentence around it. */
const MAX_ALIAS_LEN = 60

/** The existing `^block-id` anchor on a line, or null if it has none. */
export function blockIdOf(lineText: string): string | null {
  return BLOCK_ID_RE.exec(lineText)?.[1] ?? null
}

/**
 * The prose of an anchorable line: the text after a `- [ ]` checkbox or a `🏁`
 * milestone marker (the whole line for anything else), with tags, due dates,
 * priority markers and any existing `^anchor` stripped off.
 *
 * Shared by the slug generator, the auto-alias, and the parser's BlockRef.text
 * so a completion label and the id it inserts always describe the same text.
 */
export function anchorText(lineText: string): string {
  const clean = lineText.replace(/\r$/, '')
  const body = TASK_LINE_RE.exec(clean)?.[4] ?? MILESTONE_LINE_RE.exec(clean)?.[1] ?? clean
  return stripInlineMarkers(body)
}

/** Cut at a word boundary so a truncated slug/alias never ends mid-word. */
function cut(text: string, max: number, sep: string): string {
  if (text.length <= max) return text
  const head = text.slice(0, max)
  const lastSep = head.lastIndexOf(sep)
  return lastSep > 0 ? head.slice(0, lastSep) : head
}

/**
 * A readable, URL-safe block id built from a line's prose — matching
 * BLOCK_ID_RE's `[A-Za-z0-9_-]` grammar by construction. Returns `''` when
 * nothing usable survives (an all-emoji or all-punctuation line), leaving the
 * caller to fall back to a random id.
 */
export function slugifyBlockId(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
  return cut(slug, MAX_SLUG_LEN, '-').replace(/-$/, '')
}

/** A short random id, the fallback when a line's prose yields no usable slug. */
export function generateBlockId(): string {
  return Math.random().toString(36).slice(2, 8)
}

/**
 * Mint a block id for `lineText` that doesn't collide with `taken` (the ids
 * already used in the same note). Duplicates get a `-2`, `-3`, … suffix —
 * without this, two identically-worded tasks would both answer to the same
 * `[[Note#^id]]` and `sectionLine`/`sliceEmbedSection` would silently resolve
 * to whichever came first.
 */
export function makeBlockId(lineText: string, taken: Iterable<string> = []): string {
  const used = new Set([...taken].map((id) => id.toLowerCase()))
  const base = slugifyBlockId(anchorText(lineText)) || generateBlockId()
  if (!used.has(base.toLowerCase())) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!used.has(candidate.toLowerCase())) return candidate
  }
}

/**
 * Append ` ^id` to a line, trimming any trailing whitespace (and a stray `\r`
 * from a CRLF file) first so the anchor really does land at end-of-line where
 * BLOCK_ID_RE can find it.
 */
export function anchorLine(lineText: string, id: string): string {
  return lineText.replace(/\s+$/, '') + ` ^${id}`
}

/**
 * A line without its trailing `^anchor`. For anywhere a task's text is put in
 * front of the user to edit — the anchor is link plumbing, and someone tidying
 * it out of an edit box would silently break every link pointing at that task.
 */
export function withoutAnchor(lineText: string): string {
  // `$2` keeps any markers that had been appended after the anchor (see
  // BLOCK_ID_RE) — dropping the anchor must not drop the task's due date too.
  return lineText.replace(BLOCK_ID_RE, '$2').replace(/\s+$/, '')
}

/**
 * Display text for a link to this line: its prose, scrubbed of the characters
 * WIKI_LINK_RE's alias group can't hold (`[`, `]`, `|`) and capped in length.
 */
export function linkAlias(lineText: string): string {
  const alias = anchorText(lineText)
    .replace(/[[\]|]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return cut(alias, MAX_ALIAS_LEN, ' ').trim()
}

/**
 * The wiki link that targets a block anchor. With an alias it renders as the
 * task's own text (`[[Note#^id|Rewire the pump]]` → "Rewire the pump") instead
 * of the useless `Note > ^k3f9d1`.
 */
export function blockLink(noteTitle: string, id: string, alias?: string): string {
  return `[[${noteTitle}#^${id}${alias ? `|${alias}` : ''}]]`
}
