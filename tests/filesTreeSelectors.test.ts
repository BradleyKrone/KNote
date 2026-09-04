import { describe, expect, it } from 'vitest'
import type { FileEntry } from '@shared/types'
import {
  breadcrumbSegments,
  breadcrumbText,
  contextPaths,
  dropTargetFolder,
  folderRows,
  isDescendantOrSelf,
  jumpTargets,
  moveTargets,
  plannedMoves,
  renamedPath,
  validateName
} from '@ext/trees/filesTreeSelectors'

const folder = (path: string): FileEntry => ({
  path,
  name: path.split('/').pop()!,
  kind: 'folder'
})
const file = (path: string): FileEntry => ({ path, name: path.split('/').pop()!, kind: 'file' })

describe('breadcrumbSegments', () => {
  it('runs from the vault root down to the folder on screen', () => {
    expect(breadcrumbSegments('Clients/Acme/2026', 'MyVault')).toEqual([
      { label: 'MyVault', path: '', isCurrent: false },
      { label: 'Clients', path: 'Clients', isCurrent: false },
      { label: 'Acme', path: 'Clients/Acme', isCurrent: false },
      { label: '2026', path: 'Clients/Acme/2026', isCurrent: true }
    ])
  })

  it('is the vault root alone at the top level, and that is where we are', () => {
    expect(breadcrumbSegments('', 'MyVault')).toEqual([
      { label: 'MyVault', path: '', isCurrent: true }
    ])
  })

  it('marks exactly one segment as current', () => {
    const current = breadcrumbSegments('Clients/Acme', 'MyVault').filter((s) => s.isCurrent)
    expect(current).toEqual([{ label: 'Acme', path: 'Clients/Acme', isCurrent: true }])
  })
})

describe('breadcrumbText', () => {
  const trail = (folder: string): string => breadcrumbText(breadcrumbSegments(folder, 'MyVault'))

  it('reads as a path rooted in the vault’s own name', () => {
    expect(trail('')).toBe('MyVault')
    expect(trail('Clients')).toBe('MyVault / Clients')
    expect(trail('Clients/Acme/2026')).toBe('MyVault / Clients / Acme / 2026')
  })
})

describe('jumpTargets', () => {
  it('offers every level of the path except the one we are on', () => {
    expect(jumpTargets(breadcrumbSegments('Clients/Acme/2026', 'MyVault'))).toEqual([
      { label: 'MyVault', path: '', isCurrent: false },
      { label: 'Clients', path: 'Clients', isCurrent: false },
      { label: 'Acme', path: 'Clients/Acme', isCurrent: false }
    ])
  })

  it('has nowhere to offer at the vault root', () => {
    expect(jumpTargets(breadcrumbSegments('', 'MyVault'))).toEqual([])
  })
})

describe('folderRows', () => {
  it('puts one path row above the folder’s own contents', () => {
    expect(folderRows('Clients/Acme', [file('Clients/Acme/Notes.md')])).toEqual([
      { kind: 'path', path: 'Clients/Acme' },
      file('Clients/Acme/Notes.md')
    ])
  })

  it('shows contents alone at the vault root, where there is nowhere to go back to', () => {
    expect(folderRows('', [file('Root.md')])).toEqual([file('Root.md')])
  })
})

describe('dropTargetFolder', () => {
  it('drops into a folder that was dropped on', () => {
    expect(dropTargetFolder(folder('Clients/Acme'), '')).toBe('Clients/Acme')
  })

  it('drops beside a file, i.e. into its folder', () => {
    expect(dropTargetFolder(file('Clients/Acme/Notes.md'), 'Clients/Acme')).toBe('Clients/Acme')
    expect(dropTargetFolder(file('Root.md'), '')).toBe('')
  })

  it('drops into the folder on screen when nothing was under the cursor', () => {
    expect(dropTargetFolder(undefined, 'Clients/Acme')).toBe('Clients/Acme')
    expect(dropTargetFolder(undefined, '')).toBe('')
  })

  // The path row names the folder we're already in, so a drop there is a move
  // that goes nowhere rather than a move back out.
  it('treats a drop on the path row as the folder on screen', () => {
    expect(dropTargetFolder({ kind: 'path', path: 'Clients/Acme' }, 'Clients/Acme')).toBe(
      'Clients/Acme'
    )
  })
})

describe('isDescendantOrSelf', () => {
  it('counts a folder as inside itself', () => {
    expect(isDescendantOrSelf('Clients', 'Clients')).toBe(true)
  })

  it('counts a nested path as inside', () => {
    expect(isDescendantOrSelf('Clients/Acme/2026', 'Clients')).toBe(true)
  })

  it('does not treat a name-prefix match as containment', () => {
    expect(isDescendantOrSelf('Clients/Acme', 'Client')).toBe(false)
  })

  it('ignores case, so a Windows path cannot sneak past the guard', () => {
    expect(isDescendantOrSelf('clients/Acme', 'Clients')).toBe(true)
  })

  it('does not treat the vault root as containing everything', () => {
    expect(isDescendantOrSelf('Clients', '')).toBe(false)
  })
})

