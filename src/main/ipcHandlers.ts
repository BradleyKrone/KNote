// Registers every IPC endpoint the renderer can call (the channel list and
// payload types live in shared/ipc.ts) and pushes vault/watcher/spellcheck
// events back to the window. The only bridge between UI and filesystem.

import { BrowserWindow, dialog, ipcMain, session } from 'electron'
import { promises as fs } from 'fs'
import { IpcChannels } from '@shared/ipc'
import type { ThemeName, VaultInfo, VaultPath } from '@shared/types'
import { isInside, isMarkdown, joinRel } from '@shared/pathUtils'
import { cleanupAttachmentsForDeletedNote, cleanupRemovedAttachments } from './attachmentCleanup'
import * as vault from './vaultService'
import * as vaultIndex from './indexer/vaultIndex'
import * as searchIndex from './indexer/searchIndex'
import { findMentions } from './indexer/mentions'
import { appendLine, deleteLine, moveLine, replaceLine, setTaskStatusReason } from './lineEdit'
import { renameTagAcrossVault } from './tagRename'
import { markKnownContent, markOwnWrite, startWatching } from './watcher'
import {
  getSettings,
  getVaultConfig,
  setLastVault,
  setReadableLineLength,
  setTheme,
  setVaultConfig
} from './settings'
import type { VaultConfig } from '@shared/types'

async function openVault(root: string, win: BrowserWindow): Promise<VaultInfo> {
  const stat = await fs.stat(root)
  if (!stat.isDirectory()) throw new Error(`Not a folder: ${root}`)
  const info = vault.setVault(root)
  await setLastVault(info.root)

  const config = await getVaultConfig()
  const seededTemplate = await vault.ensureDefaultTemplate(config.templatesFolder)
  if (seededTemplate && !config.weeklyTemplate) {
    config.weeklyTemplate = seededTemplate
    await setVaultConfig(config)
  }

  vaultIndex.onDelta((delta) => {
    if (!win.isDestroyed()) win.webContents.send(IpcChannels.evIndexDelta, delta)
  })

  await startWatching(info.root, (change) => {
    if (!win.isDestroyed()) win.webContents.send(IpcChannels.evExternalChange, change)
    // Keep the index in sync with external edits too
    void vaultIndex.handleFsChange(change.path, change.kind)
  })

  await vaultIndex.initIndex()
  return info
}

