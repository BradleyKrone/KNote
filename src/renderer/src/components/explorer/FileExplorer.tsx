// The vault file tree: expand/collapse folders, open notes, and
// create/rename/move/delete files via inline editing and context menu.

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, FilePlus2, FileText, FolderPlus, Image } from 'lucide-react'
import type { FileEntry, VaultPath } from '@shared/types'
import { isMarkdown, joinRel, parentOf, samePath, titleOf } from '@shared/pathUtils'
import { useVaultStore } from '@/stores/vaultStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useUiStore } from '@/stores/uiStore'
import { confirm } from '@/stores/confirmStore'
import { ContextMenu, type MenuItem } from '../ContextMenu'

interface MenuState {
  x: number
  y: number
  items: MenuItem[]
}

export function FileExplorer(): React.JSX.Element {
  const { vault, tree, refreshTree } = useVaultStore()
  const openFile = useWorkspaceStore((s) => s.openFile)
  const notePath = useWorkspaceStore((s) => s.note?.path ?? null)

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<VaultPath | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [dropTarget, setDropTarget] = useState<VaultPath | null>(null)

  const toggleFolder = (path: VaultPath): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const expandTo = (path: VaultPath): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      let parent = parentOf(path)
      while (parent) {
        next.add(parent)
        parent = parentOf(parent)
      }
      return next
    })
  }

  const createNote = useCallback(
    async (folder: VaultPath): Promise<void> => {
      const created = await window.knote.createFile(joinRel(folder, 'Untitled.md'), '')
      await refreshTree()
      expandTo(created)
      await openFile(created)
      setRenaming(created)
    },
    [openFile, refreshTree]
  )

  const createFolder = useCallback(
    async (folder: VaultPath): Promise<void> => {
      const created = await window.knote.createFolder(joinRel(folder, 'New folder'))
      await refreshTree()
      expandTo(created)
      setExpanded((prev) => new Set(prev).add(created))
      setRenaming(created)
    },
    [refreshTree]
  )

  const doRename = async (entry: FileEntry, rawName: string): Promise<void> => {
    setRenaming(null)
    let newName = rawName.trim()
    if (!newName) return
    if (entry.kind === 'file' && isMarkdown(entry.path) && !newName.toLowerCase().endsWith('.md')) {
      newName += '.md'
    }
    if (newName === entry.name) return
    try {
      const newPath = await window.knote.renameEntry(entry.path, newName)
      useWorkspaceStore.getState().pathChanged(entry.path, newPath)
      await refreshTree()
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err))
    }
  }

  const doDelete = async (entry: FileEntry): Promise<void> => {
    const label =
      entry.kind === 'folder' ? `folder "${entry.name}" and its contents` : `"${entry.name}"`
    if (!(await confirm(`Move ${label} to the system trash?`, { danger: true }))) return
    await window.knote.deleteEntry(entry.path)
    useWorkspaceStore.getState().closeTabsForPath(entry.path)
    await refreshTree()
  }

  const doMove = async (source: VaultPath, targetFolder: VaultPath): Promise<void> => {
    setDropTarget(null)
    if (samePath(parentOf(source), targetFolder) || samePath(source, targetFolder)) return
    try {
      const newPath = await window.knote.moveEntry(source, targetFolder)
      useWorkspaceStore.getState().pathChanged(source, newPath)
      await refreshTree()
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err))
    }
  }

  const entryMenu = (e: React.MouseEvent, entry: FileEntry): void => {
    e.preventDefault()
    e.stopPropagation()
    const items: MenuItem[] = []
    if (entry.kind === 'folder') {
      items.push(
        { label: 'New note', onClick: () => void createNote(entry.path) },
        { label: 'New folder', onClick: () => void createFolder(entry.path) },
        {
          label: 'Open board for folder',
          onClick: () => useUiStore.getState().openBoard({ kind: 'folder', path: entry.path })
        }
      )
    } else if (isMarkdown(entry.path)) {
      items.push(
        {
          label: 'Open board for note',
          onClick: () => useUiStore.getState().openBoard({ kind: 'note', path: entry.path })
        },
        {
          label: 'Split vertically',
          onClick: () => void useWorkspaceStore.getState().openInSplit(entry.path, 'vertical')
        }
      )
    }
    items.push(
      { label: 'Rename', onClick: () => setRenaming(entry.path) },
      { label: 'Delete', danger: true, onClick: () => void doDelete(entry) }
    )
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  const rootMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'New note', onClick: () => void createNote('') },
        { label: 'New folder', onClick: () => void createFolder('') }
      ]
    })
  }

  const renderEntry = (entry: FileEntry, depth: number): React.JSX.Element => {
    const isFolder = entry.kind === 'folder'
    const isOpen = expanded.has(entry.path)
    const isActive = notePath !== null && samePath(entry.path, notePath)
    const isRenaming = renaming !== null && samePath(entry.path, renaming)

    return (
      <div key={entry.path}>
        <div
          className={[
            'tree-row',
            isActive ? 'active' : '',
            dropTarget !== null && samePath(dropTarget, entry.path) ? 'drop-target' : ''
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ paddingLeft: 8 + depth * 14 }}
          draggable={!isRenaming}
          onClick={() => {
            if (isFolder) toggleFolder(entry.path)
            else if (isMarkdown(entry.path)) void openFile(entry.path)
          }}
          onContextMenu={(e) => entryMenu(e, entry)}
          onDragStart={(e) => {
            e.dataTransfer.setData('application/knote-path', entry.path)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragOver={(e) => {
            if (isFolder && e.dataTransfer.types.includes('application/knote-path')) {
              e.preventDefault()
              e.stopPropagation()
              setDropTarget(entry.path)
            }
          }}
          onDragLeave={() => {
            if (dropTarget !== null && samePath(dropTarget, entry.path)) setDropTarget(null)
          }}
          onDrop={(e) => {
            if (!isFolder) return
            e.preventDefault()
            e.stopPropagation()
            const source = e.dataTransfer.getData('application/knote-path')
            if (source) void doMove(source, entry.path)
          }}
        >
          {isFolder ? (
            <span className="tree-icon">
              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
          ) : (
            <span className="tree-icon file-icon">
              {isMarkdown(entry.path) ? <FileText size={14} /> : <Image size={14} />}
            </span>
          )}
          {isRenaming ? (
            <RenameInput
              initial={isFolder ? entry.name : titleOf(entry.path)}
              onDone={(name) => void doRename(entry, name)}
              onCancel={() => setRenaming(null)}
            />
          ) : (
            <span className="tree-label">{isFolder ? entry.name : titleOf(entry.path)}</span>
          )}
        </div>
        {isFolder && isOpen && entry.children && (
          <div>{entry.children.map((child) => renderEntry(child, depth + 1))}</div>
        )}
      </div>
    )
  }

  return (
    <div className="file-explorer">
      <div className="explorer-header">
        <span className="vault-name" title={vault?.root}>
          {vault?.name}
        </span>
        <div className="explorer-actions">
          <button className="icon-btn" title="New note" onClick={() => void createNote('')}>
            <FilePlus2 size={15} />
          </button>
          <button className="icon-btn" title="New folder" onClick={() => void createFolder('')}>
            <FolderPlus size={15} />
          </button>
        </div>
      </div>
      <div
        className={`tree-root${dropTarget === '' ? ' drop-target' : ''}`}
        onContextMenu={rootMenu}
        onDragOver={(e) => {
          if (
            e.target === e.currentTarget &&
            e.dataTransfer.types.includes('application/knote-path')
          ) {
            e.preventDefault()
            setDropTarget('')
          }
        }}
        onDrop={(e) => {
          if (e.target !== e.currentTarget) return
          e.preventDefault()
          const source = e.dataTransfer.getData('application/knote-path')
          if (source) void doMove(source, '')
        }}
      >
        {tree.map((entry) => renderEntry(entry, 0))}
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}

function RenameInput({
  initial,
  onDone,
  onCancel
}: {
  initial: string
  onDone: (name: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(initial)
  const finished = useRef(false)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const finish = (commit: boolean): void => {
    if (finished.current) return
    finished.current = true
    if (commit) onDone(value)
    else onCancel()
  }

  return (
    <input
      ref={ref}
      className="rename-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(true)
        if (e.key === 'Escape') finish(false)
      }}
    />
  )
}