describe('plannedMoves', () => {
  it('moves an entry into the target folder, keeping its name', () => {
    expect(plannedMoves([file('Inbox/Idea.md')], 'Archive')).toEqual([
      { from: 'Inbox/Idea.md', to: 'Archive/Idea.md' }
    ])
  })

  it('moves to the vault root', () => {
    expect(plannedMoves([file('Inbox/Idea.md')], '')).toEqual([
      { from: 'Inbox/Idea.md', to: 'Idea.md' }
    ])
  })

  it('drops a move that would not go anywhere', () => {
    expect(plannedMoves([file('Inbox/Idea.md')], 'Inbox')).toEqual([])
    expect(plannedMoves([file('Root.md')], '')).toEqual([])
  })

  it('refuses to drop a folder into itself or its own subtree', () => {
    expect(plannedMoves([folder('Clients')], 'Clients')).toEqual([])
    expect(plannedMoves([folder('Clients')], 'Clients/Acme')).toEqual([])
  })

  it('still moves a folder into an unrelated folder with a shared name prefix', () => {
    expect(plannedMoves([folder('Client')], 'Clients')).toEqual([
      { from: 'Client', to: 'Clients/Client' }
    ])
  })

  it('keeps the movable entries when only some of a multi-selection are blocked', () => {
    expect(plannedMoves([folder('Clients'), file('Inbox/Idea.md')], 'Clients/Acme')).toEqual([
      { from: 'Inbox/Idea.md', to: 'Clients/Acme/Idea.md' }
    ])
  })
})

describe('moveTargets', () => {
  const everywhere = ['', 'Clients', 'Clients/Acme', 'Archive']

  it('offers every folder but the one the entry is already in', () => {
    expect(moveTargets(file('Clients/Idea.md'), everywhere)).toEqual([
      '',
      'Clients/Acme',
      'Archive'
    ])
  })

  it('offers the vault root, which is how something comes back out', () => {
    expect(moveTargets(file('Clients/Acme/Idea.md'), everywhere)).toContain('')
  })

  it('never offers a folder itself or its own subtree', () => {
    expect(moveTargets(folder('Clients'), everywhere)).toEqual(['Archive'])
  })
})

describe('contextPaths', () => {
  const clicked = file('Clients/Acme/Notes.md')

  it('acts on the clicked row when nothing else is selected', () => {
    expect(contextPaths(clicked, [clicked])).toEqual(['Clients/Acme/Notes.md'])
    expect(contextPaths(clicked)).toEqual(['Clients/Acme/Notes.md'])
  })

  it('acts on the whole selection when the clicked row is part of it', () => {
    expect(contextPaths(clicked, [clicked, folder('Archive')])).toEqual([
      'Clients/Acme/Notes.md',
      'Archive'
    ])
  })

  // Right-clicking outside the selection means "this one", not "those ones".
  it('acts on the clicked row alone when it sits outside the selection', () => {
    expect(contextPaths(clicked, [file('Other.md'), folder('Archive')])).toEqual([
      'Clients/Acme/Notes.md'
    ])
  })

  it('ignores the path row, which is a place rather than an entry', () => {
    expect(contextPaths({ kind: 'path', path: 'Clients/Acme' })).toEqual([])
    expect(contextPaths(clicked, [{ kind: 'path', path: 'Clients/Acme' }, clicked])).toEqual([
      'Clients/Acme/Notes.md'
    ])
  })

  it('has nothing to act on when invoked with no row at all', () => {
    expect(contextPaths(undefined)).toEqual([])
  })
})

describe('renamedPath', () => {
  it('swaps the last segment and keeps the folder', () => {
    expect(renamedPath('Clients/Acme/Notes.md', 'Meeting.md')).toBe('Clients/Acme/Meeting.md')
  })

  it('renames at the vault root', () => {
    expect(renamedPath('Notes.md', 'Meeting.md')).toBe('Meeting.md')
  })

  it('trims the name', () => {
    expect(renamedPath('Notes.md', '  Meeting.md  ')).toBe('Meeting.md')
  })
})

describe('validateName', () => {
  it('accepts an ordinary name', () => {
    expect(validateName('Meeting notes.md', ['Other.md'])).toBeNull()
  })

  it('rejects an empty or whitespace-only name', () => {
    expect(validateName('')).not.toBeNull()
    expect(validateName('   ')).not.toBeNull()
  })

  it('rejects path separators, so a name cannot become a path', () => {
    expect(validateName('a/b.md')).not.toBeNull()
    expect(validateName('a\\b.md')).not.toBeNull()
  })

  it('rejects a leading dot, which would hide the file from the vault', () => {
    expect(validateName('.hidden.md')).not.toBeNull()
  })

  it('rejects characters Windows refuses, so vaults stay portable', () => {
    expect(validateName('a:b.md')).not.toBeNull()
    expect(validateName('what?.md')).not.toBeNull()
  })

  it('rejects a name already taken, regardless of case', () => {
    expect(validateName('Notes.md', ['notes.md'])).not.toBeNull()
  })
})

describe('mounted folders are not movable', () => {
  const isMountRoot = (rel: string): boolean => rel === 'repo'

  it('drops a mount root from a planned move', () => {
    // Moving the row would move the real folder off its own path on disk.
    const moves = plannedMoves(
      [
        { path: 'repo', name: 'repo', kind: 'folder' },
        { path: 'Notes/A.md', name: 'A.md', kind: 'file' }
      ],
      'Archive',
      isMountRoot
    )
    expect(moves.map((m) => m.from)).toEqual(['Notes/A.md'])
  })

  it('offers no destination at all for a mount root', () => {
    const targets = moveTargets(
      { path: 'repo', name: 'repo', kind: 'folder' },
      ['', 'Notes', 'Archive'],
      isMountRoot
    )
    expect(targets).toEqual([])
  })

  it('still moves things from inside a mount', () => {
    const moves = plannedMoves(
      [{ path: 'repo/docs/A.md', name: 'A.md', kind: 'file' }],
      'Notes',
      isMountRoot
    )
    expect(moves).toEqual([{ from: 'repo/docs/A.md', to: 'Notes/A.md' }])
  })
})
