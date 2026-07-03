import type {
  AppSettings,
  ExternalChange,
  FileEntry,
  FileReadResult,
  FileWriteResult,
  IndexDelta,
  Mention,
  NoteMeta,
  SearchResult,
  SpellContextInfo,
  ThemeName,
  VaultConfig,
  VaultInfo,
  VaultPath
} from './types'

export const IpcChannels = {
  vaultPick: 'vault:pick',
  vaultOpenPath: 'vault:openPath',
  vaultGetCurrent: 'vault:getCurrent',
  vaultTree: 'vault:tree',
  fileRead: 'file:read',
  fileWrite: 'file:write',
  fileCreate: 'file:create',
  folderCreate: 'folder:create',
  entryRename: 'entry:rename',
  entryMove: 'entry:move',
  entryDelete: 'entry:delete',
  settingsGet: 'settings:get',
  settingsSetTheme: 'settings:setTheme',
  vaultConfigGet: 'vaultConfig:get',
  vaultConfigSet: 'vaultConfig:set',
  indexSnapshot: 'index:snapshot',
  searchQuery: 'search:query',
  mentionsFind: 'mentions:find',
  lineReplace: 'line:replace',
  lineDelete: 'line:delete',
  lineMove: 'line:move',
  noteAppend: 'note:append',
  spellcheckAddWord: 'spellcheck:addWord',
  // main -> renderer events
  evExternalChange: 'ev:externalChange',
  evIndexDelta: 'ev:indexDelta',
  evSpellContextMenu: 'ev:spellContextMenu'
} as const

/**
 * The API exposed on window.knote by the preload script.
 * Implemented in src/preload/index.ts, handled in src/main/ipcHandlers.ts.
 */
export interface KnoteApi {
  /** Open a native folder picker; returns the opened vault or null if cancelled. */
  pickVault(): Promise<VaultInfo | null>
  /** Open a vault at a known absolute path (e.g. the remembered last vault). */
  openVaultPath(root: string): Promise<VaultInfo>
  getCurrentVault(): Promise<VaultInfo | null>
  getTree(): Promise<FileEntry[]>

  readFile(path: VaultPath): Promise<FileReadResult>
  /**
   * Write file contents. If expectedMtimeMs is given and the file on disk
   * has a different mtime (someone else wrote it since we last read/saved),
   * the write is refused with a KNOTE_CONFLICT error instead of clobbering.
   */
  writeFile(path: VaultPath, content: string, expectedMtimeMs?: number): Promise<FileWriteResult>
  /** Creates a note/file; auto-uniquifies the name. Returns the actual path created. */
  createFile(path: VaultPath, content?: string): Promise<VaultPath>
  createFolder(path: VaultPath): Promise<VaultPath>
  /** Rename in place (same parent folder). Returns the new path. */
  renameEntry(path: VaultPath, newName: string): Promise<VaultPath>
  /** Move a file/folder into targetFolder ('' = vault root). Returns the new path. */
  moveEntry(path: VaultPath, targetFolder: VaultPath): Promise<VaultPath>
  /** Delete to the OS trash. */
  deleteEntry(path: VaultPath): Promise<void>

  getSettings(): Promise<AppSettings>
  setTheme(theme: ThemeName): Promise<void>
  getVaultConfig(): Promise<VaultConfig>
  setVaultConfig(config: VaultConfig): Promise<void>

  /** Full metadata for every note in the vault (hydrates the renderer index). */
  getIndexSnapshot(): Promise<NoteMeta[]>
  /** Vault-wide search with Obsidian-style operators. */
  searchVault(query: string): Promise<SearchResult[]>
  /** Plain-text occurrences of the strings across the vault (unlinked mentions). */
  findMentions(strings: string[], excludePath: VaultPath): Promise<Mention[]>
  /**
   * Verified single-line rewrite: fails with KNOTE_STALE instead of writing
   * if the expected text no longer matches.
   */
  replaceLine(path: VaultPath, line: number, expectedText: string, newText: string): Promise<void>
  /** Verified line delete (fails with KNOTE_STALE when the text moved). */
  deleteLine(path: VaultPath, line: number, expectedText: string): Promise<void>
  /** Verified same-note line move; beforeLine -1 = end of file. */
  moveLine(
    path: VaultPath,
    fromLine: number,
    expectedText: string,
    beforeLine: number,
    beforeExpectedText: string | null
  ): Promise<void>
  /** Append a line to a note, creating the note if needed. */
  appendToNote(path: VaultPath, text: string): Promise<void>

  spellcheck: {
    /** Add a word to the user's personal spellchecker dictionary. */
    addWord(word: string): Promise<void>
  }

  /**
   * Subscribe to spellcheck context (misspelled word + suggestions) emitted by
   * the main process whenever the user right-clicks inside the editor. This is
   * the only reliable source — the renderer-side webFrame spellcheck APIs are
   * non-functional with the native Windows checker. Returns unsubscribe.
   */
  onSpellContextMenu(cb: (info: SpellContextInfo) => void): () => void

  /** Subscribe to filesystem changes made outside KNote. Returns unsubscribe. */
  onExternalChange(cb: (change: ExternalChange) => void): () => void
  /** Subscribe to note metadata updates (any source). Returns unsubscribe. */
  onIndexDelta(cb: (delta: IndexDelta) => void): () => void
}
