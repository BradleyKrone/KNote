// The vault link graph: canvas force-layout of notes and their wiki-link
// edges (built by graphModel.ts), with hover/click navigation.

import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { openWikiTarget, useIndexStore } from '@/stores/indexStore'
import { useUiStore } from '@/stores/uiStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { buildGraph, type GraphNode } from './graphModel'

/**
 * Connection map: force-directed graph of every note in the vault, edges
 * for resolved [[wiki-links]] between them (Obsidian's graph view). Custom
 * canvas simulation — no rendering/physics dependencies.
 */

interface SimNode {
  node: GraphNode
  x: number
  y: number
  vx: number
  vy: number
}

interface Transform {
  x: number
  y: number
  k: number
}

const MIN_ZOOM = 0.08
const MAX_ZOOM = 6
const REPULSION = 30000
const SPRING_LENGTH = 90
const SPRING_STIFFNESS = 0.04
const GRAVITY = 0.03
const FRICTION = 0.6
const ALPHA_DECAY = 0.988
const MIN_ALPHA = 0.02

function radiusOf(node: GraphNode): number {
  return 3.5 + Math.min(9, Math.sqrt(node.degree) * 1.6)
}

/** Deterministic pseudo-random in [0, 1) from a string, for seeding positions. */
function hash01(s: string, salt: number): number {
  let h = 2166136261 ^ salt
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

interface ThemeColors {
  node: string
  unresolved: string
  accent: string
  edge: string
  label: string
}

function readThemeColors(): ThemeColors {
  const s = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string): string => s.getPropertyValue(name).trim() || fallback
  return {
    node: v('--text-muted', '#999'),
    unresolved: v('--text-faint', '#666'),
    accent: v('--interactive-accent', '#7c3aed'),
    edge: v('--border-color', '#363636'),
    label: v('--text-normal', '#dadada')
  }
}

