// Planner bar colors: `color:` on a project note, `@color(name)` on a
// deliverable line, picked from the planner's right-click Color ▸ menu.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const replaceLine = vi.fn().mockResolvedValue(undefined)
const setFrontmatter = vi.fn().mockResolvedValue(undefined)

vi.mock('@/shared/rpc', () => ({
  host: {
    replaceLine: (...args: unknown[]) => replaceLine(...args),
    setFrontmatter: (...args: unknown[]) => setFrontmatter(...args)
  }
}))
vi.mock('@/shared/stores', () => ({ showToast: vi.fn() }))

const { setDeliverableColor, setProjectColor } = await import('@/planner/plannerActions')
const { barColor, buildPlannerModel, inheritedBarColor } =
  await import('@/planner/plannerSelectors')
const { parseNote } = await import('@shared/parser/parseNote')
const { stripInlineMarkers } = await import('@shared/parser/patterns')
const { setColorMarker } = await import('../src/webviews/shared/taskMeta')

import type { NoteMeta } from '@shared/types'

function project(slug: string, lines: string[], color?: string): [string, NoteMeta] {
  const path = `${slug}.md`
  const content = [
    '---',
    'type: project',
    `project: ${slug}`,
    ...(color ? [`color: ${color}`] : []),
    '---',
    ...lines,
    ''
  ].join('\n')
  return [path, parseNote(path, content)]
}

const RELEASE = '- [ ] @task Release 🛫 2026-01-01 📅 2026-03-01 @deliverable(sw/release)'
const FIXES =
  '- [ ] @task Fixes 🛫 2026-01-10 📅 2026-02-01 @deliverable(sw/fixes) @parent(release)'

describe('bar color resolution', () => {
  it('keeps the old per-project cycle when nothing is set', () => {
    const model = buildPlannerModel(
      new Map([
        project('a', [RELEASE.replace('sw/', 'a/')]),
        project('b', [RELEASE.replace('sw/', 'b/')])
      ])
    )
    const colors = model.projects.map((p) => barColor(p.deliverables[0], p, model))
    expect(colors).toEqual(['blue', 'green'])
  })

  it('uses the project color for every bar in it', () => {
    const model = buildPlannerModel(new Map([project('sw', [RELEASE, FIXES], 'pink')]))
    const p = model.projects[0]
    expect(p.color).toBe('pink')
    for (const d of model.byId.values()) expect(barColor(d, p, model)).toBe('pink')
  })

  it("prefers a deliverable's own color, and a work package inherits its parent's", () => {
    const model = buildPlannerModel(
      new Map([project('sw', [`${RELEASE} @color(teal)`, FIXES], 'pink')])
    )
    const p = model.projects[0]
    const release = model.byId.get('deliverable/sw/release')!
    const fixes = model.byId.get('deliverable/sw/fixes')!
    expect(release.color).toBe('teal')
    expect(barColor(release, p, model)).toBe('teal')
    expect(fixes.color).toBeNull()
    expect(barColor(fixes, p, model)).toBe('teal')
    // Clearing the deliverable's own color falls back to the project's.
    expect(inheritedBarColor(release, p, model)).toBe('pink')
  })

  it('ignores an unknown color name', () => {
    const model = buildPlannerModel(
      new Map([project('sw', [`${RELEASE} @color(chartreuse)`], 'mauve')])
    )
    const p = model.projects[0]
    expect(p.color).toBeNull()
    expect(barColor(model.byId.get('deliverable/sw/release')!, p, model)).toBe('blue')
  })

  it('reads a project color case-insensitively', () => {
    const model = buildPlannerModel(new Map([project('sw', [RELEASE], 'Green')]))
    expect(model.projects[0].color).toBe('green')
  })

  it('keeps @color out of the label, so election and labels are unchanged', () => {
    const model = buildPlannerModel(new Map([project('sw', [`${RELEASE} @color(teal)`])]))
    expect(model.byId.get('deliverable/sw/release')!.label).toBe('Release')
    expect(stripInlineMarkers('Ship it @color(teal) #x')).toBe('Ship it')
  })
})

describe('setColorMarker', () => {
  it('appends, replaces and removes the marker', () => {
    expect(setColorMarker('Ship it', 'green')).toBe('Ship it @color(green)')
    expect(setColorMarker('Ship it @color(green) 📅 2026-01-01', 'pink')).toBe(
      'Ship it 📅 2026-01-01 @color(pink)'
    )
    expect(setColorMarker('Ship it @color(green) 📅 2026-01-01', null)).toBe(
      'Ship it 📅 2026-01-01'
    )
  })

  it('keeps a block anchor last', () => {
    expect(setColorMarker('Ship it ^ship-it', 'teal')).toBe('Ship it @color(teal) ^ship-it')
  })
})

describe('color writes', () => {
  beforeEach(() => {
    replaceLine.mockClear()
    setFrontmatter.mockClear()
  })

  it('rewrites the deliverable line through a verified replace', async () => {
    const model = buildPlannerModel(new Map([project('sw', [RELEASE])]))
    const d = model.byId.get('deliverable/sw/release')!
    await setDeliverableColor(d, 'orange')
    expect(replaceLine).toHaveBeenCalledWith(d.path, d.line, d.rawLine, `${RELEASE} @color(orange)`)
  })

  it('skips the write when nothing changes', async () => {
    const model = buildPlannerModel(new Map([project('sw', [RELEASE])]))
    await setDeliverableColor(model.byId.get('deliverable/sw/release')!, null)
    expect(replaceLine).not.toHaveBeenCalled()
  })

  it('sets and clears the project frontmatter key', async () => {
    await setProjectColor('sw.md', { type: 'project' }, 'gray')
    expect(setFrontmatter).toHaveBeenLastCalledWith('sw.md', { type: 'project', color: 'gray' })
    await setProjectColor('sw.md', { type: 'project', color: 'gray' }, null)
    expect(setFrontmatter).toHaveBeenLastCalledWith('sw.md', { type: 'project' })
  })
})
