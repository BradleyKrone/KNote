// The Files view: a folder browser, not an expanding tree. It shows the
// contents of exactly one folder at a time — click a folder to go into it,
// click the single path row at the top and pick a level to come back out — so
// the list stays as short as the folder you're actually in, and every other
// row in it is a real file or folder rather than navigation furniture.
// Clicking a note opens it in Live Preview; anything else opens in whatever
// editor VS Code normally uses.
//
// Renames and drag-moves deliberately go through a WorkspaceEdit rather than
// workspace.fs.rename: onWillRenameFiles — which renameLinks.ts hooks to
// rewrite every [[wiki link]] pointing at the moved note — fires only for
// user gestures and applyEdit, never for the fs API. Routing around it would
// silently break links, and would cost the shared undo step that puts a
// mis-drag back exactly as it was. Deletes are the other way round, going
// through vault.deleteEntry so they land in the OS trash and the watcher
// recognises them as our own write.

import * as vscode from 'vscode'
import { basename } from 'path'
import type { FileEntry, VaultPath } from '@shared/types'
import { isMarkdown, joinRel, nameOf, normalizeRel, parentOf } from '@shared/pathUtils'
import * as vault from '../../core/vaultService'
import * as vaultIndex from '../../core/indexer/vaultIndex'
import { currentVaultRoot, onVaultFsChange } from '../engine'
import { currentActiveNoteRel, onActiveNoteChanged } from '../rpc/webviewRpc'
import { relForUri, uriForRel } from '../paths'
import { openNoteInLiveEditor } from '../views/liveEditorProvider'
import {
  breadcrumbSegments,
  breadcrumbText,
  contextPaths,
  dropTargetFolder,
  folderRows,
  jumpTargets,
  moveTargets,
  plannedMoves,
  renamedPath,
  validateName,
  type FilesNode
} from './filesTreeSelectors'

/** Our own drag payload, so a drag between KNote rows carries the paths themselves. */
const KNOTE_FILES_MIME = 'application/vnd.code.tree.knote.files'

/** Set so the Back button can hide itself at the vault root. */
const IN_SUBFOLDER_CONTEXT = 'knote.filesInSubfolder'

/** What clicking a folder row does. */
const OPEN_FOLDER_COMMAND = 'knote.files.openFolder'

/** What clicking the path row does: pick a level of the path and jump to it. */
const GO_TO_COMMAND = 'knote.files.goTo'

/**
 * The folder codicon, drawn ourselves rather than left to the file icon theme
 * — and deliberately *not* `ThemeIcon.Folder`. The ids 'folder' and 'file' are
 * special-cased by VS Code: instead of drawing a codicon they hand the row back
 * to the active icon theme, which then decides folder-vs-file from the row's
 * collapsible state. Nothing expands in this view, so every row is
 * TreeItemCollapsibleState.None, and a theme with no folder icons (Seti, the
 * default) left folder rows blank. 'file-directory' is an alias id for the very
 * same glyph (\ea83), but since the id isn't 'folder' it renders as an ordinary
 * codicon. Files keep `ThemeIcon.File` — going through the icon theme is what
 * gives each one its own per-type icon, which is also what tells the two apart.
 */
const FOLDER_ICON = 'file-directory'

