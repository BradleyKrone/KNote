/**
 * Regexes shared by the indexer (parseNote) and the editor decorations.
 * Kept dependency-free so the renderer can import them without pulling in
 * the remark toolchain.
 */

/** [[target]], [[target#heading]], [[target|alias]], ![[embed]] */
export const WIKI_LINK_RE = /(!?)\[\[([^[\]|#\n]+)(#[^[\]|\n]+)?(\|[^[\]\n]+)?\]\]/g

/** #tag — must follow start-of-line/whitespace/bracket; purely numeric tags excluded by callers */
export const TAG_RE = /(^|[\s([{])#([A-Za-z0-9_][A-Za-z0-9_/-]*)/g

/** - [x] task line (any single status char inside the brackets) */
export const TASK_LINE_RE = /^(\s*)([-*+]|\d+[.)])\s\[(.)\](?:\s(.*))?$/

/** @due(2026-07-10) or 📅 2026-07-10 */
export const DUE_RE = /(?:@due\((\d{4}-\d{2}-\d{2})\)|📅\s*(\d{4}-\d{2}-\d{2}))/

/** !, !!, or !!! priority marker — must stand alone (whitespace/line boundaries) */
export const PRIORITY_RE = /(?:^|\s)(!{1,3})(?=\s|$)/
