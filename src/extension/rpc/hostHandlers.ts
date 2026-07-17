// The HostApi implementation — the successor to the Electron ipcHandlers.ts.
// Thin delegation into core services and verifiedEdit; shared by every
// webview through webviewRpc.attach.

import * as vscode from 'vscode'
import type { VaultConfig, VaultPath } from '@shared/types'
import * as vaultIndex from '../../core/indexer/vaultIndex'
import * as searchIndex from '../../core/indexer/searchIndex'
import { findMentions } from '../../core/indexer/mentions'
import { renameTagAcrossVault } from '../../core/tagRename'
import { getVaultConfig, setVaultConfig } from '../../core/vaultConfig'
import * as vault from '../../core/vaultService'
import * as verifiedEdit from '../verifiedEdit'
import { setFrontmatter } from '../frontmatterEdit'
import { openWikiTarget } from '../providers/wikiLinks'
import { openNoteInLiveEditor } from '../views/liveEditorProvider'
import { uriForRel } from '../paths'
import { broadcast, type HostHandlers } from './webviewRpc'

export function createHostHandlers(): HostHandlers {
  return {
    getIndexSnapshot: () => vaultIndex.getSnapshot(),
    getVaultConfig: () => getVaultConfig(),
    setVaultConfig: async (config: VaultConfig) => {
      await setVaultConfig(config)
      broadcast('configChanged', config)
    },
    searchVault: (query: string) => searchIndex.search(query),
    findMentions: (strings: string[], excludePath: VaultPath) => findMentions(strings, excludePath),
    readFile: (path: VaultPath) => vault.readFile(path),

    replaceLine: verifiedEdit.replaceLine,
    setTaskStatusMeta: verifiedEdit.setTaskStatusMeta,
    deleteLine: verifiedEdit.deleteLine,
    moveLine: verifiedEdit.moveLine,
    appendToNote: verifiedEdit.appendToNote,

    renameTag: async (oldTag: string, newTag: string) =>
      (await renameTagAcrossVault(oldTag, newTag)).filesChanged,

    setFrontmatter: (path: VaultPath, frontmatter: Record<string, unknown>) =>
      setFrontmatter(path, frontmatter),

    openWikiTarget: (rawTarget: string) => openWikiTarget(rawTarget),

    openNote: (path: VaultPath, line?: number) => openNoteInLiveEditor(uriForRel(path), line),

    copyToClipboard: (text: string) => vscode.env.clipboard.writeText(text)
  } satisfies HostHandlers
}