class FilesTreeProvider
  implements vscode.TreeDataProvider<FilesNode>, vscode.TreeDragAndDropController<FilesNode>
{
  private emitter = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.emitter.event

  readonly dragMimeTypes = ['text/uri-list']
  readonly dropMimeTypes = [KNOTE_FILES_MIME, 'text/uri-list']

  /** The folder being shown. '' is the vault root. */
  private folder: VaultPath = ''

  /**
   * One node object per path, reused across refreshes. TreeView.reveal matches
   * elements by identity, so handing out a fresh object for the same file each
   * time would make revealing an already-listed note fail.
   */
  private nodes = new Map<string, FilesNode>()

  get currentFolder(): VaultPath {
    return this.folder
  }

  refresh(): void {
    this.emitter.fire()
  }

  /** Go into a folder (or back to the root with ''), redrawing the list. */
  show(folder: VaultPath): void {
    this.folder = normalizeRel(folder)
    void vscode.commands.executeCommand('setContext', IN_SUBFOLDER_CONTEXT, this.folder !== '')
    this.refresh()
  }

  /** The cached node for a row, minted if this is the first time we've seen it. */
  private nodeFor(node: FilesNode): FilesNode {
    const key = `${node.kind}:${normalizeRel(node.path)}`
    const existing = this.nodes.get(key)
    if (existing) return existing
    this.nodes.set(key, node)
    return node
  }

  async getChildren(node?: FilesNode): Promise<FilesNode[]> {
    // Every row is top-level: this is a browser, so nothing expands in place.
    if (node || !currentVaultRoot()) return []
    const contents = await vault.readDir(this.folder)
    return folderRows(this.folder, contents).map((row) => this.nodeFor(row))
  }

  getTreeItem(node: FilesNode): vscode.TreeItem {
    if (node.kind === 'path') {
      // The whole trail on one row, and the whole of the view's way back out.
      // No icon: it isn't a thing in the vault, and a home/arrow glyph is what
      // made the old per-level rows read as entries rather than as a path.
      const item = new vscode.TreeItem(
        breadcrumbText(breadcrumbSegments(node.path, vaultName())),
        vscode.TreeItemCollapsibleState.None
      )
      item.id = `path:${node.path}`
      item.tooltip = 'Go back to a folder in this path'
      item.contextValue = 'knotePath'
      item.command = { command: GO_TO_COMMAND, title: 'Go Back To…' }
      return item
    }
    // Built from the Uri rather than a string label: that's what gets the row
    // its icon from the user's file icon theme, and its name from the file.
    const item = new vscode.TreeItem(uriForRel(node.path), vscode.TreeItemCollapsibleState.None)
    item.id = `${node.kind}:${node.path}`
    item.iconPath =
      node.kind === 'folder' ? new vscode.ThemeIcon(FOLDER_ICON) : vscode.ThemeIcon.File
    // A mount gets its own contextValue so the menus can offer "New Note" in it
    // while withholding rename/move/delete, which would hit the real folder.
    item.contextValue = vault.isMountRoot(node.path)
      ? 'knoteMount'
      : node.kind === 'folder'
        ? 'knoteFolder'
        : 'knoteFile'
    item.tooltip = node.path
    item.command =
      node.kind === 'folder'
        ? { command: OPEN_FOLDER_COMMAND, title: 'Open Folder', arguments: [node.path] }
        : isMarkdown(node.path)
          ? { command: 'knote.openNoteAt', title: 'Open Note', arguments: [node.path, 0] }
          : { command: 'vscode.open', title: 'Open File', arguments: [uriForRel(node.path)] }
    return item
  }

  /** Flat list — every row is a root item. */
  getParent(): undefined {
    return undefined
  }

  /** The listed row for a path, once the view is showing its folder. */
  async rowFor(path: VaultPath): Promise<FilesNode | undefined> {
    const rel = normalizeRel(path)
    const rows = await this.getChildren()
    return rows.find((row) => row.kind !== 'path' && row.path === rel)
  }

  handleDrag(sources: readonly FilesNode[], data: vscode.DataTransfer): void {
    const paths = sources
      .filter((s) => s.kind !== 'path' && !vault.isMountRoot(s.path))
      .map((s) => s.path)
    if (paths.length === 0) return
    data.set(KNOTE_FILES_MIME, new vscode.DataTransferItem(paths))
    // Also advertise the plain uri list, so a row can be dragged out into the
    // editor or VS Code's own Explorer and still mean something there.
    data.set(
      'text/uri-list',
      new vscode.DataTransferItem(paths.map((p) => uriForRel(p).toString()).join('\r\n'))
    )
  }

  async handleDrop(target: FilesNode | undefined, data: vscode.DataTransfer): Promise<void> {
    const paths = draggedPaths(data)
    if (paths.length === 0) return
    // Via the command rather than moveEntries directly, so the drop performs
    // exactly what the integration harness can drive — a pointer gesture
    // being the one thing it can't reproduce.
    await vscode.commands.executeCommand(
      'knote.files.move',
      paths,
      dropTargetFolder(target, this.folder)
    )
  }
}

