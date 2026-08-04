// Language table for fenced code blocks in the live-preview editor. Statically
// imports one CodeMirror language package per supported language (instead of
// `@codemirror/language-data`'s lazy-loaded catalog) because the webview build
// is a single `iife` bundle with no code-splitting — a dynamic `import()`
// reachable from that bundle gets statically inlined anyway, so lazy loading
// would just pull in every `@codemirror/lang-*` package instead of the dozen
// actually supported.

import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { json } from '@codemirror/lang-json'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { cpp } from '@codemirror/lang-cpp'
import { java } from '@codemirror/lang-java'
import { rust } from '@codemirror/lang-rust'
import { sql } from '@codemirror/lang-sql'
import { yaml } from '@codemirror/lang-yaml'
import { go } from '@codemirror/lang-go'
import { markdown } from '@codemirror/lang-markdown'
import { StreamLanguage, type Language } from '@codemirror/language'
import { shell } from '@codemirror/legacy-modes/mode/shell'

const bash = StreamLanguage.define(shell as Parameters<typeof StreamLanguage.define>[0])

/** Canonical language name → CodeMirror `Language` factory (extracted from each package's `LanguageSupport`). */
const LANGUAGES: Record<string, () => Language> = {
  javascript: () => javascript({ jsx: true, typescript: false }).language,
  typescript: () => javascript({ jsx: true, typescript: true }).language,
  python: () => python().language,
  json: () => json().language,
  html: () => html().language,
  css: () => css().language,
  cpp: () => cpp().language,
  java: () => java().language,
  rust: () => rust().language,
  sql: () => sql().language,
  yaml: () => yaml().language,
  go: () => go().language,
  markdown: () => markdown().language,
  bash: () => bash
}

/** Fence info-string aliases → the canonical language key in LANGUAGES. */
const ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  htm: 'html',
  yml: 'yaml',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  c: 'cpp',
  h: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cxx: 'cpp',
  md: 'markdown'
}

/** Resolve a fence info-string language token to its canonical language key, or null when unsupported. */
export function resolveCodeLanguage(lang: string): string | null {
  const key = lang.trim().toLowerCase()
  if (key === '') return null
  if (key in LANGUAGES) return key
  return ALIASES[key] ?? null
}

/** CodeMirror language for a fence info-string, or null when unsupported. Passed as `codeLanguages` to `markdown()`. */
export function codeLanguageFor(info: string): Language | null {
  // The info string may carry more than the language token (e.g. a filename);
  // CommonMark takes only the first whitespace-delimited word.
  const key = resolveCodeLanguage(info.trim().split(/\s+/)[0] ?? '')
  return key ? LANGUAGES[key]() : null
}