export function registerIpcHandlers(getWindow: () => BrowserWindow): void {
  vault.setOwnWriteMarker(markOwnWrite)
  vault.setKnownContentMarker(markKnownContent)

  ipcMain.handle(IpcChannels.vaultPick, async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: 'Open vault folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return openVault(result.filePaths[0], getWindow())
  })

  ipcMain.handle(IpcChannels.vaultOpenPath, (_e, root: string) => openVault(root, getWindow()))

  ipcMain.handle(IpcChannels.vaultGetCurrent, () => vault.currentVault())

  ipcMain.handle(IpcChannels.vaultTree, () => vault.buildTree())

  ipcMain.handle(IpcChannels.fileRead, (_e, path: VaultPath) => vault.readFile(path))

  ipcMain.handle(
    IpcChannels.fileWrite,
    async (_e, path: VaultPath, content: string, expectedMtimeMs?: number) => {
      const oldContent = vaultIndex.getContent(path)
      const result = await vault.writeFileAtomic(path, content, expectedMtimeMs)
      void vaultIndex.indexFile(path)
      void cleanupRemovedAttachments(path, oldContent, content)
      return result
    }
  )

  ipcMain.handle(IpcChannels.fileCreate, async (_e, path: VaultPath, content?: string) => {
    const config = await getVaultConfig()
    const created = await vault.createFile(path, content ?? '', {
      skipCreatedStamp: isInside(path, config.templatesFolder)
    })
    void vaultIndex.indexFile(created)
    return created
  })

  ipcMain.handle(IpcChannels.folderCreate, (_e, path: VaultPath) => vault.createFolder(path))

  ipcMain.handle(IpcChannels.copilotEnsureDoc, async (_e, content: string) => {
    const path = await vault.ensureCopilotInstructions(content)
    void vaultIndex.indexFile(path)
    return path
  })

  ipcMain.handle(IpcChannels.entryRename, async (_e, path: VaultPath, newName: string) => {
    const wasFolder = await vaultIndex.statIsDir(path)
    const newPath = await vault.renameEntry(path, newName)
    void vaultIndex.moveIndexed(path, newPath, wasFolder)
    return newPath
  })

  ipcMain.handle(IpcChannels.entryMove, async (_e, path: VaultPath, targetFolder: VaultPath) => {
    const wasFolder = await vaultIndex.statIsDir(path)
    const newPath = await vault.moveEntry(path, targetFolder)
    void vaultIndex.moveIndexed(path, newPath, wasFolder)
    return newPath
  })

  ipcMain.handle(IpcChannels.entryDelete, async (_e, path: VaultPath) => {
    const wasFolder = await vaultIndex.statIsDir(path)
    const oldContent = !wasFolder && isMarkdown(path) ? vaultIndex.getContent(path) : undefined
    await vault.deleteEntry(path)
    if (wasFolder) vaultIndex.removeFolder(path)
    else vaultIndex.removeFile(path)
    if (oldContent !== undefined) void cleanupAttachmentsForDeletedNote(path, oldContent)
  })

  ipcMain.handle(IpcChannels.indexSnapshot, () => vaultIndex.getSnapshot())

  ipcMain.handle(IpcChannels.searchQuery, (_e, query: string) => searchIndex.search(query))

  ipcMain.handle(IpcChannels.mentionsFind, (_e, strings: string[], excludePath: VaultPath) =>
    findMentions(strings, excludePath)
  )

  ipcMain.handle(
    IpcChannels.lineReplace,
    async (_e, path: VaultPath, line: number, expectedText: string, newText: string) => {
      await replaceLine(path, line, expectedText, newText)
      void vaultIndex.indexFile(path)
    }
  )

  ipcMain.handle(
    IpcChannels.lineSetStatusReason,
    async (
      _e,
      path: VaultPath,
      line: number,
      expectedText: string,
      targetChar: string,
      reasonLine: string
    ) => {
      await setTaskStatusReason(path, line, expectedText, targetChar, reasonLine)
      void vaultIndex.indexFile(path)
    }
  )

  ipcMain.handle(
    IpcChannels.lineDelete,
    async (_e, path: VaultPath, line: number, expectedText: string) => {
      await deleteLine(path, line, expectedText)
      void vaultIndex.indexFile(path)
    }
  )

  ipcMain.handle(
    IpcChannels.lineMove,
    async (
      _e,
      path: VaultPath,
      fromLine: number,
      expectedText: string,
      beforeLine: number,
      beforeExpectedText: string | null
    ) => {
      await moveLine(path, fromLine, expectedText, beforeLine, beforeExpectedText)
      void vaultIndex.indexFile(path)
    }
  )

  ipcMain.handle(IpcChannels.noteAppend, async (_e, path: VaultPath, text: string) => {
    await appendLine(path, text)
    void vaultIndex.indexFile(path)
  })

  ipcMain.handle(IpcChannels.tagRename, async (_e, oldTag: string, newTag: string) => {
    const { filesChanged } = await renameTagAcrossVault(oldTag, newTag)
    return filesChanged
  })

  ipcMain.handle(IpcChannels.attachmentSave, async (_e, fileName: string, data: ArrayBuffer) => {
    const config = await getVaultConfig()
    const target = joinRel(config.attachmentsFolder, fileName)
    return vault.createBinaryFile(target, Buffer.from(data))
  })

  ipcMain.handle(IpcChannels.settingsGet, () => getSettings())

  ipcMain.handle(IpcChannels.settingsSetTheme, (_e, theme: ThemeName) => setTheme(theme))

  ipcMain.handle(IpcChannels.settingsSetReadableLineLength, (_e, enabled: boolean) =>
    setReadableLineLength(enabled)
  )

  ipcMain.handle(IpcChannels.vaultConfigGet, () => getVaultConfig())

  ipcMain.handle(IpcChannels.vaultConfigSet, (_e, config: VaultConfig) => setVaultConfig(config))

  ipcMain.handle(IpcChannels.spellcheckAddWord, (_e, word: string) => {
    session.defaultSession.addWordToSpellCheckerDictionary(word)
  })
}
