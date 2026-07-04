import dayjs from 'dayjs'
import type { MachineDef, NoteMeta, VaultPath } from '@shared/types'
import { DUE_RE } from '@shared/parser/patterns'
import { stripInlineMarkers } from '@/board/boardSelectors'

/**
 * The Machine Log joins two sources:
 *  - 🚜 entries → a dated record of work done on one machine, parsed from notes (NoteMeta.machineLog)
 *  - the registry → serial → configuration, registered in Settings (VaultConfig.machines), NOT parsed from notes
 *
 * Each entry is joined to its machine's registry config so it can be filtered
 * by serial, by any config attribute (model/LGP/…), or by an inline #tag.
 */

export interface MachineEntry {
  date: string // YYYY-MM-DD
  serial: string
  /** Activity text with due/tag markers stripped, for display */
  text: string
  /** Inline #tags written on the entry line */
  tags: string[]
  /** From the registry: model ('' if unregistered) */
  model: string
  /** From the registry: config attributes ([] if unregistered) */
  attributes: string[]
  /** Whether this serial has a registry definition */
  registered: boolean
  path: VaultPath
  noteTitle: string
  line: number
}

export interface MachineFilters {
  serial: string | null
  /** Matches inline tags AND/OR config attributes/model — every entry here must match (AND) */
  tags: string[]
  text: string
}

const NO_FILTERS: MachineFilters = { serial: null, tags: [], text: '' }

/** Build the serial → definition registry from the vault's registered machines (last wins on duplicate serials). */
export function buildRegistry(machines: MachineDef[]): Map<string, MachineDef> {
  const registry = new Map<string, MachineDef>()
  for (const def of machines) registry.set(def.serial, def)
  return registry
}

/** All config codes (model + attributes) a definition contributes, for tag matching/filters/auto-insertion. */
export function configCodes(def: MachineDef | undefined): string[] {
  if (!def) return []
  return [def.model, ...def.attributes].filter(Boolean)
}

function matchesFilters(entry: MachineEntry, filters: MachineFilters): boolean {
  if (filters.serial && entry.serial !== filters.serial) return false
  if (filters.tags.length > 0) {
    const haystack = [...entry.tags, entry.model, ...entry.attributes].filter(Boolean)
    const matchesAll = filters.tags.every((tag) =>
      haystack.some((t) => t === tag || t.startsWith(tag + '/'))
    )
    if (!matchesAll) return false
  }
  if (filters.text) {
    const q = filters.text.toLowerCase()
    if (!entry.text.toLowerCase().includes(q) && !entry.serial.toLowerCase().includes(q))
      return false
  }
  return true
}

/**
 * All machine-log entries, joined to the registry and filtered, sorted most
 * recent first (a work history reads best newest-first).
 */
export function collectMachineEntries(
  notes: Map<string, NoteMeta>,
  machines: MachineDef[],
  filters: MachineFilters = NO_FILTERS
): MachineEntry[] {
  const registry = buildRegistry(machines)
  const entries: MachineEntry[] = []
  for (const meta of notes.values()) {
    for (const item of meta.machineLog) {
      const due = DUE_RE.exec(item.text)
      const date = due ? (due[1] ?? due[2]) : dayjs(meta.mtimeMs).format('YYYY-MM-DD')
      const def = registry.get(item.serial)
      const entry: MachineEntry = {
        date,
        serial: item.serial,
        text: stripInlineMarkers(item.text) || item.serial,
        tags: item.tags,
        model: def?.model ?? '',
        attributes: def?.attributes ?? [],
        registered: def !== undefined,
        path: meta.path,
        noteTitle: meta.title,
        line: item.line
      }
      if (matchesFilters(entry, filters)) entries.push(entry)
    }
  }
  entries.sort((a, b) => b.date.localeCompare(a.date) || a.serial.localeCompare(b.serial))
  return entries
}

export interface MachineGroup {
  serial: string
  def: MachineDef | undefined
  entries: MachineEntry[]
}

/** Group entries by serial, each group carrying its registry definition, serials sorted. */
export function groupBySerial(
  entries: MachineEntry[],
  registry: Map<string, MachineDef>
): MachineGroup[] {
  const bySerial = new Map<string, MachineEntry[]>()
  for (const entry of entries) {
    const list = bySerial.get(entry.serial) ?? []
    list.push(entry)
    bySerial.set(entry.serial, list)
  }
  return [...bySerial.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([serial, list]) => ({ serial, def: registry.get(serial), entries: list }))
}

/** Distinct serials known to the vault (from logged entries and the registry), sorted, for the filter dropdown. */
export function machineSerials(notes: Map<string, NoteMeta>, machines: MachineDef[]): string[] {
  const serials = new Set<string>()
  for (const meta of notes.values()) {
    for (const item of meta.machineLog) serials.add(item.serial)
  }
  for (const def of machines) serials.add(def.serial)
  return [...serials].sort()
}

/** Distinct filterable tags/attributes: inline entry tags plus every registered config code. */
export function machineFilterTags(notes: Map<string, NoteMeta>, machines: MachineDef[]): string[] {
  const tags = new Set<string>()
  for (const meta of notes.values()) {
    for (const item of meta.machineLog) for (const t of item.tags) tags.add(t)
  }
  for (const def of machines) for (const c of configCodes(def)) tags.add(c)
  return [...tags].sort()
}