/** The vault folder's own name, which is what the top of the trail is called. */
function vaultName(): string {
  const root = currentVaultRoot()
  return root ? basename(root) : 'Vault'
}

/** The dragged paths, whether the drag started here or in VS Code's Explorer. */
function draggedPaths(data: vscode.DataTransfer): VaultPath[] {
  const own = data.get(KNOTE_FILES_MIME)?.value as VaultPath[] | undefined
  if (own) return own.map(normalizeRel)
  const uris = data.get('text/uri-list')?.value
  if (typeof uris !== 'string') return []
  const out: VaultPath[] = []
  for (const line of uris.split(/\r?\n/)) {
    if (line.trim() === '') continue
    const rel = relForUri(vscode.Uri.parse(line.trim()))
    if (rel !== null) out.push(rel)
  }
  return out
}

/**
 * Folder or file, asked of the filesystem rather than assumed. A drag from
 * VS Code's own Explorer carries no kind, and guessing "file" would let a
 * folder be dropped into its own subtree — the one move `plannedMoves` has
 * to reject. Null when the path vanished between drag and drop.
 */
async function statEntry(path: VaultPath): Promise<FileEntry | null> {
  const rel = normalizeRel(path)
  try {
    const stat = await vscode.workspace.fs.stat(uriForRel(rel))
    return {
      path: rel,
      name: nameOf(rel),
      kind: stat.type === vscode.FileType.Directory ? 'folder' : 'file'
    }
  } catch {
    return null
  }
}

/**
 * A mounted folder is a workspace folder that happens to appear in the vault
 * tree — renaming or deleting its row would move or trash the real folder,
 * wherever it lives on disk. Refuse, and say what to do instead.
 */
function refuseMountRoot(path: VaultPath, verb: string): boolean {
  if (!vault.isMountRoot(path)) return false
  void vscode.window.showWarningMessage(
    `"${path}" is a folder mounted from outside the vault and cannot be ${verb} here. ` +
      `Remove it from the workspace instead.`
  )
  return true
}

/**
 * Move entries into a folder as a single WorkspaceEdit — one undo step
 * covering both the moves and the link rewrites renameLinks.ts contributes.
 */
async function moveEntries(sources: readonly FileEntry[], folder: VaultPath): Promise<void> {
  // Guarded here as well as in the menus: the command palette and the
  // integration harness call these commands directly, bypassing `when` clauses.
  const moves = plannedMoves(sources, folder, vault.isMountRoot)
  if (moves.length === 0) return

  const taken = new Set((await vault.readDir(folder)).map((e) => e.name.toLowerCase()))
  const edit = new vscode.WorkspaceEdit()
  const blocked: string[] = []
  let queued = 0
  for (const move of moves) {
    // Refuse rather than overwrite: the note being clobbered may be the only
    // copy, and a drag is far too easy to do by accident for that.
    if (taken.has(nameOf(move.to).toLowerCase())) {
      blocked.push(nameOf(move.to))
      continue
    }
    edit.renameFile(uriForRel(move.from), uriForRel(move.to))
    queued++
  }
  if (blocked.length > 0) {
    void vscode.window.showWarningMessage(
      `Not moved — ${folder || 'the vault root'} already has: ${blocked.join(', ')}`
    )
  }
  if (queued > 0) await vscode.workspace.applyEdit(edit)
}

/**
 * Every folder in the vault, the root first. The destinations for "Move to
 * Folder…", which is how something gets moved *out* of the folder on screen —
 * a drag can only ever reach a row that is currently listed.
 */
