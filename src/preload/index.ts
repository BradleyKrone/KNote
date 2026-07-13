import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels, type KnoteApi } from '@shared/ipc'
import type {
  ExternalChange,
  IndexDelta,
  SpellContextInfo,
  ThemeName,
  VaultPath
} from '@shared/types'

const api: KnoteApi = {
  pickVault: () => ipcRenderer.invoke(IpcChannels.vaultPick),
  openVaultPath: (root: string) => ipcRenderer.invoke(IpcChannels.vaultOpenPath, root),
  getCurrentVault: () => ipcRenderer.invoke(IpcChannels.vaultGetCurrent),
  getTree: () => ipcRenderer.invoke(IpcChannels.vaultTree),

  readFile: (path: VaultPath) => ipcRenderer.invoke(IpcChannels.fileRead, path),
  writeFile: (path: VaultPath, content: string, expectedMtimeMs?: number) =>
    ipcRenderer.invoke(IpcChannels.fileWrite, path, content, expectedMtimeMs),
  createFile: (path: VaultPath, content?: string) =>
    ipcRenderer.invoke(IpcChannels.fileCreate, path, content),
  createFolder: (path: VaultPath) => ipcRenderer.invoke(IpcChannels.folderCreate, path),
  renameEntry: (path: VaultPath, newName: string) =>
    ipcRenderer.invoke(IpcChannels.entryRename, path, newName),
  moveEntry: (path: VaultPath, targetFolder: VaultPath) =>
    ipcRenderer.invoke(IpcChannels.entryMove, path, targetFolder),
  deleteEntry: (path: VaultPath) => ipcRenderer.invoke(IpcChannels.entryDelete, path),

  getSettings: () => ipcRenderer.invoke(IpcChannels.settingsGet),
  setTheme: (theme: ThemeName) => ipcRenderer.invoke(IpcChannels.settingsSetTheme, theme),
  setReadableLineLength: (enabled: boolean) =>
    ipcRenderer.invoke(IpcChannels.settingsSetReadableLineLength, enabled),
  setHotkeyOverrides: (overrides: Record<string, string | null>) =>
    ipcRenderer.invoke(IpcChannels.settingsSetHotkeyOverrides, overrides),
  getVaultConfig: () => ipcRenderer.invoke(IpcChannels.vaultConfigGet),
  setVaultConfig: (config) => ipcRenderer.invoke(IpcChannels.vaultConfigSet, config),

  getIndexSnapshot: () => ipcRenderer.invoke(IpcChannels.indexSnapshot),
  searchVault: (query: string) => ipcRenderer.invoke(IpcChannels.searchQuery, query),
  findMentions: (strings: string[], excludePath: VaultPath) =>
    ipcRenderer.invoke(IpcChannels.mentionsFind, strings, excludePath),
  replaceLine: (path: VaultPath, line: number, expectedText: string, newText: string) =>
    ipcRenderer.invoke(IpcChannels.lineReplace, path, line, expectedText, newText),
  setTaskStatusReason: (
    path: VaultPath,
    line: number,
    expectedText: string,
    targetChar: string,
    reasonLine: string
  ) =>
    ipcRenderer.invoke(
      IpcChannels.lineSetStatusReason,
      path,
      line,
      expectedText,
      targetChar,
      reasonLine
    ),
  deleteLine: (path: VaultPath, line: number, expectedText: string) =>
    ipcRenderer.invoke(IpcChannels.lineDelete, path, line, expectedText),
  moveLine: (
    path: VaultPath,
    fromLine: number,
    expectedText: string,
    beforeLine: number,
    beforeExpectedText: string | null
  ) =>
    ipcRenderer.invoke(
      IpcChannels.lineMove,
      path,
      fromLine,
      expectedText,
      beforeLine,
      beforeExpectedText
    ),
  appendToNote: (path: VaultPath, text: string) =>
    ipcRenderer.invoke(IpcChannels.noteAppend, path, text),
  renameTag: (oldTag: string, newTag: string) =>
    ipcRenderer.invoke(IpcChannels.tagRename, oldTag, newTag),
  saveAttachment: (fileName: string, data: ArrayBuffer) =>
    ipcRenderer.invoke(IpcChannels.attachmentSave, fileName, data),
  ensureCopilotDoc: (content: string) => ipcRenderer.invoke(IpcChannels.copilotEnsureDoc, content),
  openInVSCode: () => ipcRenderer.invoke(IpcChannels.vaultOpenVSCode),

  spellcheck: {
    addWord: (word: string) => ipcRenderer.invoke(IpcChannels.spellcheckAddWord, word)
  },

  onSpellContextMenu: (cb: (info: SpellContextInfo) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, info: SpellContextInfo): void => cb(info)
    ipcRenderer.on(IpcChannels.evSpellContextMenu, listener)
    return () => ipcRenderer.removeListener(IpcChannels.evSpellContextMenu, listener)
  },

  onExternalChange: (cb: (change: ExternalChange) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, change: ExternalChange): void => cb(change)
    ipcRenderer.on(IpcChannels.evExternalChange, listener)
    return () => ipcRenderer.removeListener(IpcChannels.evExternalChange, listener)
  },

  onIndexDelta: (cb: (delta: IndexDelta) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, delta: IndexDelta): void => cb(delta)
    ipcRenderer.on(IpcChannels.evIndexDelta, listener)
    return () => ipcRenderer.removeListener(IpcChannels.evIndexDelta, listener)
  }
}

contextBridge.exposeInMainWorld('knote', api)
