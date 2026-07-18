// The three activity-bar quick-access trees: Boards, Machines, Milestones.
// Each sits in its own view container (its own icon on the activity bar) and
// is a launcher first: the top item opens the full panel, the rows below are
// shortcuts into the same data. Native TreeViews rather than webviews — these
// are lists of links, and they read like the rest of VS Code's sidebar.
// All counting/grouping/ordering lives in quickAccessSelectors (pure, tested).

import * as vscode from 'vscode'
import dayjs from 'dayjs'
import type { VaultPath } from '@shared/types'
import { getVaultConfig } from '../../core/vaultConfig'
import { currentVaultRoot, notesMap, onIndexDelta } from '../engine'
import { uriForRel } from '../paths'
import { openNoteInLiveEditor } from '../views/liveEditorProvider'
import {
  collectBoards,
  collectMachines,
  collectMilestones,
  relativeLabel,
  type MachineEntryNode,
  type MachineNode,
  type MilestoneNode,
  type NoteBoardNode
} from './quickAccessSelectors'

const today = (): string => dayjs().format('YYYY-MM-DD')

/** Bulk indexing fires one delta per note; collapse the burst into one refresh. */
function debouncedRefresh(refresh: () => void): vscode.Disposable {
  let timer: NodeJS.Timeout | undefined
  const sub = onIndexDelta(() => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(refresh, 300)
  })
  return {
    dispose: () => {
      if (timer) clearTimeout(timer)
      sub.dispose()
    }
  }
}

// ---------- Boards ----------

type BoardTreeNode = { kind: 'global'; open: number; total: number } | NoteBoardNode

class BoardsTreeProvider implements vscode.TreeDataProvider<BoardTreeNode> {
  private emitter = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.emitter.event

  refresh(): void {
    this.emitter.fire()
  }

  getTreeItem(node: BoardTreeNode): vscode.TreeItem {
    if (node.kind === 'global') {
      const item = new vscode.TreeItem('All Tasks')
      item.iconPath = new vscode.ThemeIcon('layout')
      item.description = `${node.open} open · ${node.total} total`
      item.tooltip = 'Open the whole-vault Kanban board'
      item.command = { command: 'knote.openBoard', title: 'Open Board' }
      return item
    }
    const item = new vscode.TreeItem(node.title)
    item.iconPath = new vscode.ThemeIcon('checklist')
    item.description = `${node.open}/${node.total}`
    item.resourceUri = uriForRel(node.path)
    item.tooltip = `Open the board for ${node.path} — ${node.open} of ${node.total} open`
    item.command = {
      command: 'knote.openBoardForPath',
      title: 'Open Board',
      arguments: [node.path]
    }
    return item
  }

  getChildren(node?: BoardTreeNode): BoardTreeNode[] {
    if (node || !currentVaultRoot()) return []
    const model = collectBoards(notesMap())
    return [{ kind: 'global', open: model.open, total: model.total }, ...model.notes]
  }
}

// ---------- Machines ----------

type MachineTreeNode = { kind: 'fullLog'; count: number } | MachineNode | MachineEntryNode

class MachinesTreeProvider implements vscode.TreeDataProvider<MachineTreeNode> {
  private emitter = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.emitter.event

  refresh(): void {
    this.emitter.fire()
  }

  getTreeItem(node: MachineTreeNode): vscode.TreeItem {
    switch (node.kind) {
      case 'fullLog': {
        const item = new vscode.TreeItem('Full Machine Log')
        item.iconPath = new vscode.ThemeIcon('list-flat')
        item.description = `${node.count} ${node.count === 1 ? 'entry' : 'entries'}`
        item.tooltip = 'Open the Machine Log panel'
        item.command = { command: 'knote.openMachineLog', title: 'Open Machine Log' }
        return item
      }
      case 'machine': {
        const item = new vscode.TreeItem(
          node.serial,
          node.entries.length > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None
        )
        item.iconPath = new vscode.ThemeIcon(node.registered ? 'server' : 'question')
        const count = `${node.entries.length} ${node.entries.length === 1 ? 'entry' : 'entries'}`
        item.description = node.config ? `${node.config} · ${count}` : count
        item.tooltip = node.registered
          ? `${node.serial}${node.config ? ` — ${node.config}` : ''}`
          : `${node.serial} — not registered in Vault Settings`
        return item
      }
      case 'entry': {
        const item = new vscode.TreeItem(node.text)
        item.iconPath = new vscode.ThemeIcon('note')
        item.description = [node.date, node.noteTitle].filter(Boolean).join(' · ')
        item.tooltip = `${node.path}:${node.line + 1}`
        item.command = {
          command: 'knote.openNoteAt',
          title: 'Open Entry',
          arguments: [node.path, node.line]
        }
        return item
      }
    }
  }