async function allFolders(): Promise<VaultPath[]> {
  const out: VaultPath[] = ['']
  const walk = (entries: readonly FileEntry[]): void => {
    for (const entry of entries) {
      if (entry.kind !== 'folder') continue
      out.push(entry.path)
      walk(entry.children ?? [])
    }
  }
  walk(await vault.buildTree())
  return out
}

/** Names already used in a folder, for the uniqueness half of validateName. */
async function siblingNames(folder: VaultPath): Promise<string[]> {
  return (await vault.readDir(folder)).map((e) => e.name)
}

/** Ask for a name, validating as it's typed. Undefined if the user escapes out. */
async function askName(
  prompt: string,
  siblings: readonly string[],
  value?: string,
  valueSelection?: [number, number]
): Promise<string | undefined> {
  const name = await vscode.window.showInputBox({
    prompt,
    value,
    valueSelection,
    validateInput: (input) => validateName(input, siblings)
  })
  return name?.trim() || undefined
}

/**
 * The path a command should act on. Commands take either the tree row VS Code
 * passes from a context menu, or a plain path — the latter so the integration
 * harness can drive them without a modal input box in the way.
 */
function argPath(arg: FilesNode | VaultPath | undefined): VaultPath | undefined {
  if (typeof arg === 'string') return normalizeRel(arg)
  // The path row is a place, not a thing — nothing to rename, move or delete.
  if (!arg || arg.kind === 'path') return undefined
  return arg.path
}

/**
 * The paths a copy command should act on. VS Code calls a `view/item/context`
 * command with (clicked row, whole selection), so a multi-selection copies as
 * one block; the harness — which has no rows to click — passes a path, or a
 * list of them, instead.
 */
function argPaths(
  arg: FilesNode | VaultPath | readonly VaultPath[] | undefined,
  selection: readonly FilesNode[] | undefined
): VaultPath[] {
  if (typeof arg === 'string') return [normalizeRel(arg)]
  if (Array.isArray(arg)) return (arg as readonly VaultPath[]).map(normalizeRel)
  return contextPaths(arg as FilesNode | undefined, selection ?? [])
}

/** Put paths on the clipboard, one per line — nothing to copy is a no-op. */
async function copyPaths(paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return
  await vscode.env.clipboard.writeText(paths.join('\n'))
}

