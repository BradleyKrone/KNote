// The host ↔ webview contract, successor to the old KnoteApi in ipc.ts.
// The extension host implements HostApi (rpc/hostHandlers.ts); webviews call
// it through the typed proxy in webviews/shared/rpc.ts. Errors cross the
// boundary as messages so the KNOTE_STALE / KNOTE_CONFLICT sentinels (see
// errors.ts) keep working on the webview side.

import type { DeliverableScopeFilter } from './deliverables'
import type {
  EmbedNote,
  FileReadResult,
  IndexDelta,
  Mention,
  NoteMeta,
  SearchResult,
  VaultConfig,
  VaultPath
} from './types'

export interface HostApi {
  /** Full metadata for every note in the vault (hydrates a webview's index store). */
  getIndexSnapshot(): Promise<NoteMeta[]>
  getVaultConfig(): Promise<VaultConfig>
  setVaultConfig(config: VaultConfig): Promise<void>
  /** Vault-wide search with Obsidian-style operators. */
  searchVault(query: string): Promise<SearchResult[]>
  /** Plain-text occurrences of the strings across the vault (unlinked mentions). */
  findMentions(strings: string[], excludePath: VaultPath): Promise<Mention[]>
  readFile(path: VaultPath): Promise<FileReadResult>

  /**
   * The note text behind an `![[embed]]` or a hovered `[[link]]`, narrowed to
   * the target's `#Heading` / `#^block` section. Returns null when the note or
   * the section doesn't resolve. Image targets never come here — the caller
   * recognizes those by extension and renders them inline instead.
   */
  readEmbed(rawTarget: string): Promise<EmbedNote | null>

  /**
   * Resolve an image/embed reference (a `![[...]]` target or `![](...)` src,
   * relative to the note that contains it) to a webview-safe URI string the
   * live-preview editor can load, or null if it doesn't resolve inside the
   * vault. Only meaningful for the editor's own webview, whose handler set
   * closes over its panel; other webviews leave it unimplemented.
   */
  attachmentUri(src: string): Promise<string | null>

  /**
   * Open a draw.io diagram (`.drawio`, `.drawio.svg`, `.drawio.png`) in the
   * Draw.io Integration extension's editor, resolving `src` the same way
   * `attachmentUri` does. Shows an install prompt instead if that extension
   * isn't installed. Only meaningful for the editor's own webview, same as
   * `attachmentUri`.
   */
  openWithDrawio(src: string): Promise<void>

  /**
   * Save a pasted image's bytes (base64-encoded) into the vault's configured
   * attachments folder and return the vault-relative path it was saved at.
   * Used by the live-preview editor's paste handler, since a
   * DocumentPasteEditProvider never fires for paste events inside a custom
   * webview editor's own DOM.
   */
  saveImageAttachment(mimeType: string, base64Data: string): Promise<VaultPath>

  /**
   * Create a blank draw.io diagram in the vault's attachments folder and
   * return the vault-relative path it was saved at. Used by the live-preview
   * editor's "Insert ▸ Draw.io Diagram" right-click action.
   */
  createDrawioDiagram(): Promise<VaultPath>

  // Verified line edits — routed through the host's verifiedEdit (live
  // buffer when the doc is open, atomic disk write otherwise); all fail
  // with KNOTE_STALE instead of writing when the expected text moved.
  replaceLine(path: VaultPath, line: number, expectedText: string, newText: string): Promise<void>
  setTaskStatusMeta(
    path: VaultPath,
    line: number,
    expectedText: string,
    targetChar: string,
    meta: { reasonLine?: string | null; statusChangedLine?: string }
  ): Promise<void>
  /**
   * Rewrite a task's line text and its whole attached block together — what the
   * board's task editor saves. One call rather than a line edit plus a block
   * edit, so the change is a single undo step and can't land half-applied.
   * `blockLines` is everything nested under the task, sub-tasks included,
   * already indented; the task's *own* auto-managed `Reason for` /
   * `Status Changed` / `Date Entered` lines are carried over host-side and must
   * not be included (a sub-task's own stamps must be — they're part of the
   * block).
   *
   * `expectedBlock` is the block the editor was showing, in `taskBlockLines`
   * form. When given, the write is refused with KNOTE_STALE unless the note's
   * current block still matches it exactly. `expectedText` alone only covers
   * the task line, and this write now reaches a whole subtree — without this a
   * stale save would silently swallow a sub-task someone ticked meanwhile.
   */
  setTaskTextAndNotes(
    path: VaultPath,
    line: number,
    expectedText: string,
    newLineText: string,
    blockLines: string[],
    expectedBlock?: string[]
  ): Promise<void>
  deleteLine(path: VaultPath, line: number, expectedText: string): Promise<void>
  moveLine(
    path: VaultPath,
    fromLine: number,
    expectedText: string,
    beforeLine: number,
    beforeExpectedText: string | null
  ): Promise<void>
  /**
   * Insert `text` on the line directly below `afterLine`, verified against
   * that anchor line's exact text — how the planner adds a task or milestone
   * under the deliverable it belongs to.
   */
  insertLine(
    path: VaultPath,
    afterLine: number,
    afterExpectedText: string,
    text: string
  ): Promise<void>
  appendToNote(path: VaultPath, text: string): Promise<void>

