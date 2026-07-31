// The three activity-bar quick-access trees: Boards, Machines, Projects.
// Each sits in its own view container (its own icon on the activity bar) and
// is a launcher first: the top item opens the full panel, the rows below are
// shortcuts into the same data. Native TreeViews rather than webviews — these
// are lists of links, and they read like the rest of VS Code's sidebar.
// All counting/grouping/ordering lives in quickAccessSelectors (pure, tested).

import * as vscode from 'vscode'
import dayjs from 'dayjs'
import type { VaultPath } from '@shared/types'
import { getVaultConfig, setVaultConfig } from '../../core/vaultConfig'
import { currentVaultRoot, notesMap, onIndexDelta } from '../engine'
import { broadcast } from '../rpc/webviewRpc'
import { uriForRel } from '../paths'
import { openNoteInLiveEditor } from '../views/liveEditorProvider'
import {
  collectBoards,
  collectMachines,
  collectProjects,
  type MachineEntryNode,
  type MachineNode,
  type NoteBoardNode,
  type ProjectNode
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

// ---------- Projects (the Planner container) ----------

type PlannerTreeNode = { kind: 'planner' } | ProjectNode

/**
 * Just the projects, each with a checkbox deciding whether it appears on the
 * Planner chart. The state lives in the vault config (`hiddenProjects`), so a
 * choice survives a reload and reaches the webview through the same
 * `configChanged` broadcast every other setting uses.
 */
class PlannerTreeProvider implements vscode.TreeDataProvider<PlannerTreeNode> {
  private emitter = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.emitter.event
  /** Read synchronously by getTreeItem, so it's cached rather than awaited per row. */
  private hidden = new Set<string>()

  refresh(): void {
    this.emitter.fire()
  }

  /** Re-read the hidden set, then redraw. */
  async reload(): Promise<void> {
    this.hidden = new Set((await getVaultConfig()).hiddenProjects)
    this.refresh()
  }

  /** Tick/untick a project, persisting to the vault config. */
  async setVisible(slug: string, visible: boolean): Promise<void> {
    const config = await getVaultConfig()
    const hidden = new Set(config.hiddenProjects)
    if (visible) hidden.delete(slug)
    else hidden.add(slug)
    await setVaultConfig({ ...config, hiddenProjects: [...hidden].sort() })
    this.hidden = hidden
    // Tell the open Planner panel, which mirrors the config like every webview.
    broadcast('configChanged', { ...config, hiddenProjects: [...hidden].sort() })
    this.refresh()
  }

  getTreeItem(node: PlannerTreeNode): vscode.TreeItem {
    if (node.kind === 'planner') {
      const item = new vscode.TreeItem('Open Planner')
      item.iconPath = new vscode.ThemeIcon('gantt-chart')
      item.tooltip = 'Open the project planner (deliverables on a schedule)'
      item.command = { command: 'knote.openPlanner', title: 'Open Planner' }
      return item
    }
    {
      const item = new vscode.TreeItem(node.title)
      item.checkboxState = this.hidden.has(node.slug)
        ? vscode.TreeItemCheckboxState.Unchecked
        : vscode.TreeItemCheckboxState.Checked
      item.iconPath = new vscode.ThemeIcon(
        node.complete ? 'pass-filled' : node.overdue ? 'warning' : 'project'
      )
      const count = `${node.deliverables} ${node.deliverables === 1 ? 'deliverable' : 'deliverables'}`
      const state = node.complete ? 'completed' : node.overdue ? `overdue ${node.dueDate}` : null
      const span = node.start && node.end ? `${node.start} → ${node.end}` : null
      item.description = [state, count, span].filter(Boolean).join(' · ')
      item.tooltip = `${node.path} — click to open the project note, untick to hide it from the Planner`
      item.command = {
        command: 'knote.openNoteAt',
        title: 'Open Project',
        arguments: [node.path, 0]
      }
      return item
    }
  }

  getChildren(node?: PlannerTreeNode): PlannerTreeNode[] {
    if (node || !currentVaultRoot()) return []
    return [{ kind: 'planner' }, ...collectProjects(notesMap(), today())]
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
  const planner = new PlannerTreeProvider()

  const boardsView = vscode.window.createTreeView('knote.boards', { treeDataProvider: boards })
  const machinesView = vscode.window.createTreeView('knote.machines', {
    treeDataProvider: machines
  })
  const plannerView = vscode.window.createTreeView('knote.projects', {
    treeDataProvider: planner,
    // Ticking several projects in a row shouldn't need one click each to
    // re-focus the row.
    manageCheckboxStateManually: true
  })
  // The hidden set lives on disk; load it once the vault is up.
  void planner.reload()

  context.subscriptions.push(
    plannerView.onDidChangeCheckboxState(async ({ items }) => {
      for (const [node, state] of items) {
        if (node.kind !== 'project') continue
        await planner.setVisible(node.slug, state === vscode.TreeItemCheckboxState.Checked)
      }
    }),
    boardsView,
    machinesView,
    plannerView,
    autoOpenOnReveal(boardsView as vscode.TreeView<unknown>, 'knote.openBoard'),
    autoOpenOnReveal(machinesView as vscode.TreeView<unknown>, 'knote.openMachineLog'),
    autoOpenOnReveal(plannerView as vscode.TreeView<unknown>, 'knote.openPlanner'),
    debouncedRefresh(() => {
      boards.refresh()
      machines.refresh()
      planner.refresh()
    }),
    vscode.commands.registerCommand('knote.openNoteAt', async (path: VaultPath, line: number) => {
      await openNoteInLiveEditor(uriForRel(path), line)
    })
  )
}
