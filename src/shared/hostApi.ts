// The host ↔ webview contract, successor to the old KnoteApi in ipc.ts.
// The extension host implements HostApi (rpc/hostHandlers.ts); webviews call
// it through the typed proxy in webviews/shared/rpc.ts. Errors cross the
// boundary as messages so the KNOTE_STALE / KNOTE_CONFLICT sentinels (see
// errors.ts) keep working on the webview side.

import type {
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
   * Resolve an image/embed reference (a `![[...]]` target or `![](...)` src,
   * relative to the note that contains it) to a webview-safe URI string the
   * live-preview editor can load, or null if it doesn't resolve inside the
   * vault. Only meaningful for the editor's own webview, whose handler set
   * closes over its panel; other webviews leave it unimplemented.
   */
  attachmentUri(src: string): Promise<string | null>

  // Verified line edits — routed through the host's verifiedEdit (live
  // buffer when the doc is open, atomic disk write otherwise); all fail
  // with KNOTE_STALE instead of writing when the expected text moved.
  replaceLine(path: VaultPath, line: number, expectedText: string, newText: string): Promise<void>
  setTaskStatusMeta(
    path: VaultPath,
    line: number,
    expectedText: string,
    targetChar: string,
    meta: { reasonLine?: string; statusChangedLine?: string }
  ): Promise<void>
  deleteLine(path: VaultPath, line: number, expectedText: string): Promise<void>
  moveLine(
    path: VaultPath,
    fromLine: number,
    expectedText: string,
    beforeLine: number,
    beforeExpectedText: string | null
  ): Promise<void>
  appendToNote(path: VaultPath, text: string): Promise<void>

  /** Renames/merges a tag across the vault. Returns the paths changed. */
  renameTag(oldTag: string, newTag: string): Promise<VaultPath[]>

  /** Open a note in a VS Code editor, optionally landing on a 0-based line. */
  openNote(path: VaultPath, line?: number): Promise<void>

  /** Copy text to the system clipboard (VS Code's native clipboard). */
  copyToClipboard(text: string): Promise<void>

  /**
   * Open a URL in the user's default external application (browser, mail
   * client, …) via VS Code. KNote itself makes no network request — it hands
   * the URL to the OS, and VS Code shows its own trust prompt first.
   */
  openExternal(url: string): Promise<void>

  /**
   * Append a timestamped bullet to this week's note (creating it from the
   * configured template if needed) — the Home dashboard's inline quick capture,
   * same behavior and format as the `knote.quickCapture` command.
   */
  quickCapture(text: string): Promise<void>

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
  configChanged: VaultConfig
  /** Vault-relative path of the note in the active editor, or null. */
  activeNoteChanged: VaultPath | null
  /** Ask the Search view to run this query (e.g. a Tags-tree click sends `tag:#x`). */
  searchFor: string
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
