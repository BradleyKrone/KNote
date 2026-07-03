/** Vault-relative paths use forward slashes, no leading slash: "folder/note.md" */
export type VaultPath = string

export interface VaultInfo {
  /** Absolute path of the vault root on disk */
  root: string
  /** Display name (folder name) */
  name: string
}

export interface FileEntry {
  path: VaultPath
  name: string
  kind: 'file' | 'folder'
  children?: FileEntry[]
}

/**
 * Spellcheck context delivered from the main process on right-click inside the
 * editor. Chromium's spellchecker (native OS checker on Windows) fills these in;
 * misspelledWord is '' when the click wasn't on a flagged word.
 */
export interface SpellContextInfo {
  misspelledWord: string
  dictionarySuggestions: string[]
}

export interface FileReadResult {
  path: VaultPath
  content: string
  mtimeMs: number
}

export interface FileWriteResult {
  mtimeMs: number
}

export type ExternalChangeKind = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'

export interface ExternalChange {
  path: VaultPath
  kind: ExternalChangeKind
}

// ---------- Vault index ----------

export interface HeadingRef {
  text: string
  level: number
  /** 0-based line number */
  line: number
}

export interface LinkRef {
  /** Raw link target as written (no .md extension), e.g. "Note" or "folder/Note" */
  target: string
  /** Optional #Heading or #^block suffix (without the #) */
  heading?: string
  /** Optional |alias display text */
  alias?: string
  embed: boolean
  line: number
  /** Full text of the line containing the link (backlink context snippet) */
  context: string
}

export interface TagRef {
  /** Tag without the # */
  tag: string
  line: number
}

export interface TaskItem {
  line: number
  /** The char inside the brackets: ' ', 'x', '/', ... */
  statusChar: string
  /** Task text after the checkbox */
  text: string
  indent: number
  tags: string[]
  /** Exact full line text, used to verify targeted rewrites */
  rawLine: string
}

export interface MilestoneItem {
  line: number
  /** Milestone text after the 🏁 marker, still carrying any 📅/!!!/#tag markers */
  text: string
  tags: string[]
  /** Exact full line text, used to verify targeted rewrites */
  rawLine: string
}

export interface NoteMeta {
  path: VaultPath
  /** File name without .md */
  title: string
  aliases: string[]
  frontmatter: Record<string, unknown>
  frontmatterError: boolean
  headings: HeadingRef[]
  links: LinkRef[]
  tags: TagRef[]
  tasks: TaskItem[]
  milestones: MilestoneItem[]
  mtimeMs: number
}

export interface IndexDelta {
  path: VaultPath
  /** null = note removed */
  meta: NoteMeta | null
}

export interface SearchResult {
  path: VaultPath
  title: string
  score: number
  snippet: { line: number; text: string } | null
}

export interface Mention {
  path: VaultPath
  line: number
  /** Full line text */
  text: string
  /** Column range of the matched string within the line */
  col: number
  length: number
  /** Which of the searched strings matched */
  matched: string
}

export type ThemeName = 'light' | 'dark'

export interface AppSettings {
  lastVault: string | null
  theme: ThemeName
}

// ---------- Per-vault configuration (.knote/config.json) ----------

export interface BoardColumn {
  name: string
  /** The checkbox status char that maps to this column (' ', '/', 'x', ...) */
  char: string
}

export interface VaultConfig {
  weeklyFolder: string
  /** dayjs format string (with isoWeek tokens) for weekly note file names */
  weeklyFormat: string
  /** Vault path of the template note used for new weekly notes ('' = none) */
  weeklyTemplate: string
  templatesFolder: string
  /** Note that receives cards created on the global board */
  inboxNote: string
  /** Vault-relative folder pasted/dropped images are saved into */
  attachmentsFolder: string
  columns: BoardColumn[]
}

export const DEFAULT_VAULT_CONFIG: VaultConfig = {
  weeklyFolder: 'Weekly',
  weeklyFormat: 'GGGG-[W]WW',
  weeklyTemplate: '',
  templatesFolder: 'Templates',
  inboxNote: 'Inbox.md',
  attachmentsFolder: 'Attachments',
  columns: [
    { name: 'To Do', char: ' ' },
    { name: 'Ready to Work', char: 'r' },
    { name: 'In Progress', char: '/' },
    { name: 'Done', char: 'x' }
  ]
}
