import { describe, expect, it } from 'vitest'
import {
  addDays,
  dateToX,
  diffDays,
  domainOf,
  flattenRows,
  gridWidth,
  GROUP_GAP,
  monthBands,
  pxToDays,
  PX_PER_DAY,
  rowCenter,
  rowIndexById,
  rowsHeight,
  rowTops,
  ROW_HEIGHT,
  subBands,
  xToDate,
  type Zoom
} from '@/planner/plannerLayout'
import { buildPlannerModel } from '@/planner/plannerSelectors'
import { parseNote } from '@shared/parser/parseNote'
import type { NoteMeta } from '@shared/types'

const ZOOMS: Zoom[] = ['day', 'week', 'month']

const notes = new Map<string, NoteMeta>()
notes.set(
  'P.md',
  parseNote(
    'P.md',
    [
      '---',
      'type: project',
      'project: p',
      '---',
      '- [ ] A 🛫 2026-04-01 📅 2026-04-10 #deliverable/p/a',
      '    - [ ] a task #deliverable/p/a',
      '- [ ] B 🛫 2026-04-11 📅 2026-04-30 #deliverable/p/b ⛓ #deliverable/p/a',
      '🏁 Kickoff 📅 2026-04-02 #deliverable/p/a',
      ''
    ].join('\n')
  )
)
const model = buildPlannerModel(notes)

describe('date helpers', () => {
  it('adds and diffs whole days across a DST boundary', () => {
    // US DST starts 2026-03-08 — day arithmetic must not lose or gain an hour.
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08')
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09')
    expect(diffDays('2026-03-07', '2026-03-09')).toBe(2)
  })

  it('crosses year boundaries', () => {
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01')
    expect(diffDays('2025-12-30', '2026-01-02')).toBe(3)
  })
})

describe('domainOf', () => {
  it('pads the scheduled range and always contains today', () => {
    const domain = domainOf(model, '2026-04-15')
    expect(domain.start).toBe('2026-03-18') // 14 days before the earliest date (the milestone/start)
    expect(domain.end).toBe('2026-05-30') // 30 days after the latest end
    expect(domain.days).toBe(diffDays(domain.start, domain.end) + 1)
  })

  it('stretches to include a today far outside the schedule', () => {
    const domain = domainOf(model, '2027-01-01')
    expect(domain.end).toBe('2027-01-31')
  })

  it('still produces a usable domain for an empty vault', () => {
    const empty = domainOf(buildPlannerModel(new Map()), '2026-04-15')
    expect(empty.days).toBe(45)
  })
})

describe('dateToX / xToDate', () => {
  const domain = domainOf(model, '2026-04-15')

  it('round-trips a date through pixels at every zoom', () => {
    for (const zoom of ZOOMS) {
      for (const date of ['2026-03-18', '2026-04-01', '2026-04-30', '2026-05-30']) {
        expect(xToDate(domain, dateToX(domain, date, zoom), zoom)).toBe(date)
      }
    }
  })

  it('puts the domain start at x=0 and scales by px/day', () => {
    expect(dateToX(domain, domain.start, 'day')).toBe(0)
    expect(dateToX(domain, addDays(domain.start, 10), 'day')).toBe(10 * PX_PER_DAY.day)
  })

  it('sizes the grid to the whole domain', () => {
    expect(gridWidth(domain, 'week')).toBeCloseTo(domain.days * PX_PER_DAY.week)
  })

  it('quantizes a pixel drag to whole days, rounding at the half day', () => {
    expect(pxToDays(PX_PER_DAY.day * 2, 'day')).toBe(2)
    expect(pxToDays(PX_PER_DAY.day * 2.4, 'day')).toBe(2)
    expect(pxToDays(PX_PER_DAY.day * 2.6, 'day')).toBe(3)
    expect(pxToDays(-PX_PER_DAY.day * 3, 'day')).toBe(-3)
    expect(pxToDays(4, 'month')).toBe(1) // a coarse zoom still moves whole days
  })
})

describe('header bands', () => {
  const domain = domainOf(model, '2026-04-15')

  it('emits one month band per calendar month, clipped to the domain', () => {
    const bands = monthBands(domain, 'day')
    expect(bands.map((b) => b.key)).toEqual(['2026-03', '2026-04', '2026-05'])
    expect(bands[0].x).toBe(0)
    // March is clipped to 03-18..03-31 = 14 days.
    expect(bands[0].width).toBe(14 * PX_PER_DAY.day)
    // Bands tile without gaps.
    expect(bands[1].x).toBe(bands[0].x + bands[0].width)
  })

  it('spans a year boundary', () => {
    const yearEnd = { start: '2025-12-20', end: '2026-01-10', days: 22 }
    expect(monthBands(yearEnd, 'day').map((b) => b.key)).toEqual(['2025-12', '2026-01'])
  })

  it('emits a day cell per day at day zoom, flagging weekends', () => {
    const bands = subBands(domain, 'day')
    expect(bands).toHaveLength(domain.days)
    // 2026-03-21 is a Saturday.
    expect(bands.find((b) => b.key === '2026-03-21')?.muted).toBe(true)
    expect(bands.find((b) => b.key === '2026-03-23')?.muted).toBe(false)
  })

  it('emits week cells at week zoom and nothing at month zoom', () => {
    expect(subBands(domain, 'week').length).toBeLessThan(domain.days)
    expect(subBands(domain, 'month')).toEqual([])
  })
})

