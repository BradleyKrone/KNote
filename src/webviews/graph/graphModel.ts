import type { NoteMeta, VaultPath } from '@shared/types'
import { normalizeRel } from '@shared/pathUtils'
import { resolveTarget } from '@shared/wikiResolve'

/**
 * Graph model for the connection map view: one node per note (plus optional
 * ghost nodes for unresolved link targets), one edge per linked note pair.
 * Pure data — simulation/rendering state lives in GraphApp.
 */

export interface GraphNode {
  /** Note path, or `unresolved:<target>` for ghost nodes. */
  id: string
  /** Vault path for real notes, null for unresolved targets. */
  path: VaultPath | null
  label: string
  unresolved: boolean
  /** Number of edges touching this node (drives node size). */
  degree: number
}

export interface GraphEdge {
  source: string
  target: string
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface GraphOptions {
  /** Show ghost nodes for [[links]] that don't resolve to a note yet. */
  showUnresolved: boolean
  /** Show notes with no links in or out. */
  showOrphans: boolean
}

export function buildGraph(notes: Map<string, NoteMeta>, opts: GraphOptions): GraphData {
  const nodes = new Map<string, GraphNode>()
  const edges: GraphEdge[] = []
  const seenEdges = new Set<string>()

  for (const meta of notes.values()) {
    nodes.set(meta.path, {
      id: meta.path,
      path: meta.path,
      label: meta.title,
      unresolved: false,
      degree: 0
    })
  }

  const addEdge = (a: string, b: string): void => {
    const key = a < b ? `${a} ${b}` : `${b} ${a}`
    if (seenEdges.has(key)) return
    seenEdges.add(key)
    edges.push({ source: a, target: b })
    const na = nodes.get(a)
    const nb = nodes.get(b)
    if (na) na.degree++
    if (nb) nb.degree++
  }

  for (const meta of notes.values()) {
    for (const link of meta.links) {
      const target = link.target.trim()
      if (target === '') continue
      const resolved = resolveTarget(target, notes)
      if (resolved !== null) {
        if (resolved !== meta.path) addEdge(meta.path, resolved)
      } else if (opts.showUnresolved) {
        const id = `unresolved:${normalizeRel(target).toLowerCase()}`
        if (!nodes.has(id)) {
          nodes.set(id, { id, path: null, label: target, unresolved: true, degree: 0 })
        }
        addEdge(meta.path, id)
      }
    }
  }

  let out = [...nodes.values()]
  if (!opts.showOrphans) {
    out = out.filter((n) => n.degree > 0)
  }
  return { nodes: out, edges }
}