  async getChildren(node?: MachineTreeNode): Promise<MachineTreeNode[]> {
    if (!currentVaultRoot()) return []
    if (node?.kind === 'machine') return node.entries
    if (node) return []
    const { machines } = await getVaultConfig()
    const model = collectMachines(notesMap(), machines)
    return [{ kind: 'fullLog', count: model.totalEntries }, ...model.machines]
  }
}

// ---------- Milestones (the Timeline container) ----------

type TimelineTreeNode = { kind: 'fullTimeline'; count: number } | MilestoneNode

class TimelineTreeProvider implements vscode.TreeDataProvider<TimelineTreeNode> {
  private emitter = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.emitter.event

  refresh(): void {
    this.emitter.fire()
  }

  getTreeItem(node: TimelineTreeNode): vscode.TreeItem {
    if (node.kind === 'fullTimeline') {
      const item = new vscode.TreeItem('Full Timeline')
      item.iconPath = new vscode.ThemeIcon('calendar')
      item.description = `${node.count} ${node.count === 1 ? 'milestone' : 'milestones'}`
      item.tooltip = 'Open the Timeline panel (tasks, notes, and milestones by date)'
      item.command = { command: 'knote.openTimeline', title: 'Open Timeline' }
      return item
    }
    const item = new vscode.TreeItem(node.text)
    item.iconPath = new vscode.ThemeIcon('milestone')
    item.description = `${relativeLabel(node.date, today())} · ${node.noteTitle}`
    item.tooltip = `${node.date} — ${node.path}:${node.line + 1}`
    item.command = {
      command: 'knote.openNoteAt',
      title: 'Open Milestone',
      arguments: [node.path, node.line]
    }
    return item
  }

  getChildren(node?: TimelineTreeNode): TimelineTreeNode[] {
    if (node || !currentVaultRoot()) return []
    const items = collectMilestones(notesMap(), today())
    return [{ kind: 'fullTimeline', count: items.length }, ...items]
  }
}

// ---------- Registration ----------

/**
 * Clicking a KNote activity-bar icon reveals the tree, whose top row is really
 * just a launcher for the full panel. Skip that extra click: when the view
 * first becomes visible, open its panel automatically. We fire only on the
 * hidden→visible transition (the panel commands dedupe/reveal, so revisiting
 * an already-open panel is harmless) and only once a vault is open.
 */
function autoOpenOnReveal(view: vscode.TreeView<unknown>, command: string): vscode.Disposable {
  let wasVisible = view.visible
  const maybeOpen = (): void => {
    if (currentVaultRoot()) void vscode.commands.executeCommand(command)
  }
  if (wasVisible) maybeOpen()
  return view.onDidChangeVisibility((e) => {
    if (e.visible && !wasVisible) maybeOpen()
    wasVisible = e.visible
  })
}

export function registerQuickAccessTrees(context: vscode.ExtensionContext): void {
  const boards = new BoardsTreeProvider()
  const machines = new MachinesTreeProvider()
  const timeline = new TimelineTreeProvider()

  const boardsView = vscode.window.createTreeView('knote.boards', { treeDataProvider: boards })
  const machinesView = vscode.window.createTreeView('knote.machines', {
    treeDataProvider: machines
  })
  const timelineView = vscode.window.createTreeView('knote.milestones', {
    treeDataProvider: timeline
  })

  context.subscriptions.push(
    boardsView,
    machinesView,
    timelineView,
    autoOpenOnReveal(boardsView as vscode.TreeView<unknown>, 'knote.openBoard'),
    autoOpenOnReveal(machinesView as vscode.TreeView<unknown>, 'knote.openMachineLog'),
    autoOpenOnReveal(timelineView as vscode.TreeView<unknown>, 'knote.openTimeline'),
    debouncedRefresh(() => {
      boards.refresh()
      machines.refresh()
      timeline.refresh()
    }),
    vscode.commands.registerCommand('knote.openNoteAt', async (path: VaultPath, line: number) => {
      await openNoteInLiveEditor(uriForRel(path), line)
    })
  )
}
