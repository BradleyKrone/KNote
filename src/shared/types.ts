// The shared data model: every type that crosses the main/preload/renderer
// boundary lives here.

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

export interface FileReadResult {
  path: VaultPath
  content: string
  mtimeMs: number
}

export interface FileWriteResult {
  mtimeMs: number
}

/**
 * The note text an `![[embed]]` (or a link hover preview) should display —
 * already narrowed to the requested `#Heading` / `#^block` section. `path` is
 * the resolved note, so the caller can resolve that note's own relative image
 * embeds and open it on click.
 */
export interface EmbedNote {
  path: VaultPath
  title: string
  content: string
  /**
   * 0-based line the `#Heading` / `#^block` section starts on, so opening the
   * note from an embed or hover preview lands on the part that was shown.
   * Undefined for a whole-note target.
   */
  line?: number
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
  /** Nested under a less-indented task above it — a subtask, kept off the Kanban board */
  isSubtask: boolean
  tags: string[]
  /** Exact full line text, used to verify targeted rewrites */
  rawLine: string
  /**
   * Follow-up date (YYYY-MM-DD) from an attached
   * `Reason for <Column>: ... ⏳ <date>` note line, if present — when to come
   * back to the task. Cleared with the reason when the task leaves the column.
   */
  waitingFollowUp: string | null
  /** Reason text from an attached `Reason for <Column>: ...` note line, if present */
  waitingReason: string | null
  /** Date (M/D/YYYY) from an attached `Status Changed: <date>` note line; null if unset (`n/a`) or absent */
  statusChanged: string | null
  /** Date (M/D/YYYY) from an attached `Date Entered: <date>` note line, if present */
  dateEntered: string | null
  /**
   * The task's whole attached block, verbatim and still indented: everything
   * nested under it — its notes, its sub-tasks, their notes, nested bullets,
   * tables, fenced code — minus this task's *own* auto-managed `Reason for` /
   * `Status Changed` / `Date Entered` lines, which are surfaced as the fields
   * above instead. A descendant's managed lines stay in here: they belong to
   * the sub-task, not to this one. See `taskBlockLines`.
   *
   * Always empty for a subtask. Only top-level tasks become board cards, and
   * only a card gets the task editor — filling this in at every level would
   * store the same text once per level of nesting in the index.
   */
  blockLines: string[]
}

export interface MilestoneItem {
  line: number
  /** Milestone text after the 🏁 marker, still carrying any 📅/!!!/#tag markers */
  text: string
  tags: string[]
  /** Exact full line text, used to verify targeted rewrites */
  rawLine: string
}

/** A 🚜 machine work-log entry: a dated record of work done on one machine. */
export interface MachineLogItem {
  line: number
  /** Serial number identifying the machine (first token after the 🚜 marker) */
  serial: string
  /** Activity text after the serial, still carrying any 📅/#tag markers */
  text: string
  tags: string[]
  /** Exact full line text, used to verify targeted rewrites */
  rawLine: string
}

/** A registered machine: maps a serial number to its configuration. Defined in Settings, not parsed from notes. */
export interface MachineDef {
  serial: string
  /** Model, e.g. "D6" ('' if none given) */
  model: string
  /** Config attributes, e.g. ["LGP", "VP", "EX"] */
  attributes: string[]
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
  machineLog: MachineLogItem[]
  /** ^block-id anchors, for [[Note#^id]] block references. */
  blockIds: BlockRef[]
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

/** A `^block-id` anchor at the end of a line, targetable via [[Note#^id]]. */
export interface BlockRef {
  id: string
  /** 0-based line of the anchored block. */
  line: number
  /**
   * The anchored line's prose — checkbox/🏁 prefix and inline markers stripped
   * (see `anchorText`). What the `[[Note#^` completion shows, so an anchor can
   * be picked by reading the task rather than by recognizing its id.
   */
  text: string
}

// ---------- Per-vault configuration (.knote/config.json) ----------

export interface BoardColumn {
  name: string
  /** The checkbox status char that maps to this column (' ', '/', 'x', ...) */
  char: string
  /** Moving a card into this column prompts for a required reason + follow-up date (⏳), e.g. Waiting */
  requireReason?: boolean
}

export interface VaultConfig {
  weeklyFolder: string
  /** dayjs format string applied to the Monday of the week for weekly note file names */
  weeklyFormat: string
  /** Vault path of the template note used for new weekly notes ('' = none) */
  weeklyTemplate: string
  templatesFolder: string
  /** Vault-relative folder pasted/dropped images are saved into */
  attachmentsFolder: string
  columns: BoardColumn[]
  /** Registered machines for the Machine Log (serial → model + config attributes) */
  machines: MachineDef[]
  /** Tags hidden from the Tag pane and #-picker's quick-access lists, but left intact in notes */
  deprecatedTags: string[]
  /** Words added to the personal spell-check dictionary (never flagged as misspelled) */
  userDictionary: string[]
  /**
   * Whether renaming/moving a note rewrites the `[[wiki links]]` that point at
   * it across the vault (Obsidian's "automatically update internal links").
   * 'never' leaves links exactly as written, so they dangle after a rename.
   */
  linkUpdate: 'always' | 'never'
  /**
   * Project slugs unticked in the Projects sidebar, hidden from the Planner
   * chart. Stored as the *hidden* set rather than the visible one so a project
   * you create later shows up on its own instead of staying invisible until
   * someone remembers to tick it.
   */
  hiddenProjects: string[]
}

export const DEFAULT_VAULT_CONFIG: VaultConfig = {
  weeklyFolder: 'Weekly',
  weeklyFormat: 'YYYY-M-D',
  weeklyTemplate: '',
  templatesFolder: 'Knote Resources/Templates',
  attachmentsFolder: 'Knote Resources/Attachments',
  columns: [
    { name: 'To Do', char: ' ' },
    { name: 'Ready to Work', char: 'r' },
    { name: 'Waiting', char: 'w', requireReason: true },
    { name: 'In Progress', char: '/' },
    { name: 'Done', char: 'x' }
  ],
  machines: [],
  deprecatedTags: [],
  userDictionary: [],
  linkUpdate: 'always',
  hiddenProjects: []
}
