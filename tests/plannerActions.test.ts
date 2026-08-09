import { beforeEach, describe, expect, it, vi } from 'vitest'

const replaceLine = vi.fn().mockResolvedValue(undefined)

vi.mock('@/shared/rpc', () => ({
  host: { replaceLine: (...args: unknown[]) => replaceLine(...args) }
}))
vi.mock('@/shared/stores', () => ({ showToast: vi.fn() }))

const { resizeDeliverable } = await import('@/planner/plannerActions')
const { buildPlannerModel } = await import('@/planner/plannerSelectors')
const { parseNote } = await import('@shared/parser/parseNote')

import type { NoteMeta } from '@shared/types'

/** A project with two deliverables, `b` depending on `a` unless `dep` is false. */
function vault(aEnd: string, dep = true): Map<string, NoteMeta> {
  const content = [
    '---',
    'type: project',
    'project: p',
    '---',
    '',
    `- [ ] A 🛫 2026-01-01 📅 ${aEnd} @deliverable(p/a)`,
    `- [ ] B 🛫 2026-01-10 📅 2026-01-20 @deliverable(p/b)${dep ? ' ⛓ @deliverable(p/a)' : ''}`,
    ''
  ].join('\n')
  return new Map([['Project.md', parseNote('Project.md', content)]])
}

describe('resizeDeliverable', () => {
  beforeEach(() => replaceLine.mockClear())

  it('carries a dependent along by the same number of days when the end date is extended', async () => {
    const model = buildPlannerModel(vault('2026-01-09'))
    const a = model.byId.get('deliverable/p/a')!

    await resizeDeliverable(model, a, a.start, '2026-01-15')

    expect(replaceLine).toHaveBeenCalledTimes(2)
    expect(replaceLine).toHaveBeenNthCalledWith(
      1,
      'Project.md',
      a.line,
      a.rawLine,
      expect.stringContaining('🛫 2026-01-01 📅 2026-01-15')
    )
    expect(replaceLine).toHaveBeenNthCalledWith(
      2,
      'Project.md',
      expect.any(Number),
      expect.stringContaining('B'),
      expect.stringContaining('🛫 2026-01-16 📅 2026-01-26')
    )
  })

  it('leaves a dependent in place when only the start date moves', async () => {
    const model = buildPlannerModel(vault('2026-01-09'))
    const a = model.byId.get('deliverable/p/a')!

    await resizeDeliverable(model, a, '2026-01-03', a.end)

    expect(replaceLine).toHaveBeenCalledTimes(1)
  })

  it('never moves a deliverable that merely sits nearby, with no dependency', async () => {
    const model = buildPlannerModel(vault('2026-01-09', false))
    const a = model.byId.get('deliverable/p/a')!

    await resizeDeliverable(model, a, a.start, '2026-01-15')

    expect(replaceLine).toHaveBeenCalledTimes(1)
  })
})