  /**
   * Append `text` to this week's weekly note (creating it from the
   * configured weekly template first if it doesn't exist yet), landing it
   * at the end of the note's "Tasks" section when it has one, or at the end
   * of the file otherwise. Used by the board's "Add card" when it isn't
   * scoped to a single note (global/folder view), so quick-added cards land
   * in the weekly note like everything else captured day-to-day, rather
   * than needing a separate inbox note.
   */
  appendToWeeklyNote(text: string): Promise<VaultPath>

  /**
   * Create a note with the given content, returning the path it actually
   * landed at — the name is uniquified if something is already there, so this
   * never overwrites an existing note.
   */
  createNote(path: VaultPath, content: string): Promise<VaultPath>

  /** Renames/merges a tag across the vault. Returns the paths changed. */
  renameTag(oldTag: string, newTag: string): Promise<VaultPath[]>

  /** Open a note in a VS Code editor, optionally landing on a 0-based line. */
  openNote(path: VaultPath, line?: number): Promise<void>

  /** Copy text to the system clipboard (VS Code's native clipboard). */
  copyToClipboard(text: string): Promise<void>

  /**
   * Read the system clipboard. Webviews can't use `navigator.clipboard.read*`
   * (it needs a permission prompt VS Code never shows), so the paste menu item
   * goes through the host.
   */
  readClipboard(): Promise<string>

  /**
   * Hand an http/https/mailto URL to the OS default browser. Other schemes are
   * refused host-side. KNote makes no request of its own — see
   * shared/externalUrl.ts.
   */
  openExternal(url: string): Promise<void>

  /**
   * Open a raw wiki target ("Note", "Note#Heading", "folder/Note"), creating
   * the note (Obsidian behavior) when it doesn't resolve.
   */
  openWikiTarget(rawTarget: string): Promise<void>

  /**
   * Replace a note's whole frontmatter block (creating or removing it as
   * needed). Live-buffer edit when the note is open, verified disk write
   * otherwise.
   */
  setFrontmatter(path: VaultPath, frontmatter: Record<string, unknown>): Promise<void>
}

/** Events the host pushes to every attached webview. */
export interface HostEvents {
  indexDelta: IndexDelta
  /**
   * The vault-wide index has finished building. Webviews re-hydrate on this:
   * the custom editor and sidebar views are registered before the index is
   * built, so one that resolves during activation can call getIndexSnapshot()
   * early and get back a partial (or empty) vault. Without this they'd stay
   * that way until an indexDelta happened to mention each note.
   */
  indexReady: void
  configChanged: VaultConfig
  /** Vault-relative path of the note in the active editor, or null. */
  activeNoteChanged: VaultPath | null
  /**
   * An image/attachment file changed on disk outside the editor's own sync
   * path — e.g. a draw.io diagram edited and saved in its own editor.
   * Image widgets showing this path should refetch and reload.
   */
  attachmentChanged: VaultPath
  /** Ask the Search view to run this query (e.g. a Tags-tree click sends `tag:#x`). */
  searchFor: string
  /** The Boards tree picked a project/deliverable/unassigned/all filter for the open global board. */
  boardFilterChanged: DeliverableScopeFilter
}

// ---------- Wire format ----------

export interface RpcRequest {
  id: number
  method: string
  params: unknown[]
}

export type RpcResponse =
  { id: number; ok: true; result: unknown } | { id: number; ok: false; error: { message: string } }

export interface RpcEvent {
  event: keyof HostEvents
  payload: unknown
}
