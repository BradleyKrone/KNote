// The HostApi implementation — the successor to the Electron ipcHandlers.ts.
// Thin delegation into core services and verifiedEdit; shared by every
// webview through webviewRpc.attach.

import * as vscode from 'vscode'
import type { EmbedNote, VaultConfig, VaultPath } from '@shared/types'
import { sliceEmbedSection } from '@shared/embedSlice'
import { isExternalUrl } from '@shared/externalUrl'
import { resolveTarget, sectionLine, splitWikiTarget } from '@shared/wikiResolve'
import { saveImageAttachment } from '../../core/attachments'
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
import { whenIndexBuilt } from '../engine'
import { uriForRel } from '../paths'
import { broadcast, type HostHandlers } from './webviewRpc'

/**
 * Resolve an embed/hover target to the note text it should display. Reads the
 * index's copy of the content (kept current with open buffers by docSync) and
 * falls back to disk for a note the index somehow hasn't got.
 */
async function readEmbed(rawTarget: string): Promise<EmbedNote | null> {
  const { target, section } = splitWikiTarget(rawTarget)
  const notes = new Map(vaultIndex.getSnapshot().map((meta) => [meta.path, meta]))
  const path = resolveTarget(target, notes)
  if (path === null) return null
  const meta = notes.get(path)
  if (!meta) return null

  let content = vaultIndex.getContent(path)
  if (content === undefined) {
    try {
      content = (await vault.readFile(path)).content
    } catch {
      return null
    }
  }

  const sliced = sliceEmbedSection(content, meta, section)
  if (sliced === null) return null
  // Where the shown section starts, so the caller can open the note right there.
  const line = section === null ? null : sectionLine(meta, section)
  return {
    path,
    title: meta.title,
    content: sliced,
    ...(line === null ? {} : { line })
  }
}

export function createHostHandlers(): HostHandlers {
  return {
    // Waits for the initial index build: this is registered (and reachable)
    // before the engine starts, so a restored editor or sidebar view can ask
    // during activation and would otherwise hydrate from an empty vault and
    // stay that way — leaving [[ completion, backlinks and tags near-empty
    // until each note happened to change. Resolves immediately once built.
    getIndexSnapshot: async () => {
      await whenIndexBuilt()
      return vaultIndex.getSnapshot()
    },
    getVaultConfig: () => getVaultConfig(),
    setVaultConfig: async (config: VaultConfig) => {
      await setVaultConfig(config)
      broadcast('configChanged', config)
    },
    searchVault: (query: string) => searchIndex.search(query),
    findMentions: (strings: string[], excludePath: VaultPath) => findMentions(strings, excludePath),
    readFile: (path: VaultPath) => vault.readFile(path),
    readEmbed: (rawTarget: string) => readEmbed(rawTarget),

    saveImageAttachment: (mimeType: string, base64Data: string) =>
      saveImageAttachment(mimeType, Buffer.from(base64Data, 'base64')),

    replaceLine: verifiedEdit.replaceLine,
    setTaskStatusMeta: verifiedEdit.setTaskStatusMeta,
    deleteLine: verifiedEdit.deleteLine,
    moveLine: verifiedEdit.moveLine,
    insertLine: verifiedEdit.insertLine,
    appendToNote: verifiedEdit.appendToNote,

    createNote: async (path: VaultPath, content: string) => {
      const created = await vault.createFile(path, content)
      await vaultIndex.indexFile(created)
      return created
    },

    renameTag: async (oldTag: string, newTag: string) =>
      (await renameTagAcrossVault(oldTag, newTag)).filesChanged,

    setFrontmatter: (path: VaultPath, frontmatter: Record<string, unknown>) =>
      setFrontmatter(path, frontmatter),

    openWikiTarget: (rawTarget: string) => openWikiTarget(rawTarget),

    openNote: (path: VaultPath, line?: number) => openNoteInLiveEditor(uriForRel(path), line),

    copyToClipboard: (text: string) => vscode.env.clipboard.writeText(text),

    readClipboard: () => vscode.env.clipboard.readText(),

    // Scheme-checked again here, not just in the webview: note content is
    // arbitrary text on disk, and the host must never be the side that trusts
    // a `javascript:`/`file:` target it was simply handed.
    openExternal: async (url: string) => {
      if (!isExternalUrl(url)) {
        void vscode.window.showWarningMessage(`KNote: refusing to open ${url}`)
        return
      }
      await vscode.env.openExternal(vscode.Uri.parse(url))
    }
  } satisfies HostHandlers
}
