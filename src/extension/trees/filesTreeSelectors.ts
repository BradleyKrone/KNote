// Pure path logic for the Files view. No `vscode` import, so vitest can
// exercise the navigation/drop/rename rules directly — filesTree.ts only
// turns these into TreeItems and WorkspaceEdits.

import type { FileEntry, VaultPath } from '@shared/types'
import { joinRel, nameOf, normalizeRel, parentOf, samePath } from '@shared/pathUtils'

/**
 * The one row in the view that isn't a file or folder on disk: the path from
 * the vault root down to the folder on screen, which doubles as the way back
 * out — clicking it offers every level above as a jump target. One row, not
 * one per level, so the list stays as short as the folder you're in. `path` is
 * the folder being shown.
 */
export interface PathRow {
  kind: 'path'
  path: VaultPath
}

export type FilesNode = FileEntry | PathRow

/**
 * Where a drop lands. Dropping *onto* a folder means "into it"; onto a file,
 * onto the path row, or onto empty space below the list, means the folder
 * currently being shown. (The path row names that same folder, so a drop there
 * is a move that goes nowhere — moving something *out* is what
 * `knote.files.moveTo` is for, since no row for the parent is listed.)
 */
export function dropTargetFolder(
  target: FilesNode | undefined,
  currentFolder: VaultPath
): VaultPath {
  if (!target || target.kind === 'path') return normalizeRel(currentFolder)
  if (target.kind === 'file') return parentOf(target.path)
  return normalizeRel(target.path)
}

/**
 * True if `path` is `folder` itself or sits under it. Deliberately not
 * `pathUtils.isInside`: that treats `''` as containing everything (right for
 * "is this note in the vault", wrong here, where `''` is a real drop target),
 * and compares case-sensitively, which would let a Windows user drag a folder
 * into its own subtree via a differently-cased path.
 */
export function isDescendantOrSelf(path: string, folder: string): boolean {
  const p = normalizeRel(path).toLowerCase()
  const f = normalizeRel(folder).toLowerCase()
  return p === f || p.startsWith(`${f}/`)
}

export interface PlannedMove {
  from: VaultPath
  to: VaultPath
}

/**
 * The moves a drop should actually perform. Two kinds are dropped silently
 * rather than reported as errors, because both are things a user does by
 * accident mid-drag rather than mistakes worth a dialog:
 *  - an entry already sitting in the target folder (a drag that went nowhere)
 *  - a folder dropped into itself or its own subtree (which would otherwise
 *    ask the filesystem to swallow its own tail)
 *  - a mounted folder, which belongs to the workspace rather than to the vault:
 *    moving one would drag the whole external folder in off its real path.
 */
export function plannedMoves(
  sources: readonly FileEntry[],
  targetFolder: VaultPath,
  isMountRoot: (rel: VaultPath) => boolean = () => false
): PlannedMove[] {
  const folder = normalizeRel(targetFolder)
  const out: PlannedMove[] = []
  for (const source of sources) {
    const from = normalizeRel(source.path)
    if (isMountRoot(from)) continue
    if (samePath(parentOf(from), folder)) continue
    if (source.kind === 'folder' && isDescendantOrSelf(folder, from)) continue
    out.push({ from, to: joinRel(folder, nameOf(from)) })
  }
  return out
}

/**
 * The folders an entry can actually be moved into: everywhere in the vault
 * except the moves `plannedMoves` would silently refuse — the folder it
 * already sits in, and (for a folder) itself and its own subtree. Asked of
 * `plannedMoves` rather than re-derived, so a picker can never offer a
 * destination that would then do nothing.
 */
export function moveTargets(
  source: FileEntry,
  folders: readonly VaultPath[],
  isMountRoot: (rel: VaultPath) => boolean = () => false
): VaultPath[] {
  return folders
    .map(normalizeRel)
    .filter((folder) => plannedMoves([source], folder, isMountRoot).length > 0)
}

