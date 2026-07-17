// Pure helpers for "Copy link to task" — no CodeMirror, DOM, or host imports,
// so they're unit-testable under vitest and shared by taskLink.ts.

import { BLOCK_ID_RE } from '@shared/parser/patterns'

/** The existing `^block-id` anchor on a line, or null if it has none. */
export function blockIdOf(lineText: string): string | null {
  return BLOCK_ID_RE.exec(lineText)?.[1] ?? null
}

/** A short, URL-safe block id (letters/digits), like Obsidian's `^a1b2c3`. */
export function generateBlockId(): string {
  return Math.random().toString(36).slice(2, 8)
}

/** The wiki link that targets a block anchor: `[[Title#^id]]`. */
export function blockLink(noteTitle: string, id: string): string {
  return `[[${noteTitle}#^${id}]]`
}
