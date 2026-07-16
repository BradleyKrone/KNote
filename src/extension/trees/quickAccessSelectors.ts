// Pure view-model for the activity-bar quick-access trees. No `vscode` import,
// so vitest can exercise the counting/grouping/ordering directly — the tree
// providers in quickAccess.ts only turn these into TreeItems.

import dayjs from 'dayjs'
import type { MachineDef, NoteMeta, VaultPath } from '@shared/types'
import { ARCHIVED_CHAR, DUE_RE, stripInlineMarkers } from '@shared/parser/patterns'

// ---------- Boards ----------

export interface NoteBoardNode {
  kind: 'note'
  path: VaultPath
  title: string
  /** Tasks not yet checked off */
  open: number
  /** Every task the board would show as a card */
  total: number
}

export interface BoardsModel {
  open: number
  total: number
  notes: NoteBoardNode[]
}

/** Tasks the Kanban board would show as cards — mirrors boardSelectors.collectCards. */
function boardTasks(meta: NoteMeta): NoteMeta['tasks'] {
  return meta.tasks.filter((t) => t.statusChar !== ARCHIVED_CHAR && !t.isSubtask)
}

function isDone(statusChar: string): boolean {
  return /^[xX]$/.test(statusChar)
}

/** Every note that has at least one board card, plus the whole-vault totals. */
export function collectBoards(notes: Map<string, NoteMeta>): BoardsModel {
  let open = 0
  let total = 0
  const out: NoteBoardNode[] = []
  for (const meta of notes.values()) {
    const tasks = boardTasks(meta)
    if (tasks.length === 0) continue
    const noteOpen = tasks.filter((t) => !isDone(t.statusChar)).length
    open += noteOpen
    total += tasks.length
    out.push({
      kind: 'note',
      path: meta.path,
      title: meta.title,
      open: noteOpen,
      total: tasks.length
    })
  }
  // Most live boards first; the ones with nothing open sink to the bottom.
  out.sort((a, b) => b.open - a.open || a.title.localeCompare(b.title))
  return { open, total, notes: out }
}

// ---------- Machines ----------

export interface MachineEntryNode {
  kind: 'entry'
  path: VaultPath
  noteTitle: string
  line: number
  text: string
  /** YYYY-MM-DD, or '' when the entry carries no 📅 date */
  date: string
}

export interface MachineNode {
  kind: 'machine'
  serial: string
  /** Model + attributes joined for display; 'unregistered' when not in the registry */
  config: string
  registered: boolean
  entries: MachineEntryNode[]
}

export interface MachinesModel {
  totalEntries: number
  machines: MachineNode[]
}

function entriesBySerial(notes: Map<string, NoteMeta>): Map<string, MachineEntryNode[]> {
  const bySerial = new Map<string, MachineEntryNode[]>()
  for (const meta of notes.values()) {
    for (const log of meta.machineLog) {
      const due = DUE_RE.exec(log.text)
      const list = bySerial.get(log.serial) ?? []
      list.push({
        kind: 'entry',
        path: meta.path,
        noteTitle: meta.title,
        line: log.line,
        text: stripInlineMarkers(log.text) || log.serial,
        date: due ? (due[1] ?? due[2]) : ''
      })
      bySerial.set(log.serial, list)
    }
  }
  // Newest work first; undated entries sort last.
  for (const list of bySerial.values()) {
    list.sort(
      (a, b) => (b.date || '').localeCompare(a.date || '') || a.noteTitle.localeCompare(b.noteTitle)
    )
  }
  return bySerial
}

/**
 * Registered machines first (in registry order), then any serial that only ever
 * showed up in a note — those are worth surfacing, not hiding, since a typo'd
 * serial is exactly what you want the tree to make obvious.
 */
export function collectMachines(
  notes: Map<string, NoteMeta>,
  registry: MachineDef[]
): MachinesModel {
  const bySerial = entriesBySerial(notes)
  const totalEntries = [...bySerial.values()].reduce((n, list) => n + list.length, 0)

  const machines: MachineNode[] = []
  const seen = new Set<string>()
  for (const def of registry) {
    if (seen.has(def.serial)) continue
    seen.add(def.serial)
    machines.push({
      kind: 'machine',
      serial: def.serial,
      config: [def.model, ...def.attributes].filter(Boolean).join(' · '),
      registered: true,
      entries: bySerial.get(def.serial) ?? []
    })
  }
  for (const serial of [...bySerial.keys()].sort()) {
    if (seen.has(serial)) continue
    machines.push({
      kind: 'machine',
      serial,
      config: 'unregistered',
      registered: false,
      entries: bySerial.get(serial) ?? []
    })
  }
  return { totalEntries, machines }
}

// ---------- Milestones ----------

export interface MilestoneNode {
  kind: 'milestone'
  path: VaultPath
  noteTitle: string
  line: number
  text: string
  date: string
}

/**
 * Dated 🏁 milestones, ordered the way you actually read a timeline: what's
 * coming (soonest first), then what's behind you (most recent first).
 */
export function collectMilestones(notes: Map<string, NoteMeta>, today: string): MilestoneNode[] {
  const upcoming: MilestoneNode[] = []
  const past: MilestoneNode[] = []
  for (const meta of notes.values()) {
    for (const milestone of meta.milestones) {
      const due = DUE_RE.exec(milestone.text)
      if (!due) continue
      const date = due[1] ?? due[2]
      const node: MilestoneNode = {
        kind: 'milestone',
        path: meta.path,
        noteTitle: meta.title,
        line: milestone.line,
        text: stripInlineMarkers(milestone.text) || meta.title,
        date
      }
      ;(date >= today ? upcoming : past).push(node)
    }
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date) || a.text.localeCompare(b.text))
  past.sort((a, b) => b.date.localeCompare(a.date) || a.text.localeCompare(b.text))
  return [...upcoming, ...past]
}

/** "today" / "in 3 days" / "2 weeks ago" — same tiering as the Timeline panel. */
export function relativeLabel(date: string, today: string): string {
  const days = dayjs(date).diff(dayjs(today), 'day')
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  const n = Math.abs(days)
  const [amount, unit] =
    n >= 30 ? [Math.round(n / 30), 'month'] : n >= 7 ? [Math.round(n / 7), 'week'] : [n, 'day']
  const plural = `${amount} ${unit}${amount === 1 ? '' : 's'}`
  return days < 0 ? `${plural} ago` : `in ${plural}`
}
