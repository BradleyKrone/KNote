// The "This Week" activity-bar container: its own calendar icon whose whole
// job is one-click access to this week's note. Revealing the view opens (and
// creates, if needed) the current weekly note; the tree below it is a
// launcher for this week plus past weekly notes grouped Year → Month, newest
// first, so the list stays short however many years of notes pile up.

import * as vscode from 'vscode'
import dayjs from 'dayjs'
import type { VaultPath } from '@shared/types'
import { weeklyPathFor } from '@shared/previousDay'
import { getVaultConfig } from '../../core/vaultConfig'
import { currentVaultRoot, notesMap, onIndexDelta } from '../engine'
import { uriForRel } from '../paths'
import {
  collectWeeklyNotes,
  groupWeeklyNotes,
  type WeeklyMonthGroup,
  type WeeklyYearGroup
} from './weeklySelectors'

type WeeklyNode =
  | { kind: 'thisWeek' }
  | { kind: 'year'; group: WeeklyYearGroup }
  | { kind: 'month'; group: WeeklyMonthGroup }
  | { kind: 'past'; path: VaultPath; title: string }

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
    if (node.kind === 'year' || node.kind === 'month') {
      // Only the current year and month start open; stable ids let VS Code
      // remember anything the user expands or collapses after that.
      const now = dayjs()
      const isCurrent =
        node.kind === 'year'
          ? node.group.year === now.year()
          : node.group.key === now.format('YYYY-MM')
      const item = new vscode.TreeItem(
        node.kind === 'year' ? String(node.group.year) : node.group.label,
        isCurrent
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
      )
      item.id =
        node.kind === 'year' ? `weekly-year:${node.group.year}` : `weekly-month:${node.group.key}`
      item.iconPath = vscode.ThemeIcon.Folder
      return item
    }
    const uri = uriForRel(node.path)
    const item = new vscode.TreeItem(node.title)
    item.id = `weekly-note:${node.path}`
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
    if (node?.kind === 'year') {
      return node.group.months.map((group): WeeklyNode => ({ kind: 'month', group }))
    }
    if (node?.kind === 'month') {
      return node.group.notes.map((n): WeeklyNode => ({
        kind: 'past',
        path: n.path,
        title: n.title
      }))
    }
    if (node || !currentVaultRoot()) return []
    const config = await getVaultConfig()
    const current = weeklyPathFor(dayjs().format('YYYY-MM-DD'), config)

    const { years, undated } = groupWeeklyNotes(
      collectWeeklyNotes(notesMap().values(), {
        folder: config.weeklyFolder,
        format: config.weeklyFormat,
        current
      })
    )
    return [
      { kind: 'thisWeek' },
      ...years.map((group): WeeklyNode => ({ kind: 'year', group })),
      ...undated.map((n): WeeklyNode => ({ kind: 'past', path: n.path, title: n.title }))
    ]
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
