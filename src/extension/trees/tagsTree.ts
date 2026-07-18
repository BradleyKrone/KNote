// The Tags view: a native TreeDataProvider listing every vault tag with its
// note count (plus a "(no tags)" bucket and a Deprecated section). Clicking
// a tag runs a `tag:#x` search in the Search view; the context menu renames
// or deprecates a tag vault-wide.

import * as vscode from 'vscode'
import { tagCounts, untaggedCount } from '@shared/wikiResolve'
import { getVaultConfig, setVaultConfig } from '../../core/vaultConfig'
import { renameTagAcrossVault } from '../../core/tagRename'
import { notesMap, onIndexDelta, currentVaultRoot } from '../engine'
import { broadcast } from '../rpc/webviewRpc'
import { searchFor } from '../views/sidebarViews'

const VALID_TAG = /^[A-Za-z0-9_][A-Za-z0-9_/-]*$/

type TagNode =
  | { kind: 'untagged'; count: number }
  | { kind: 'tag'; tag: string; count: number }
  | { kind: 'deprecatedHeader' }
  | { kind: 'deprecatedTag'; tag: string; count: number }

class TagsTreeProvider implements vscode.TreeDataProvider<TagNode> {
  private emitter = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.emitter.event

  refresh(): void {
    this.emitter.fire()
  }

  getTreeItem(node: TagNode): vscode.TreeItem {
    switch (node.kind) {
      case 'untagged': {
        const item = new vscode.TreeItem('(no tags)')
        item.iconPath = new vscode.ThemeIcon('circle-slash')
        item.description = String(node.count)
        item.command = {
          command: 'knote.searchTag',
          title: 'Search',
          arguments: ['tag:none']
        }
        return item
      }
      case 'tag': {
        const item = new vscode.TreeItem(`#${node.tag}`)
        item.iconPath = new vscode.ThemeIcon('tag')
        item.description = String(node.count)
        item.contextValue = 'tag'
        item.command = {
          command: 'knote.searchTag',
          title: 'Search',
          arguments: [`tag:#${node.tag}`]
        }
        return item
      }
      case 'deprecatedHeader': {
        const item = new vscode.TreeItem('Deprecated', vscode.TreeItemCollapsibleState.Collapsed)
        item.iconPath = new vscode.ThemeIcon('eye-closed')
        return item
      }
      case 'deprecatedTag': {
        const item = new vscode.TreeItem(`#${node.tag}`)
        item.iconPath = new vscode.ThemeIcon('tag')
        item.description = String(node.count)
        item.contextValue = 'deprecatedTag'
        return item
      }
    }
  }

  async getChildren(node?: TagNode): Promise<TagNode[]> {
    if (!currentVaultRoot()) return []
    const config = await getVaultConfig()
    const counts = tagCounts(notesMap())

    if (node?.kind === 'deprecatedHeader') {
      return config.deprecatedTags.map((tag) => ({
        kind: 'deprecatedTag',
        tag,
        count: counts.get(tag) ?? 0
      }))
    }
    if (node) return []

    const deprecated = new Set(config.deprecatedTags)
    const active = [...counts.entries()]
      .filter(([tag]) => !deprecated.has(tag))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    const out: TagNode[] = [{ kind: 'untagged', count: untaggedCount(notesMap()) }]
    out.push(...active.map(([tag, count]): TagNode => ({ kind: 'tag', tag, count })))
    if (config.deprecatedTags.length > 0) out.push({ kind: 'deprecatedHeader' })
    return out
  }
}

async function setTagDeprecated(tag: string, deprecated: boolean): Promise<void> {
  const config = await getVaultConfig()
  const next = deprecated
    ? [...new Set([...config.deprecatedTags, tag])]
    : config.deprecatedTags.filter((t) => t !== tag)
  const updated = { ...config, deprecatedTags: next }
  await setVaultConfig(updated)
  broadcast('configChanged', updated)
}

async function renameTag(oldTagRaw?: string): Promise<void> {
  const oldTag = (
    oldTagRaw ??
    (await vscode.window.showInputBox({ prompt: 'Tag to rename (without #)' })) ??
    ''
  )
    .replace(/^#/, '')
    .trim()
  if (!oldTag) return
  const newTagInput = await vscode.window.showInputBox({
    prompt: `Rename #${oldTag} to… (use this to merge case/spelling variants)`,
    value: oldTag
  })
  if (newTagInput === undefined) return
  const newTag = newTagInput.replace(/^#/, '').trim()
  if (!newTag || newTag === oldTag) return
  if (!VALID_TAG.test(newTag)) {
    void vscode.window.showErrorMessage(`KNote: "${newTag}" isn't a valid tag name.`)
    return
  }
  const pick = await vscode.window.showWarningMessage(
    `Rename #${oldTag} to #${newTag} across every note in the vault?`,
    { modal: true },
    'Rename'
  )
  if (pick !== 'Rename') return
  const { filesChanged } = await renameTagAcrossVault(oldTag, newTag)
  // Keep the deprecated list in sync with the rename
  const config = await getVaultConfig()
  if (config.deprecatedTags.includes(oldTag)) {
    const updated = {
      ...config,
      deprecatedTags: config.deprecatedTags.map((t) => (t === oldTag ? newTag : t))
    }
    await setVaultConfig(updated)
    broadcast('configChanged', updated)
  }
  void vscode.window.showInformationMessage(
    `KNote: renamed #${oldTag} → #${newTag} in ${filesChanged.length} note${filesChanged.length === 1 ? '' : 's'}.`
  )
}

export function registerTagsTree(context: vscode.ExtensionContext): void {
  const provider = new TagsTreeProvider()
  let refreshTimer: NodeJS.Timeout | undefined
  context.subscriptions.push(
    vscode.window.createTreeView('knote.tags', { treeDataProvider: provider }),
    onIndexDelta(() => {
      // Debounce: bulk indexing fires a delta per note
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => provider.refresh(), 300)
    }),
    vscode.commands.registerCommand('knote.searchTag', (query: string) => searchFor(query)),
    vscode.commands.registerCommand('knote.renameTag', (node?: { tag?: string }) =>
      renameTag(node?.tag)
    ),
    vscode.commands.registerCommand('knote.deprecateTag', async (node?: { tag?: string }) => {
      if (!node?.tag) return
      await setTagDeprecated(node.tag, true)
      provider.refresh()
    }),
    vscode.commands.registerCommand('knote.undeprecateTag', async (node?: { tag?: string }) => {
      if (!node?.tag) return
      await setTagDeprecated(node.tag, false)
      provider.refresh()
    }),
    { dispose: () => refreshTimer && clearTimeout(refreshTimer) }
  )
}
