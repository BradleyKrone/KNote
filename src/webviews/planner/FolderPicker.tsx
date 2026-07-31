// An Explorer-style folder browser for "where does this note go".
//
// Walks one level at a time off the note paths already in the index — no host
// round trip, no whole-tree render — with a clickable breadcrumb back up. The
// folder you're *in* is the folder you're choosing, which is how a Save-As
// dialog behaves and avoids the "did I select it or just open it?" ambiguity
// of a tree with separate selection.

import { useMemo, useState } from 'react'
import { ChevronRight, CornerLeftUp, FileText, Folder, FolderPlus } from 'lucide-react'
import { childFolders, notesInFolder } from './plannerSelectors'

interface Props {
  /** Every folder in the vault, as full paths. */
  folders: readonly string[]
  /** Every note path, for the greyed-out file rows that give the listing context. */
  notePaths: readonly string[]
  value: string
  onChange: (folder: string) => void
}

const ROOT_LABEL = 'Vault'

export function FolderPicker({ folders, notePaths, value, onChange }: Props): React.JSX.Element {
  const [newName, setNewName] = useState<string | null>(null)

  // Folders the user invented in this dialog don't exist on disk yet (they're
  // created with the note), so they're kept alongside the real ones to browse.
  const [pending, setPending] = useState<string[]>([])
  const all = useMemo(
    () => [...new Set([...folders, ...pending])].sort((a, b) => a.localeCompare(b)),
    [folders, pending]
  )

  const children = useMemo(() => childFolders(all, value), [all, value])
  const files = useMemo(() => notesInFolder(notePaths, value), [notePaths, value])

  const segments = value ? value.split('/') : []
  const parent = segments.slice(0, -1).join('/')

  const addFolder = (): void => {
    const name = (newName ?? '').trim().replace(/[\\/]/g, '')
    setNewName(null)
    if (!name) return
    const path = value ? `${value}/${name}` : name
    setPending((prev) => [...prev, path])
    onChange(path)
  }

  return (
    <div className="folder-picker">
      <div className="folder-crumbs">
        <button
          className={`folder-crumb${value === '' ? ' current' : ''}`}
          onClick={() => onChange('')}
        >
          {ROOT_LABEL}
        </button>
        {segments.map((segment, i) => {
          const path = segments.slice(0, i + 1).join('/')
          return (
            <span key={path} className="folder-crumb-group">
              <ChevronRight size={11} className="folder-crumb-sep" />
              <button
                className={`folder-crumb${path === value ? ' current' : ''}`}
                onClick={() => onChange(path)}
              >
                {segment}
              </button>
            </span>
          )
        })}
      </div>

      <div className="folder-list">
        {value !== '' && (
          <button className="folder-row up" onClick={() => onChange(parent)}>
            <CornerLeftUp size={13} />
            <span className="folder-row-label">..</span>
          </button>
        )}
        {children.map((folder) => (
          <button key={folder} className="folder-row" onClick={() => onChange(folder)}>
            <Folder size={13} />
            <span className="folder-row-label">{folder.slice(folder.lastIndexOf('/') + 1)}</span>
            <ChevronRight size={12} className="folder-row-chevron" />
          </button>
        ))}
        {files.map((file) => (
          <div key={file} className="folder-row file" aria-disabled="true">
            <FileText size={13} />
            <span className="folder-row-label">{file}</span>
          </div>
        ))}
        {children.length === 0 && files.length === 0 && (
          <div className="folder-row empty">This folder is empty</div>
        )}
      </div>

      {newName === null ? (
        <button className="folder-new" onClick={() => setNewName('')}>
          <FolderPlus size={13} /> New folder here
        </button>
      ) : (
        <input
          className="panel-input small folder-new-input"
          autoFocus
          placeholder="Folder name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onBlur={addFolder}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addFolder()
            }
            if (e.key === 'Escape') {
              // Backs out of naming a folder, not out of the whole dialog.
              e.stopPropagation()
              setNewName(null)
            }
          }}
        />
      )}

      <div className="folder-picker-target">
        Saving to <strong>{value ? `${ROOT_LABEL}/${value}` : ROOT_LABEL}</strong>
      </div>
    </div>
  )
}