describe('flattenRows', () => {
  it('numbers the tree outline-style and nests tasks and milestones', () => {
    const rows = flattenRows(model, new Set())
    expect(rows.map((r) => `${r.number} ${r.kind}`)).toEqual([
      '1 project',
      '1.1 deliverable',
      '1.1.1 task',
      '1.1.2 milestone',
      '1.2 deliverable'
    ])
  })

  it('hides a collapsed deliverable’s children but keeps the deliverable', () => {
    const rows = flattenRows(model, new Set(['d:deliverable/p/a']))
    expect(rows.map((r) => r.kind)).toEqual(['project', 'deliverable', 'deliverable'])
  })

  it('hides everything under a collapsed project', () => {
    expect(flattenRows(model, new Set(['p:p'])).map((r) => r.kind)).toEqual(['project'])
  })

  it('filters to one project', () => {
    expect(flattenRows(model, new Set(), 'other')).toEqual([])
    expect(flattenRows(model, new Set(), 'p').length).toBeGreaterThan(0)
  })

  it('indexes deliverable rows for arrow placement', () => {
    const rows = flattenRows(model, new Set())
    expect(rowIndexById(rows).get('deliverable/p/b')).toBe(4)
  })
})

describe('flattenRows project visibility', () => {
  const twoProjects = new Map<string, NoteMeta>()
  twoProjects.set(
    'A.md',
    parseNote(
      'A.md',
      '---\ntype: project\nproject: a\n---\n- [ ] A1 📅 2026-06-01 #deliverable/a/one\n'
    )
  )
  twoProjects.set(
    'B.md',
    parseNote(
      'B.md',
      '---\ntype: project\nproject: b\n---\n- [ ] B1 📅 2026-06-01 #deliverable/b/one\n'
    )
  )
  const both = buildPlannerModel(twoProjects)

  it('drops an unticked project and everything under it', () => {
    const rows = flattenRows(both, new Set(), null, new Set(['a']))
    expect(rows.filter((r) => r.kind === 'project')).toHaveLength(1)
    expect(
      rows.some((r) => r.kind === 'deliverable' && r.deliverable.id === 'deliverable/a/one')
    ).toBe(false)
  })

  it('renumbers the remaining projects from 1', () => {
    const rows = flattenRows(both, new Set(), null, new Set(['a']))
    expect(rows[0].number).toBe('1')
    expect(rows[0].kind === 'project' && rows[0].project.slug).toBe('b')
  })

  it('shows everything when nothing is hidden', () => {
    expect(flattenRows(both, new Set()).filter((r) => r.kind === 'project')).toHaveLength(2)
  })

  it('yields nothing when every project is unticked', () => {
    expect(flattenRows(both, new Set(), null, new Set(['a', 'b']))).toEqual([])
  })
})

describe('rowTops / rowsHeight', () => {
  const twoProjects = new Map<string, NoteMeta>()
  twoProjects.set(
    'A.md',
    parseNote(
      'A.md',
      '---\ntype: project\nproject: a\n---\n- [ ] A1 📅 2026-06-01 #deliverable/a/one\n'
    )
  )
  twoProjects.set(
    'B.md',
    parseNote(
      'B.md',
      '---\ntype: project\nproject: b\n---\n- [ ] B1 📅 2026-06-01 #deliverable/b/one\n'
    )
  )
  const rows = flattenRows(buildPlannerModel(twoProjects), new Set())

  it('stacks rows on a fixed pitch until a new project starts', () => {
    // project A, its deliverable, [gap] project B, its deliverable
    expect(rowTops(rows)).toEqual([
      0,
      ROW_HEIGHT,
      2 * ROW_HEIGHT + GROUP_GAP,
      3 * ROW_HEIGHT + GROUP_GAP
    ])
  })

  it('never puts a gap above the first project', () => {
    expect(rowTops(rows)[0]).toBe(0)
  })

  it('measures the whole stack including the gaps', () => {
    expect(rowsHeight(rows)).toBe(4 * ROW_HEIGHT + GROUP_GAP)
    expect(rowsHeight([])).toBe(0)
  })

  it('centres a row within its own height, gaps excluded', () => {
    const tops = rowTops(rows)
    expect(rowCenter(tops, 2)).toBe(2 * ROW_HEIGHT + GROUP_GAP + ROW_HEIGHT / 2)
  })
})
