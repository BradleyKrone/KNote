// The three activity-bar quick-access trees: Boards, Machines, Projects.
// Each sits in its own view container (its own icon on the activity bar) and
// is a launcher first: the top item opens the full panel, the rows below are
// shortcuts into the same data. Native TreeViews rather than webviews — these
// are lists of links, and they read like the rest of VS Code's sidebar.
// All counting/grouping/ordering lives in quickAccessSelectors (pure, tested).

import * as vscode from 'vscode'
import { basename } from 'node:path'
import dayjs from 'dayjs'
import type { DeliverableScopeFilter } from '@shared/deliverables'
import type { VaultPath } from '@shared/types'
import { getVaultConfig, setVaultConfig } from '../../core/vaultConfig'
import { getMounts } from '../../core/vaultService'
import { currentVaultRoot, notesMap, onIndexDelta } from '../engine'
import { broadcast } from '../rpc/webviewRpc'
import { uriForRel } from '../paths'
import { openNoteInLiveEditor } from '../views/liveEditorProvider'
import { openBoardWithFilter } from '../views/boardPanel'
import {
  collectBoards,
  collectMachines,
  collectProjectDeliverables,
  collectProjects,
  type MachineEntryNode,
  type MachineNode,
  type ProjectDeliverableNode,
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

type BoardTreeNode =
  | { kind: 'global'; open: number; total: number }
  | { kind: 'filterRoot' }
  | { kind: 'filterAll' }
  | { kind: 'filterUnassigned' }
  | ProjectNode
  | ProjectDeliverableNode
  | { kind: 'folderFilterRoot' }
  | { kind: 'folder'; name: string; label: string }

class BoardsTreeProvider implements vscode.TreeDataProvider<BoardTreeNode> {
  private emitter = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.emitter.event
  /** Read synchronously by getTreeItem, so they're cached rather than awaited per row. */
  private hiddenProjects = new Set<string>()
  private hiddenRoots = new Set<string>()

  refresh(): void {
    this.emitter.fire()
  }

  /** Re-read the board-hidden sets, then redraw. */
  async reload(): Promise<void> {
    const config = await getVaultConfig()
    this.hiddenProjects = new Set(config.boardHiddenProjects)
    this.hiddenRoots = new Set(config.boardHiddenRoots)
    this.refresh()
  }

  /** Tick/untick a project, persisting to the vault config. */
  async setVisible(slug: string, visible: boolean): Promise<void> {
    const config = await getVaultConfig()
    const hidden = new Set(config.boardHiddenProjects)
    if (visible) hidden.delete(slug)
    else hidden.add(slug)
    await setVaultConfig({ ...config, boardHiddenProjects: [...hidden].sort() })
    this.hiddenProjects = hidden
    // Tell the open board panel, which mirrors the config like every webview.
    broadcast('configChanged', { ...config, boardHiddenProjects: [...hidden].sort() })
    this.refresh()
  }

  /** Tick/untick a root folder, persisting to the vault config. */
  async setRootVisible(name: string, visible: boolean): Promise<void> {
    const config = await getVaultConfig()
    const hidden = new Set(config.boardHiddenRoots)
    if (visible) hidden.delete(name)
    else hidden.add(name)
    await setVaultConfig({ ...config, boardHiddenRoots: [...hidden].sort() })
    this.hiddenRoots = hidden
    broadcast('configChanged', { ...config, boardHiddenRoots: [...hidden].sort() })
    this.refresh()
  }

  getTreeItem(node: BoardTreeNode): vscode.TreeItem {
    switch (node.kind) {
      case 'global': {
        const item = new vscode.TreeItem('All Tasks')
        item.iconPath = new vscode.ThemeIcon('layout')
        item.description = `${node.open} open · ${node.total} total`
        item.tooltip = 'Open the whole-vault Kanban board'
        item.command = { command: 'knote.openBoard', title: 'Open Board' }
        return item
      }
      case 'filterRoot': {
        const item = new vscode.TreeItem(
          'Filter by Project',
          vscode.TreeItemCollapsibleState.Collapsed
        )
        item.iconPath = new vscode.ThemeIcon('filter')
        item.tooltip = 'Narrow the whole-vault board to one project or deliverable'
        return item
      }
      case 'filterAll': {
        const item = new vscode.TreeItem('All')
        item.iconPath = new vscode.ThemeIcon('circle-large-outline')
        item.tooltip = 'Show every task on the whole-vault board'
        item.command = {
          command: 'knote.filterBoard',
          title: 'Filter Board',
          arguments: [{ kind: 'all' } satisfies DeliverableScopeFilter]
        }
        return item
      }
      case 'filterUnassigned': {
        const item = new vscode.TreeItem('Unassigned')
        item.iconPath = new vscode.ThemeIcon('question')
        item.tooltip = "Tasks that don't belong to any deliverable"
        item.command = {
          command: 'knote.filterBoard',
          title: 'Filter Board',
          arguments: [{ kind: 'unassigned' } satisfies DeliverableScopeFilter]
        }
        return item
      }
      case 'project': {
        const item = new vscode.TreeItem(node.title, vscode.TreeItemCollapsibleState.Collapsed)
        item.checkboxState = this.hiddenProjects.has(node.slug)
          ? vscode.TreeItemCheckboxState.Unchecked
          : vscode.TreeItemCheckboxState.Checked
        item.iconPath = new vscode.ThemeIcon(
          node.complete ? 'pass-filled' : node.overdue ? 'warning' : 'project'
        )
        const count = `${node.deliverables} ${node.deliverables === 1 ? 'deliverable' : 'deliverables'}`
        item.description = count
        item.tooltip = `Click to filter the board to ${node.title}'s deliverables — untick to exclude ${node.title} from the board entirely`
        item.command = {
          command: 'knote.filterBoard',
          title: 'Filter Board',
          arguments: [
            { kind: 'project', slug: node.slug, label: node.title } satisfies DeliverableScopeFilter
          ]
        }
        return item
      }
      case 'deliverable': {
        const item = new vscode.TreeItem(node.label)
        item.iconPath = new vscode.ThemeIcon(node.done ? 'pass-filled' : 'circle-large-outline')
        item.tooltip = `Filter the board to just this deliverable`
        item.command = {
          command: 'knote.filterBoard',
          title: 'Filter Board',
          arguments: [
            {
              kind: 'deliverable',
              tag: node.tag,
              label: node.label
            } satisfies DeliverableScopeFilter
          ]
        }
        return item
      }
      case 'folderFilterRoot': {
        const item = new vscode.TreeItem(
          'Filter by Folder',
          vscode.TreeItemCollapsibleState.Collapsed
        )
        item.iconPath = new vscode.ThemeIcon('filter')
        item.tooltip = 'Untick a folder to exclude every note under it from the Kanban board'
        return item
      }
      case 'folder': {
        const item = new vscode.TreeItem(node.label)
        item.checkboxState = this.hiddenRoots.has(node.name)
          ? vscode.TreeItemCheckboxState.Unchecked
          : vscode.TreeItemCheckboxState.Checked
        item.iconPath = new vscode.ThemeIcon(node.name === '' ? 'root-folder' : 'folder')
        item.tooltip = 'Untick to exclude every note under this folder from the board'
        return item
      }
    }
  }

  getChildren(node?: BoardTreeNode): BoardTreeNode[] {
    if (!currentVaultRoot()) return []
    if (!node) {
      const model = collectBoards(notesMap())
      return [
        { kind: 'global', open: model.open, total: model.total },
        { kind: 'filterRoot' },
        { kind: 'folderFilterRoot' }
      ]
    }
    if (node.kind === 'filterRoot') {
      return [
        { kind: 'filterAll' },
        { kind: 'filterUnassigned' },
        ...collectProjects(notesMap(), today())
      ]
    }
    if (node.kind === 'folderFilterRoot') {
      const root = currentVaultRoot()
      const primary: BoardTreeNode = {
        kind: 'folder',
        name: '',
        label: root ? basename(root) : '(Vault Root)'
      }
      return [
        primary,
        ...getMounts().map((m): BoardTreeNode => ({ kind: 'folder', name: m.name, label: m.name }))
      ]
    }
    if (node.kind === 'project') {
      return collectProjectDeliverables(notesMap(), node.slug)
    }
    return []
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
 * becomes visible, open its panel automatically. We fire once per
 * hidden→visible span (the panel commands dedupe/reveal, so firing again
 * would be harmless — this just avoids a redundant `executeCommand` while the
 * view stays continuously visible) and only once a vault is open. Switching
 * away to another KNote icon and back is its own hidden→visible span, so it
 * re-fires — that's the whole point: it re-opens/reveals the panel exactly
 * like clicking it the first time did.
 *
 * Registration happens before the vault finishes opening (activate() creates
 * these trees, then awaits openVault()), so a window restored with a KNote
 * container already active can find `view.visible` true before there's a
 * vault. That check would then silently no-op, and — because the view was
 * already visible at construction — never see a hidden→visible transition to
 * retry on its own. `retry()` gives the caller a second chance to fire once
 * the vault is actually open, as long as the view is still in that same
 * initial visible span (hasn't fired yet).
 */
function autoOpenOnReveal(
  view: vscode.TreeView<unknown>,
  command: string
): { disposable: vscode.Disposable; retry: () => void } {
  let wasVisible = view.visible
  let firedThisSpan = false
  const maybeOpen = (): void => {
    if (firedThisSpan) return
    if (currentVaultRoot()) {
      firedThisSpan = true
      void vscode.commands.executeCommand(command)
    }
  }
  if (wasVisible) maybeOpen()
  const disposable = view.onDidChangeVisibility((e) => {
    if (e.visible && !wasVisible) maybeOpen()
    if (!e.visible) firedThisSpan = false
    wasVisible = e.visible
  })
  return {
    disposable,
    retry: () => {
      if (wasVisible) maybeOpen()
    }
  }
}

/** Handle returned to `extension.ts` so it can re-sync the hidden-project sets once a vault is actually open. */
export interface QuickAccessTrees {
  reload: () => Promise<void>
  /** Retry any auto-open that raced the vault opening — see `autoOpenOnReveal`. */
  retryAutoOpen: () => void
}

export function registerQuickAccessTrees(context: vscode.ExtensionContext): QuickAccessTrees {
  const boards = new BoardsTreeProvider()
  const machines = new MachinesTreeProvider()
  const planner = new PlannerTreeProvider()

  const boardsView = vscode.window.createTreeView('knote.boards', {
    treeDataProvider: boards,
    // Ticking several projects in a row shouldn't need one click each to
    // re-focus the row.
    manageCheckboxStateManually: true
  })
  const machinesView = vscode.window.createTreeView('knote.machines', {
    treeDataProvider: machines
  })
  const plannerView = vscode.window.createTreeView('knote.projects', {
    treeDataProvider: planner,
    // Ticking several projects in a row shouldn't need one click each to
    // re-focus the row.
    manageCheckboxStateManually: true
  })
  const boardsAutoOpen = autoOpenOnReveal(boardsView as vscode.TreeView<unknown>, 'knote.openBoard')
  const machinesAutoOpen = autoOpenOnReveal(
    machinesView as vscode.TreeView<unknown>,
    'knote.openMachineLog'
  )
  const plannerAutoOpen = autoOpenOnReveal(
    plannerView as vscode.TreeView<unknown>,
    'knote.openPlanner'
  )

  context.subscriptions.push(
    plannerView.onDidChangeCheckboxState(async ({ items }) => {
      for (const [node, state] of items) {
        if (node.kind !== 'project') continue
        await planner.setVisible(node.slug, state === vscode.TreeItemCheckboxState.Checked)
      }
    }),
    boardsView.onDidChangeCheckboxState(async ({ items }) => {
      for (const [node, state] of items) {
        const checked = state === vscode.TreeItemCheckboxState.Checked
        if (node.kind === 'project') await boards.setVisible(node.slug, checked)
        else if (node.kind === 'folder') await boards.setRootVisible(node.name, checked)
      }
    }),
    boardsView,
    machinesView,
    plannerView,
    boardsAutoOpen.disposable,
    machinesAutoOpen.disposable,
    plannerAutoOpen.disposable,
    debouncedRefresh(() => {
      boards.refresh()
      machines.refresh()
      planner.refresh()
    }),
    vscode.commands.registerCommand('knote.openNoteAt', async (path: VaultPath, line: number) => {
      await openNoteInLiveEditor(uriForRel(path), line)
    }),
    vscode.commands.registerCommand('knote.filterBoard', (filter: DeliverableScopeFilter) =>
      openBoardWithFilter(context, filter)
    )
  )

  return {
    // The hidden sets live on disk; the caller runs this once the vault is
    // actually open (config reads before then would silently fall back to
    // defaults and leave every project's checkbox looking ticked).
    reload: async () => {
      await Promise.all([planner.reload(), boards.reload()])
    },
    retryAutoOpen: () => {
      boardsAutoOpen.retry()
      machinesAutoOpen.retry()
      plannerAutoOpen.retry()
    }
  }
}
