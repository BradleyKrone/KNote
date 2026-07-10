import { describe, expect, it } from 'vitest'
import type { NoteMeta } from '@shared/types'
import { parseNote } from '@shared/parser/parseNote'
import { buildGraph } from '@/graph/graphModel'

/** Build a notes Map by parsing each [path, content] pair (mtime fixed for determinism). */
function vault(...files: Array<[string, string]>): Map<string, NoteMeta> {
  const notes = new Map<string, NoteMeta>()
  for (const [path, content] of files) notes.set(path, parseNote(path, content, 1_700_000_000_000))
  return notes
}

const ALL = { showUnresolved: true, showOrphans: true }

describe('buildGraph', () => {
  it('creates a node per note and an edge per resolved link', () => {
    const notes = vault(['A.md', 'Links to [[B]]\n'], ['B.md', 'no links\n'])
    const { nodes, edges } = buildGraph(notes, ALL)
    expect(nodes.map((n) => n.id).sort()).toEqual(['A.md', 'B.md'])
    expect(edges).toEqual([{ source: 'A.md', target: 'B.md' }])
    expect(nodes.find((n) => n.id === 'A.md')?.degree).toBe(1)
    expect(nodes.find((n) => n.id === 'B.md')?.degree).toBe(1)
  })

  it('dedupes repeated and reciprocal links into one edge', () => {
    const notes = vault(['A.md', '[[B]] and again [[B]]\n'], ['B.md', 'back at [[A]]\n'])
    const { edges } = buildGraph(notes, ALL)
    expect(edges).toHaveLength(1)
  })

  it('ignores self-links', () => {
    const notes = vault(['A.md', '[[A]] links to itself\n'])
    const { edges } = buildGraph(notes, ALL)
    expect(edges).toHaveLength(0)
  })

  it('resolves links to notes in subfolders by title', () => {
    const notes = vault(['A.md', '[[Deep Note]]\n'], ['folder/Deep Note.md', '\n'])
    const { edges } = buildGraph(notes, ALL)
    expect(edges).toEqual([{ source: 'A.md', target: 'folder/Deep Note.md' }])
  })

  it('adds a faded ghost node for unresolved targets, merged case-insensitively', () => {
    const notes = vault(['A.md', '[[Missing]]\n'], ['B.md', '[[missing]]\n'])
    const { nodes, edges } = buildGraph(notes, ALL)
    const ghosts = nodes.filter((n) => n.unresolved)
    expect(ghosts).toHaveLength(1)
    expect(ghosts[0].path).toBeNull()
    expect(edges).toHaveLength(2)
  })

  it('omits unresolved targets when showUnresolved is off', () => {
    const notes = vault(['A.md', '[[Missing]]\n'])
    const { nodes, edges } = buildGraph(notes, { showUnresolved: false, showOrphans: true })
    expect(nodes).toHaveLength(1)
    expect(edges).toHaveLength(0)
  })

  it('filters unlinked notes when showOrphans is off', () => {
    const notes = vault(['A.md', '[[B]]\n'], ['B.md', '\n'], ['Lonely.md', 'nothing links here\n'])
    const { nodes } = buildGraph(notes, { showUnresolved: true, showOrphans: false })
    expect(nodes.map((n) => n.id).sort()).toEqual(['A.md', 'B.md'])
  })
})