export function registerFilesTree(context: vscode.ExtensionContext): void {
  const provider = new FilesTreeProvider()
  const treeView = vscode.window.createTreeView<FilesNode>('knote.files', {
    treeDataProvider: provider,
    dragAndDropController: provider,
    canSelectMany: true
  })

  /**
   * The title suffix — compact, and stays put when the list is scrolled. The
   * full path is the path row's job and only the path row's: shown in both
   * places it just read as the same line printed twice.
   *
   * `TreeView.message` would be the other candidate, but a message can only be
   * plain text: making its segments into `command:` links needs a
   * MarkdownString, which is gated behind the `treeViewMarkdownMessage` API
   * proposal — an installed VSIX can't use it, and the extension fails to
   * activate at all if it tries.
   */
  const syncHeader = (): void => {
    const here = provider.currentFolder
    treeView.description = here === '' ? vaultName() : here
  }
  const goTo = (folder: VaultPath): void => {
    provider.show(folder)
    syncHeader()
  }
  goTo('')

  // Bulk indexing and folder copies fire a burst of watcher events; redraw
  // once when it settles rather than on every one (as tagsTree does).
  let refreshTimer: NodeJS.Timeout | undefined
  const debouncedRefresh = onVaultFsChange(() => {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      provider.refresh()
      // The view registers before the engine starts, so the first header was
      // drawn without a vault name to use. Pick it up once there is one.
      syncHeader()
    }, 300)
  })

  /**
   * Follow the active note: browse to its folder and select its row. Only
   * while the view is on screen — reveal() on a hidden view forces the whole
   * container open, which would yank the sidebar away from whatever the user
   * was looking at.
   */
  const follow = async (path: string | null): Promise<void> => {
    if (path === null || !treeView.visible) return
    const folder = parentOf(path)
    if (folder !== provider.currentFolder) goTo(folder)
    const row = await provider.rowFor(path)
    if (row) await treeView.reveal(row, { select: true, focus: false })
  }

  /** The folder a create command should act in: the row's, else where we are. */
  const folderFor = (arg: FilesNode | VaultPath | undefined): VaultPath => {
    if (typeof arg === 'string') return normalizeRel(arg)
    if (arg?.kind === 'folder') return normalizeRel(arg.path)
    return provider.currentFolder
  }

  /** Click the path row: pick a level of the path, and go there. */
  const goToLevel = async (): Promise<void> => {
    const levels = jumpTargets(breadcrumbSegments(provider.currentFolder, vaultName()))
    if (levels.length === 0) return
    const picked = await vscode.window.showQuickPick(
      levels.map((level) => ({
        label: level.label,
        description: level.path === '' ? 'vault root' : level.path,
        folder: level.path
      })),
      { title: 'Go back to…', matchOnDescription: true }
    )
    if (picked) goTo(picked.folder)
  }

  context.subscriptions.push(
    treeView,
    debouncedRefresh,
    {
      dispose: () => {
        if (refreshTimer) clearTimeout(refreshTimer)
      }
    },
    onActiveNoteChanged((path) => void follow(path)),
    // Catches up when the view is opened after the note was already active.
    treeView.onDidChangeVisibility((e) => {
      if (!e.visible) return
      syncHeader()
      void follow(currentActiveNoteRel())
    }),

    vscode.commands.registerCommand('knote.files.refresh', () => provider.refresh()),

    vscode.commands.registerCommand(OPEN_FOLDER_COMMAND, (folder?: VaultPath) => {
      goTo(folder ?? '')
    }),

    vscode.commands.registerCommand('knote.files.goUp', () => {
      goTo(parentOf(provider.currentFolder))
    }),

    vscode.commands.registerCommand(GO_TO_COMMAND, () => void goToLevel()),

    // What a drag-and-drop performs. A command rather than an inline handler
    // so the move — collision refusal and all — is reachable from a test.
    vscode.commands.registerCommand(
      'knote.files.move',
      async (paths: VaultPath[], folder: VaultPath) => {
        const entries = (await Promise.all(paths.map(statEntry))).filter(
          (entry): entry is FileEntry => entry !== null
        )
        await moveEntries(entries, normalizeRel(folder))
        provider.refresh()
      }
    ),

    vscode.commands.registerCommand(
      'knote.files.newNote',
      async (arg?: FilesNode | VaultPath, explicitName?: string) => {
        const folder = folderFor(arg)
        const name =
          explicitName ?? (await askName('Name of the new note', await siblingNames(folder)))
        if (!name) return
        const created = await vault.createFile(
          joinRel(folder, isMarkdown(name) ? name : `${name}.md`),
          ''
        )
        await vaultIndex.indexFile(created)
        provider.refresh()
        await openNoteInLiveEditor(uriForRel(created))
      }
    ),

    vscode.commands.registerCommand(
      'knote.files.newFolder',
      async (arg?: FilesNode | VaultPath, explicitName?: string) => {
        const parent = folderFor(arg)
        const name =
          explicitName ?? (await askName('Name of the new folder', await siblingNames(parent)))
        if (!name) return
        const created = await vault.createFolder(joinRel(parent, name))
        // Creating a folder is nearly always the first half of putting
        // something in it, so step inside rather than leaving the user to
        // find and click the row that just appeared.
        goTo(created)
      }
    ),

    vscode.commands.registerCommand(
      'knote.files.moveTo',
      async (arg?: FilesNode | VaultPath, explicitFolder?: VaultPath) => {
        const path = argPath(arg)
        if (path === undefined || path === '') return
        const entry = await statEntry(path)
        if (!entry) return
        let folder = explicitFolder === undefined ? undefined : normalizeRel(explicitFolder)
        if (folder === undefined) {
          const picked = await vscode.window.showQuickPick(
            moveTargets(entry, await allFolders(), vault.isMountRoot).map((target) => ({
              label: target === '' ? vaultName() : target,
              description: target === '' ? 'vault root' : undefined,
              target
            })),
            { title: `Move "${nameOf(path)}" to…`, matchOnDescription: true }
          )
          if (!picked) return
          folder = picked.target
        }
        await moveEntries([entry], folder)
        provider.refresh()
      }
    ),

    // The absolute path on this machine, with the platform's own separators —
    // what a terminal, a file dialog or another app expects.
    vscode.commands.registerCommand(
      'knote.files.copyPath',
      async (arg?: FilesNode | VaultPath | VaultPath[], selection?: readonly FilesNode[]) => {
        await copyPaths(argPaths(arg, selection).map((path) => uriForRel(path).fsPath))
      }
    ),

    // The vault-relative path, forward-slashed like every other path KNote
    // writes down — so it can be pasted straight into a `[[link]]`, an
    // `![](image)` or a `.knote/config.json` entry.
    vscode.commands.registerCommand(
      'knote.files.copyRelativePath',
      async (arg?: FilesNode | VaultPath | VaultPath[], selection?: readonly FilesNode[]) => {
        await copyPaths(argPaths(arg, selection))
      }
    ),

    vscode.commands.registerCommand(
      'knote.files.rename',
      async (arg?: FilesNode | VaultPath, explicitName?: string) => {
        const path = argPath(arg)
        if (path === undefined || path === '') return
        if (refuseMountRoot(path, 'renamed')) return
        const current = nameOf(path)
        const siblings = (await siblingNames(parentOf(path))).filter((s) => s !== current)
        // Pre-select just the base name, so typing replaces the title and
        // leaves the extension alone — how the Explorer's F2 behaves.
        const dot = current.lastIndexOf('.')
        const name =
          explicitName ??
          (await askName('New name', siblings, current, [0, dot > 0 ? dot : current.length]))
        if (!name || name === current) return
        const edit = new vscode.WorkspaceEdit()
        edit.renameFile(uriForRel(path), uriForRel(renamedPath(path, name)))
        await vscode.workspace.applyEdit(edit)
        provider.refresh()
      }
    ),

    vscode.commands.registerCommand(
      'knote.files.delete',
      async (arg?: FilesNode | VaultPath, skipConfirm?: boolean) => {
        const path = argPath(arg)
        if (path === undefined || path === '') return
        if (refuseMountRoot(path, 'deleted')) return
        if (skipConfirm !== true) {
          const choice = await vscode.window.showWarningMessage(
            `Move "${nameOf(path)}" to the trash?`,
            { modal: true, detail: 'You can restore it from your system trash.' },
            'Move to Trash'
          )
          if (choice !== 'Move to Trash') return
        }
        try {
          await vault.deleteEntry(path)
        } catch (err) {
          // OS-trash can reject outright on some OneDrive/network-backed
          // vault locations (sync lock, unsupported recycle-bin target) —
          // surface it instead of leaving the user staring at nothing, and
          // offer a way forward when trash just isn't available here.
          const message = err instanceof Error ? err.message : String(err)
          const choice = await vscode.window.showErrorMessage(
            `KNote: couldn't move "${nameOf(path)}" to the trash. ${message}`,
            'Delete Permanently'
          )
          if (choice !== 'Delete Permanently') return
          const confirm = await vscode.window.showWarningMessage(
            `Permanently delete "${nameOf(path)}"?`,
            { modal: true, detail: 'This bypasses the trash and cannot be undone.' },
            'Delete Permanently'
          )
          if (confirm !== 'Delete Permanently') return
          await vault.deleteEntryPermanently(path)
        }
        // Deleting the folder you're standing in would leave the view showing
        // a folder that no longer exists; step out to its parent.
        if (path === provider.currentFolder) goTo(parentOf(path))
        else provider.refresh()
      }
    )
  )
}