/**
 * The rows a context-menu command should act on, given what VS Code hands it:
 * the row that was clicked, and the view's whole selection. Multi-select
 * commands use the selection — but only when the clicked row is part of it,
 * because right-clicking *outside* the selection means "this one", not "those
 * ones". The path row is dropped: it names a place, not an entry on disk.
 */
export function contextPaths(
  clicked: FilesNode | undefined,
  selection: readonly FilesNode[] = []
): VaultPath[] {
  const clickedPath = clicked && clicked.kind !== 'path' ? normalizeRel(clicked.path) : undefined
  const selected = selection
    .filter((node) => node.kind !== 'path')
    .map((node) => normalizeRel(node.path))
  if (clickedPath !== undefined && !selected.includes(clickedPath)) return [clickedPath]
  return selected
}

/** The path an entry takes on when renamed in place. */
export function renamedPath(oldPath: VaultPath, newName: string): VaultPath {
  return joinRel(parentOf(oldPath), newName.trim())
}

/**
 * Validation for a new or renamed entry name, as the message to show, or null
 * when the name is fine. `siblings` is what already sits in the folder; a name
 * matching case-insensitively is rejected because the filesystems KNote runs
 * on mostly can't tell those apart anyway.
 */
export function validateName(name: string, siblings: readonly string[] = []): string | null {
  const trimmed = name.trim()
  if (trimmed === '') return 'Name cannot be empty'
  if (/[\\/]/.test(trimmed)) return 'Name cannot contain a slash'
  if (trimmed === '.' || trimmed === '..') return 'Not a valid name'
  if (trimmed.startsWith('.')) return 'Names starting with "." are hidden from the vault'
  // The characters Windows refuses outright; harmless to reject everywhere so
  // a vault stays portable between machines.
  if (/[:*?"<>|]/.test(trimmed)) return 'Name cannot contain : * ? " < > |'
  if (siblings.some((s) => s.toLowerCase() === trimmed.toLowerCase())) {
    return `"${trimmed}" already exists here`
  }
  return null
}

/**
 * One step of the path shown above the list: a folder you are currently
 * inside, or — for the last one — the folder on screen itself. `path` is where
 * clicking it goes.
 */
export interface CrumbSegment {
  label: string
  path: VaultPath
  /** True for the folder being shown, which is not a link: you're already there. */
  isCurrent: boolean
}

/**
 * The trail from the vault root down to the folder on screen. Always at least
 * one segment — the root, which reads as the vault's own name rather than as
 * an empty string.
 */
export function breadcrumbSegments(folder: VaultPath, rootLabel: string): CrumbSegment[] {
  const rel = normalizeRel(folder)
  const names = rel === '' ? [] : rel.split('/')
  return [
    { label: rootLabel, path: '', isCurrent: names.length === 0 },
    ...names.map((name, i) => ({
      label: name,
      path: names.slice(0, i + 1).join('/'),
      isCurrent: i === names.length - 1
    }))
  ]
}

/** The trail as one line: `MyVault / Clients / Acme`. */
export function breadcrumbText(segments: readonly CrumbSegment[]): string {
  return segments.map((segment) => segment.label).join(' / ')
}

/**
 * The levels the path row can jump to: everywhere in the trail except where we
 * already are, outermost first.
 */
export function jumpTargets(segments: readonly CrumbSegment[]): CrumbSegment[] {
  return segments.filter((segment) => !segment.isCurrent)
}

/**
 * The rows to show for a folder: the path row, then the folder's own contents
 * in the order readDir gave them (folders first). At the vault root there is
 * no path row — there is nowhere further out to go, and the vault's own name
 * is already on the line above the list.
 */
export function folderRows(folder: VaultPath, contents: readonly FileEntry[]): FilesNode[] {
  const rel = normalizeRel(folder)
  return rel === '' ? [...contents] : [{ kind: 'path', path: rel }, ...contents]
}
