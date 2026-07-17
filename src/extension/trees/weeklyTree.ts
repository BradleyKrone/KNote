// The "This Week" activity-bar container: its own calendar icon whose whole
// job is one-click access to this week's note. Revealing the view opens (and
// creates, if needed) the current weekly note; the tree below it is a
// launcher for this week plus a newest-first list of past weekly notes.

import * as vscode from 'vscode'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import type { VaultPath } from '@shared/types'
import { joinRel } from '@shared/pathUtils'
import { getVaultConfig } from '../../core/vaultConfig'
import { currentVaultRoot, notesMap, onIndexDelta } from '../engine'
import { uriForRel } from '../paths'

dayjs.extend(isoWeek)

type WeeklyNode =
  | { kind: 'thisWeek' }
  | { kind: 'past'; path: VaultPath; title: string }

/** Vault-relative path of the current ISO-week note, per the vault config. */
async function thisWeekPath(): Promise<VaultPath> {
  const config = await getVaultConfig()
  const name = dayjs().startOf('isoWeek').format(config.weeklyFormat)
  return joinRel(config.weeklyFolder, name + '.md')
}

class WeeklyTreeProvider implements vscode.TreeDataProvider<WeeklyNode> {
  private emitter = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.emitter.event

  refresh(): void {
    this.emitter.fire()
  }

  getTreeItem(node: WeeklyNode): vscode.TreeItem {
    if (node.kind === 'thisWeek') {
      const item = new vscode.TreeItem("This Week's Note")
      item.iconPath = new vscode.ThemeIcon('calendar')
      item.tooltip = "Open (or create) this week's note"
      item.command = { command: 'knote.openWeeklyNote', title: "Open This Week's Note" }
      return item
    }
    const uri = uriForRel(node.path)
    const item = new vscode.TreeItem(node.title)
    item.iconPath = new vscode.ThemeIcon('note')
    item.resourceUri = uri
    item.tooltip = node.path
    item.command = {
      command: 'knote.openLivePreview',
      title: 'Open Weekly Note',
      arguments: [uri]
    }
    return item
  }

  async getChildren(node?: WeeklyNode): Promise<WeeklyNode[]> {
    if (node || !currentVaultRoot()) return []
    const config = await getVaultConfig()
    const prefix = config.weeklyFolder ? config.weeklyFolder + '/' : ''
    const current = await thisWeekPath()

    const past = [...notesMap().values()]
      .filter((m) => m.path.startsWith(prefix) && m.path !== current)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .map((m): WeeklyNode => ({ kind: 'past', path: m.path, title: m.title }))

    return [{ kind: 'thisWeek' }, ...past]
  }
}

export function registerWeeklyTree(context: vscode.ExtensionContext): void {
  const provider = new WeeklyTreeProvider()
  const view = vscode.window.createTreeView('knote.weekly', { treeDataProvider: provider })

  let refreshTimer: NodeJS.Timeout | undefined
  context.subscriptions.push(
    view,
    // Clicking the activity-bar icon reveals the view — that's our cue to open
    // this week's note. Only on show, and only with a vault open.
    view.onDidChangeVisibility((e) => {
      if (e.visible && currentVaultRoot()) {
        void vscode.commands.executeCommand('knote.openWeeklyNote')
      }
    }),
    onIndexDelta(() => {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => provider.refresh(), 300)
    }),
    { dispose: () => refreshTimer && clearTimeout(refreshTimer) }
  )
}