export function GraphView(): React.JSX.Element {
  const notes = useIndexStore((s) => s.notes)
  const setGraphOpen = useUiStore((s) => s.setGraphOpen)
  const activeNotePath = useWorkspaceStore((s) => s.note?.path ?? null)

  const [filter, setFilter] = useState('')
  const [showUnresolved, setShowUnresolved] = useState(true)
  const [showOrphans, setShowOrphans] = useState(true)

  const data = useMemo(
    () => buildGraph(notes, { showUnresolved, showOrphans }),
    [notes, showUnresolved, showOrphans]
  )

  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const simRef = useRef<Map<string, SimNode>>(new Map())
  const alphaRef = useRef(1)
  const transformRef = useRef<Transform>({ x: 0, y: 0, k: 1 })
  const fittedRef = useRef(false)
  const hoverRef = useRef<SimNode | null>(null)
  const dragRef = useRef<{
    kind: 'node' | 'pan'
    node?: SimNode
    lastX: number
    lastY: number
    moved: number
  } | null>(null)
  const colorsRef = useRef<ThemeColors>(readThemeColors())
  // Mirrored into refs so the rAF loop and window-level listeners see fresh values
  const dataRef = useRef(data)
  const filterRef = useRef(filter)
  const activePathRef = useRef(activeNotePath)
  filterRef.current = filter
  activePathRef.current = activeNotePath

  // Reconcile simulation nodes with graph data: keep positions of surviving
  // nodes, seed new ones near a linked neighbor (or on a deterministic ring).
  useEffect(() => {
    dataRef.current = data
    const prev = simRef.current
    const next = new Map<string, SimNode>()
    const seedRadius = 60 * Math.sqrt(Math.max(1, data.nodes.length))
    const neighborWithPos = (id: string): SimNode | undefined => {
      for (const e of data.edges) {
        const peer = e.source === id ? e.target : e.target === id ? e.source : null
        if (peer !== null) {
          const sim = next.get(peer) ?? prev.get(peer)
          if (sim) return sim
        }
      }
      return undefined
    }
    for (const node of data.nodes) {
      const old = prev.get(node.id)
      if (old) {
        old.node = node
        next.set(node.id, old)
        continue
      }
      const near = neighborWithPos(node.id)
      const angle = hash01(node.id, 1) * Math.PI * 2
      const r = near ? 30 : seedRadius * (0.3 + 0.7 * Math.sqrt(hash01(node.id, 2)))
      next.set(node.id, {
        node,
        x: (near?.x ?? 0) + Math.cos(angle) * r,
        y: (near?.y ?? 0) + Math.sin(angle) * r,
        vx: 0,
        vy: 0
      })
    }
    simRef.current = next
    alphaRef.current = 1
  }, [data])

  // Track theme switches so canvas colors follow the CSS variables
  useEffect(() => {
    const observer = new MutationObserver(() => {
      colorsRef.current = readThemeColors()
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  // Canvas sizing, simulation loop, and all pointer interaction
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const resize = (): void => {
      canvas.width = Math.max(1, container.clientWidth * dpr)
      canvas.height = Math.max(1, container.clientHeight * dpr)
      if (!fittedRef.current && container.clientWidth > 0) {
        // First layout: center the origin and zoom so the seeded cloud fits
        const seedRadius = 60 * Math.sqrt(Math.max(1, dataRef.current.nodes.length))
        const fit = Math.min(container.clientWidth, container.clientHeight) / (seedRadius * 2 + 120)
        transformRef.current = {
          x: container.clientWidth / 2,
          y: container.clientHeight / 2,
          k: Math.min(1, Math.max(MIN_ZOOM, fit))
        }
        fittedRef.current = true
      }
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(container)

    const toWorld = (sx: number, sy: number): { x: number; y: number } => {
      const t = transformRef.current
      return { x: (sx - t.x) / t.k, y: (sy - t.y) / t.k }
    }

    const nodeAt = (sx: number, sy: number): SimNode | null => {
      const { x, y } = toWorld(sx, sy)
      const t = transformRef.current
      let best: SimNode | null = null
      let bestD = Infinity
      for (const sim of simRef.current.values()) {
        const dx = sim.x - x
        const dy = sim.y - y
        const d = Math.sqrt(dx * dx + dy * dy)
        if (d < radiusOf(sim.node) + 4 / t.k && d < bestD) {
          best = sim
          bestD = d
        }
      }
      return best
    }

    const tick = (): void => {
      const alpha = alphaRef.current
      if (alpha < MIN_ALPHA) return
      const nodes = [...simRef.current.values()]
      const n = nodes.length
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = nodes[i]
          const b = nodes[j]
          let dx = b.x - a.x
          let dy = b.y - a.y
          let d2 = dx * dx + dy * dy
          if (d2 < 1) {
            // Coincident nodes: nudge apart deterministically
            dx = hash01(a.node.id, 3) - 0.5
            dy = hash01(b.node.id, 4) - 0.5
            d2 = dx * dx + dy * dy
          }
          const d = Math.sqrt(d2)
          const f = Math.min(12, (REPULSION * alpha) / d2)
          const fx = (dx / d) * f
          const fy = (dy / d) * f
          a.vx -= fx
          a.vy -= fy
          b.vx += fx
          b.vy += fy
        }
      }
      for (const e of dataRef.current.edges) {
        const a = simRef.current.get(e.source)
        const b = simRef.current.get(e.target)
        if (!a || !b) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.max(1, Math.sqrt(dx * dx + dy * dy))
        const f = (d - SPRING_LENGTH) * SPRING_STIFFNESS * alpha
        const fx = (dx / d) * f
        const fy = (dy / d) * f
        a.vx += fx
        a.vy += fy
        b.vx -= fx
        b.vy -= fy
      }
      const dragged = dragRef.current?.kind === 'node' ? dragRef.current.node : undefined
      for (const sim of nodes) {
        sim.vx -= sim.x * GRAVITY * alpha
        sim.vy -= sim.y * GRAVITY * alpha
        sim.vx *= FRICTION
        sim.vy *= FRICTION
        if (sim === dragged) continue
        sim.x += sim.vx
        sim.y += sim.vy
      }
      alphaRef.current = alpha * ALPHA_DECAY
    }

    const draw = (): void => {
      const t = transformRef.current
      const colors = colorsRef.current
      const hovered = hoverRef.current
      const filterText = filterRef.current.trim().toLowerCase()
      const activePath = activePathRef.current

      const neighbors = new Set<string>()
      if (hovered) {
        neighbors.add(hovered.node.id)
        for (const e of dataRef.current.edges) {
          if (e.source === hovered.node.id) neighbors.add(e.target)
          if (e.target === hovered.node.id) neighbors.add(e.source)
        }
      }
      const dimmed = (id: string, label: string): boolean => {
        if (hovered && !neighbors.has(id)) return true
        if (filterText !== '' && !label.toLowerCase().includes(filterText)) return true
        return false
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.setTransform(t.k * dpr, 0, 0, t.k * dpr, t.x * dpr, t.y * dpr)

      // Edges
      ctx.lineWidth = 1 / t.k
      for (const e of dataRef.current.edges) {
        const a = simRef.current.get(e.source)
        const b = simRef.current.get(e.target)
        if (!a || !b) continue
        const active =
          hovered !== null && (e.source === hovered.node.id || e.target === hovered.node.id)
        const dim =
          dimmed(e.source, a.node.label) || dimmed(e.target, b.node.label) ? 0.12 : active ? 0.9 : 0.45
        ctx.globalAlpha = dim
        ctx.strokeStyle = active ? colors.accent : colors.edge
        ctx.lineWidth = (active ? 1.8 : 1) / t.k
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }

      // Nodes
      for (const sim of simRef.current.values()) {
        const r = radiusOf(sim.node)
        const isHover = hovered === sim
        const isActive = activePath !== null && sim.node.path === activePath
        ctx.globalAlpha = dimmed(sim.node.id, sim.node.label)
          ? 0.15
          : sim.node.unresolved
            ? 0.45
            : 1
        ctx.fillStyle =
          isHover || isActive ? colors.accent : sim.node.unresolved ? colors.unresolved : colors.node
        ctx.beginPath()
        ctx.arc(sim.x, sim.y, r, 0, Math.PI * 2)
        ctx.fill()
      }

      // Labels (fade in as you zoom; always shown for the hover neighborhood)
      const zoomAlpha = Math.max(0, Math.min(1, (t.k - 0.35) / 0.3))
      ctx.font = `${12 / t.k}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      for (const sim of simRef.current.values()) {
        const inHoverSet = hovered !== null && neighbors.has(sim.node.id)
        let a = inHoverSet ? 1 : zoomAlpha
        if (dimmed(sim.node.id, sim.node.label)) a = Math.min(a, 0.1)
        if (a <= 0.01) continue
        ctx.globalAlpha = a * (sim.node.unresolved ? 0.6 : 0.85)
        ctx.fillStyle = colors.label
        ctx.fillText(sim.node.label, sim.x, sim.y + radiusOf(sim.node) + 4 / t.k)
      }
      ctx.globalAlpha = 1
    }

    let raf = 0
    const loop = (): void => {
      tick()
      draw()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const t = transformRef.current
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, t.k * Math.exp(-e.deltaY * 0.0015)))
      const wx = (mx - t.x) / t.k
      const wy = (my - t.y) / t.k
      transformRef.current = { x: mx - wx * k, y: my - wy * k, k }
    }

    const onMouseDown = (e: MouseEvent): void => {
      if (e.button !== 0) return
      const rect = canvas.getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      const hit = nodeAt(sx, sy)
      dragRef.current = hit
        ? { kind: 'node', node: hit, lastX: e.clientX, lastY: e.clientY, moved: 0 }
        : { kind: 'pan', lastX: e.clientX, lastY: e.clientY, moved: 0 }
    }

    const onMouseMove = (e: MouseEvent): void => {
      const rect = canvas.getBoundingClientRect()
      const drag = dragRef.current
      if (!drag) {
        hoverRef.current = nodeAt(e.clientX - rect.left, e.clientY - rect.top)
        canvas.style.cursor = hoverRef.current ? 'pointer' : 'grab'
        return
      }
      const dx = e.clientX - drag.lastX
      const dy = e.clientY - drag.lastY
      drag.lastX = e.clientX
      drag.lastY = e.clientY
      drag.moved += Math.abs(dx) + Math.abs(dy)
      if (drag.kind === 'pan') {
        transformRef.current = {
          ...transformRef.current,
          x: transformRef.current.x + dx,
          y: transformRef.current.y + dy
        }
      } else if (drag.node) {
        const w = toWorld(e.clientX - rect.left, e.clientY - rect.top)
        drag.node.x = w.x
        drag.node.y = w.y
        drag.node.vx = 0
        drag.node.vy = 0
        alphaRef.current = Math.max(alphaRef.current, 0.3)
      }
    }

    const onMouseUp = (e: MouseEvent): void => {
      const drag = dragRef.current
      dragRef.current = null
      if (!drag || drag.moved > 4) return
      const rect = canvas.getBoundingClientRect()
      const hit = nodeAt(e.clientX - rect.left, e.clientY - rect.top)
      if (!hit) return
      useUiStore.getState().setGraphOpen(false)
      if (hit.node.path !== null) {
        void useWorkspaceStore.getState().openFile(hit.node.path)
      } else {
        // Unresolved target: Obsidian behavior — create the note and open it
        void openWikiTarget(hit.node.label)
      }
    }

    const onMouseLeave = (): void => {
      if (!dragRef.current) hoverRef.current = null
    }

    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('mousedown', onMouseDown)
    canvas.addEventListener('mouseleave', onMouseLeave)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('mousedown', onMouseDown)
      canvas.removeEventListener('mouseleave', onMouseLeave)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  const noteCount = data.nodes.filter((n) => !n.unresolved).length

  return (
    <div className="graph-view">
      <div className="board-header">
        <div className="board-title">
          Graph
          <span className="board-scope">
            {noteCount} notes · {data.edges.length} links
          </span>
        </div>
        <div className="board-controls">
          <input
            className="panel-input small board-filter"
            placeholder="Highlight notes…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <label className="graph-toggle">
            <input
              type="checkbox"
              checked={showUnresolved}
              onChange={(e) => setShowUnresolved(e.target.checked)}
            />
            Unresolved
          </label>
          <label className="graph-toggle">
            <input
              type="checkbox"
              checked={showOrphans}
              onChange={(e) => setShowOrphans(e.target.checked)}
            />
            Orphans
          </label>
          <button className="icon-btn" title="Close graph" onClick={() => setGraphOpen(false)}>
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="graph-canvas-wrap" ref={containerRef}>
        <canvas className="graph-canvas" ref={canvasRef} />
        {data.nodes.length === 0 && (
          <div className="panel-empty graph-empty">
            No notes yet — the graph fills in as you create notes and connect them with{' '}
            <code>[[wiki-links]]</code>.
          </div>
        )}
      </div>
    </div>
  )
}
