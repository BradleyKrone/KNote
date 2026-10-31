import { describe, expect, it } from 'vitest'
import {
  addDays,
  applyOrder,
  moveInOrder,
  scopeOrderKeys,
  dateToCenterX,
  dateToX,
  diffDays,
  domainOf,
  domainShiftPx,
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
  stableDomain,
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
      '- [ ] @task A 🛫 2026-04-01 📅 2026-04-10 #deliverable/p/a',
      '    - [ ] a task #deliverable/p/a',
      '- [ ] @task B 🛫 2026-04-11 📅 2026-04-30 #deliverable/p/b ⛓ #deliverable/p/a',
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

describe('stableDomain', () => {
  const span = (start: string, end: string) => ({ start, end, days: diffDays(start, end) + 1 })

  it('takes the first domain as-is', () => {
    const next = span('2026-01-01', '2026-03-01')
    expect(stableDomain(null, next)).toBe(next)
  })

  it('never lets the start move later — the chart would slide left under a dropped bar', () => {
    // Dragging the earliest deliverable right pulls `domainOf`'s start along.
    const prev = span('2026-01-01', '2026-03-01')
    expect(stableDomain(prev, span('2026-01-20', '2026-03-01'))).toBe(prev)
  })

  it('never lets the end move earlier', () => {
    const prev = span('2026-01-01', '2026-03-01')
    expect(stableDomain(prev, span('2026-01-01', '2026-02-01'))).toBe(prev)
  })

  it('widens to cover a later end and an earlier start', () => {
    const grown = stableDomain(span('2026-01-10', '2026-03-01'), span('2026-01-01', '2026-04-01'))
    expect(grown).toEqual(span('2026-01-01', '2026-04-01'))
  })

  it('reports how far an earlier start pushed the content right', () => {
    const prev = span('2026-01-10', '2026-03-01')
    expect(domainShiftPx(prev, span('2026-01-01', '2026-03-01'), 'week')).toBe(9 * PX_PER_DAY.week)
    expect(domainShiftPx(prev, prev, 'week')).toBe(0)
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

  it('stretches to include a project milestone past every deliverable', () => {
    const withMilestone = new Map(notes)
    withMilestone.set(
      'Q.md',
      parseNote(
        'Q.md',
        [
          '---',
          'type: project',
          'project: q',
          '---',
          '- [ ] @task C 🛫 2026-04-01 📅 2026-04-10 @deliverable(q/c)',
          '🏁 Launch 📅 2026-06-15',
          ''
        ].join('\n')
      )
    )
    const domain = domainOf(buildPlannerModel(withMilestone), '2026-04-15')
    expect(domain.end).toBe('2026-07-15')
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

  it('centers a date half a day-width past its left edge, at every zoom', () => {
    for (const zoom of ZOOMS) {
      for (const date of ['2026-03-18', '2026-04-01', '2026-04-30']) {
        expect(dateToCenterX(domain, date, zoom)).toBeCloseTo(
          dateToX(domain, date, zoom) + PX_PER_DAY[zoom] / 2
        )
      }
    }
    expect(dateToCenterX(domain, domain.start, 'day')).toBe(PX_PER_DAY.day / 2)
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
      '---\ntype: project\nproject: a\n---\n- [ ] @task A1 📅 2026-06-01 #deliverable/a/one\n'
    )
  )
  twoProjects.set(
    'B.md',
    parseNote(
      'B.md',
      '---\ntype: project\nproject: b\n---\n- [ ] @task B1 📅 2026-06-01 #deliverable/b/one\n'
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

describe('applyOrder / moveInOrder', () => {
  const id = (s: string): string => s

  it('leaves the default order alone with nothing saved', () => {
    expect(applyOrder(['a', 'b', 'c'], id, undefined)).toEqual(['a', 'b', 'c'])
    expect(applyOrder(['a', 'b', 'c'], id, [])).toEqual(['a', 'b', 'c'])
  })

  it('puts saved keys first in saved order, the rest after in default order', () => {
    expect(applyOrder(['a', 'b', 'c', 'd'], id, ['c', 'a'])).toEqual(['c', 'a', 'b', 'd'])
  })

  it('ignores saved keys that no longer match anything', () => {
    expect(applyOrder(['a', 'b'], id, ['gone', 'b'])).toEqual(['b', 'a'])
  })

  it('moves a key before or after a target', () => {
    expect(moveInOrder(['a', 'b', 'c'], 'c', 'a', 'before')).toEqual(['c', 'a', 'b'])
    expect(moveInOrder(['a', 'b', 'c'], 'a', 'b', 'after')).toEqual(['b', 'a', 'c'])
    expect(moveInOrder(['a', 'b', 'c'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a'])
  })

  it('is a no-op for a missing key or a drop onto itself', () => {
    expect(moveInOrder(['a', 'b'], 'x', 'a', 'before')).toEqual(['a', 'b'])
    expect(moveInOrder(['a', 'b'], 'a', 'a', 'after')).toEqual(['a', 'b'])
  })
})

describe('flattenRows — saved order', () => {
  const twoProjects = new Map<string, NoteMeta>()
  twoProjects.set(
    'A.md',
    parseNote(
      'A.md',
      '---\ntype: project\nproject: a\n---\n- [ ] @task A1 📅 2026-06-01 #deliverable/a/one\n'
    )
  )
  twoProjects.set(
    'B.md',
    parseNote(
      'B.md',
      '---\ntype: project\nproject: b\n---\n- [ ] @task B1 📅 2026-06-01 #deliverable/b/one\n'
    )
  )
  const both = buildPlannerModel(twoProjects)

  it('reorders projects and renumbers them by position', () => {
    const rows = flattenRows(both, new Set(), null, new Set(), { '': ['p:b', 'p:a'] })
    const projects = rows.filter((r) => r.kind === 'project')
    expect(projects.map((r) => r.kind === 'project' && r.project.slug)).toEqual(['b', 'a'])
    expect(projects.map((r) => r.number)).toEqual(['1', '2'])
    // Each project's children move with it.
    expect(rows.map((r) => r.number)).toEqual(['1', '1.1', '2', '2.1'])
  })

  it('reorders a project’s deliverables and milestones, carrying their children', () => {
    const rows = flattenRows(model, new Set(), null, new Set(), {
      'p:p': ['d:deliverable/p/b', 'd:deliverable/p/a']
    })
    expect(rows.map((r) => `${r.number} ${r.kind}`)).toEqual([
      '1 project',
      '1.1 deliverable',
      '1.2 deliverable',
      '1.2.1 task',
      '1.2.2 milestone'
    ])
    expect(rows[1].kind === 'deliverable' && rows[1].deliverable.id).toBe('deliverable/p/b')
  })

  it('reorders a deliverable’s tasks and milestones by line-free keys', () => {
    const rows = flattenRows(model, new Set(), null, new Set(), {
      'd:deliverable/p/a': ['m:P.md::Kickoff']
    })
    expect(rows.slice(2, 4).map((r) => r.kind)).toEqual(['milestone', 'task'])
    expect(rows[2].parentKey).toBe('d:deliverable/p/a')
  })

  it('tags every row with its scope and order key', () => {
    const rows = flattenRows(model, new Set())
    expect(rows.map((r) => [r.parentKey, r.orderKey])).toEqual([
      ['', 'p:p'],
      ['p:p', 'd:deliverable/p/a'],
      ['d:deliverable/p/a', 't:P.md::a task'],
      ['d:deliverable/p/a', 'm:P.md::Kickoff'],
      ['p:p', 'd:deliverable/p/b']
    ])
  })

  it('scopeOrderKeys includes hidden projects so their places survive a drop', () => {
    expect(scopeOrderKeys(both, '', { '': ['p:b'] })).toEqual(['p:b', 'p:a'])
    expect(scopeOrderKeys(model, 'd:deliverable/p/a', {})).toEqual([
      't:P.md::a task',
      'm:P.md::Kickoff'
    ])
  })
})

describe('flattenRows — work packages', () => {
  const nested = new Map<string, NoteMeta>()
  nested.set(
    'Software.md',
    parseNote(
      'Software.md',
      [
        '---',
        'type: project',
        'project: software',
        '---',
        '- [ ] @task Release 1 🛫 2026-01-01 📅 2026-03-01 @deliverable(software/release-1)',
        '- [ ] @task Fix product bugs 🛫 2026-01-15 📅 2026-02-01 @deliverable(software/fix-bugs) @parent(release-1)',
        '- [ ] Fix login crash @deliverable(software/fix-bugs)',
        ''
      ].join('\n')
    )
  )
  const nestedModel = buildPlannerModel(nested)

  it('recurses into workPackages before tasks, extending the numbering another level', () => {
    const rows = flattenRows(nestedModel, new Set())
    expect(rows.map((r) => `${r.number} ${r.kind}`)).toEqual([
      '1 project',
      '1.1 deliverable', // Release 1
      '1.1.1 deliverable', // Fix product bugs, its work package
      '1.1.1.1 task' // the plain "Fix login crash" member task
    ])
  })

  it('gives the root and its work package an increasing depth', () => {
    const rows = flattenRows(nestedModel, new Set())
    const depthOf = (id: string): number | undefined =>
      rows.find((r) => r.kind === 'deliverable' && r.deliverable.id === id)?.depth
    expect(depthOf('deliverable/software/release-1')).toBe(1)
    expect(depthOf('deliverable/software/fix-bugs')).toBe(2)
  })

  it('collapsing the root hides its work package too', () => {
    const rows = flattenRows(nestedModel, new Set(['d:deliverable/software/release-1']))
    expect(rows.map((r) => r.kind)).toEqual(['project', 'deliverable'])
  })

  it('collapsing the work package hides only its own tasks', () => {
    const rows = flattenRows(nestedModel, new Set(['d:deliverable/software/fix-bugs']))
    expect(rows.map((r) => r.kind)).toEqual(['project', 'deliverable', 'deliverable'])
  })

  it('indexes a work package row for arrow placement, same as a root deliverable', () => {
    const rows = flattenRows(nestedModel, new Set())
    const index = rowIndexById(rows)
    expect(index.get('deliverable/software/fix-bugs')).toBe(2)
  })
})

describe('rowTops / rowsHeight', () => {
  const twoProjects = new Map<string, NoteMeta>()
  twoProjects.set(
    'A.md',
    parseNote(
      'A.md',
      '---\ntype: project\nproject: a\n---\n- [ ] @task A1 📅 2026-06-01 #deliverable/a/one\n'
    )
  )
  twoProjects.set(
    'B.md',
    parseNote(
      'B.md',
      '---\ntype: project\nproject: b\n---\n- [ ] @task B1 📅 2026-06-01 #deliverable/b/one\n'
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
