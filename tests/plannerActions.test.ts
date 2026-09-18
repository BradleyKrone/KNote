import { beforeEach, describe, expect, it, vi } from 'vitest'

const replaceLine = vi.fn().mockResolvedValue(undefined)
const insertLine = vi.fn().mockResolvedValue(undefined)

vi.mock('@/shared/rpc', () => ({
  host: {
    replaceLine: (...args: unknown[]) => replaceLine(...args),
    insertLine: (...args: unknown[]) => insertLine(...args)
  }
}))
vi.mock('@/shared/stores', () => ({ showToast: vi.fn() }))

const { addWorkPackage, moveDeliverable, resizeDeliverable, workPackageLine } =
  await import('@/planner/plannerActions')
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
    `- [ ] @task A 🛫 2026-01-01 📅 ${aEnd} @deliverable(p/a)`,
    `- [ ] @task B 🛫 2026-01-10 📅 2026-01-20 @deliverable(p/b)${dep ? ' ⛓ @deliverable(p/a)' : ''}`,
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

describe('workPackageLine / addWorkPackage', () => {
  beforeEach(() => insertLine.mockClear())

  function releaseProject(): Map<string, NoteMeta> {
    const content = [
      '---',
      'type: project',
      'project: software',
      '---',
      '',
      '- [ ] @task Release 1 🛫 2026-01-01 📅 2026-03-01 @deliverable(software/release-1)',
      ''
    ].join('\n')
    return new Map([['Software.md', parseNote('Software.md', content)]])
  }

  it('builds a task line carrying both the deliverable and parent markers, indented under the parent', () => {
    const model = buildPlannerModel(releaseProject())
    const release1 = model.byId.get('deliverable/software/release-1')!

    const { line, tag } = workPackageLine(release1, 'Fix product bugs', '2026-01-15', '2026-02-01')

    expect(tag).toBe('deliverable/software/fix-product-bugs')
    expect(line).toBe(
      '  - [ ] @task Fix product bugs 🛫 2026-01-15 📅 2026-02-01 @deliverable(software/fix-product-bugs) @parent(release-1)'
    )
  })

  it('inserts the work package right after the parent’s own line', async () => {
    const model = buildPlannerModel(releaseProject())
    const release1 = model.byId.get('deliverable/software/release-1')!

    await addWorkPackage(release1, 'Fix product bugs', '2026-01-15', '2026-02-01')

    expect(insertLine).toHaveBeenCalledWith(
      'Software.md',
      release1.line,
      release1.rawLine,
      expect.stringContaining('@parent(release-1)')
    )
  })

  it('clamps a start/end given before/after the parent into the parent’s own window', () => {
    const model = buildPlannerModel(releaseProject())
    const release1 = model.byId.get('deliverable/software/release-1')!

    const { line } = workPackageLine(release1, 'Fix product bugs', '2025-12-01', '2026-04-01')

    expect(line).toContain('🛫 2026-01-01 📅 2026-03-01')
  })
})

describe('a work package can never extend before or after its deliverable', () => {
  /** `release-1` 🛫2026-01-01 📅2026-03-01, with `fix-bugs` nested inside it via @parent. */
  function nestedVault(fixBugsStart: string, fixBugsEnd: string): Map<string, NoteMeta> {
    const content = [
      '---',
      'type: project',
      'project: software',
      '---',
      '',
      '- [ ] @task Release 1 🛫 2026-01-01 📅 2026-03-01 @deliverable(software/release-1)',
      `- [ ] @task Fix bugs 🛫 ${fixBugsStart} 📅 ${fixBugsEnd} @deliverable(software/fix-bugs) @parent(release-1)`,
      ''
    ].join('\n')
    return new Map([['Software.md', parseNote('Software.md', content)]])
  }

  beforeEach(() => {
    replaceLine.mockClear()
    insertLine.mockClear()
  })

  it('resizeDeliverable clamps the end to the parent’s own end when dragged past it', async () => {
    const model = buildPlannerModel(nestedVault('2026-01-15', '2026-02-01'))
    const fixBugs = model.byId.get('deliverable/software/fix-bugs')!

    await resizeDeliverable(model, fixBugs, fixBugs.start, '2026-04-01')

    expect(replaceLine).toHaveBeenCalledWith(
      'Software.md',
      fixBugs.line,
      fixBugs.rawLine,
      expect.stringContaining('🛫 2026-01-15 📅 2026-03-01')
    )
  })

  it('resizeDeliverable clamps the start to the parent’s own start when dragged before it', async () => {
    const model = buildPlannerModel(nestedVault('2026-01-15', '2026-02-01'))
    const fixBugs = model.byId.get('deliverable/software/fix-bugs')!

    await resizeDeliverable(model, fixBugs, '2025-11-01', fixBugs.end)

    expect(replaceLine).toHaveBeenCalledWith(
      'Software.md',
      fixBugs.line,
      fixBugs.rawLine,
      expect.stringContaining('🛫 2026-01-01 📅 2026-02-01')
    )
  })

  it('resizeDeliverable is a no-op once already clamped to the boundary', async () => {
    const model = buildPlannerModel(nestedVault('2026-01-01', '2026-03-01'))
    const fixBugs = model.byId.get('deliverable/software/fix-bugs')!

    // Already spans the whole parent window — asking to extend past either
    // edge again should change nothing.
    await resizeDeliverable(model, fixBugs, '2025-01-01', '2027-01-01')

    expect(replaceLine).not.toHaveBeenCalled()
  })

  it('moveDeliverable stops a whole-bar drag at the parent’s end, preserving length', async () => {
    // 14 days of room between the end (2026-02-15) and the parent's own end
    // (2026-03-01) — a bigger drag clamps to exactly that much, keeping the
    // 14-day length rather than shrinking it.
    const model = buildPlannerModel(nestedVault('2026-02-01', '2026-02-15'))
    const fixBugs = model.byId.get('deliverable/software/fix-bugs')!

    await moveDeliverable(model, fixBugs.id, 30)

    expect(replaceLine).toHaveBeenCalledWith(
      'Software.md',
      fixBugs.line,
      fixBugs.rawLine,
      expect.stringContaining('🛫 2026-02-15 📅 2026-03-01')
    )
  })

  it('moveDeliverable stops a whole-bar drag at the parent’s start', async () => {
    // 31 days of room between the start (2026-02-01) and the parent's own
    // start (2026-01-01).
    const model = buildPlannerModel(nestedVault('2026-02-01', '2026-02-15'))
    const fixBugs = model.byId.get('deliverable/software/fix-bugs')!

    await moveDeliverable(model, fixBugs.id, -60)

    expect(replaceLine).toHaveBeenCalledWith(
      'Software.md',
      fixBugs.line,
      fixBugs.rawLine,
      expect.stringContaining('🛫 2026-01-01 📅 2026-01-15')
    )
  })

  it('refuses to move at all once already flush against the boundary it’s dragged toward', async () => {
    const model = buildPlannerModel(nestedVault('2026-01-01', '2026-03-01'))
    const fixBugs = model.byId.get('deliverable/software/fix-bugs')!

    await moveDeliverable(model, fixBugs.id, 5)

    expect(replaceLine).not.toHaveBeenCalled()
  })

  it('never constrains a root deliverable, which has no parent', async () => {
    const model = buildPlannerModel(nestedVault('2026-01-15', '2026-02-01'))
    const release1 = model.byId.get('deliverable/software/release-1')!

    await resizeDeliverable(model, release1, release1.start, '2027-01-01')

    expect(replaceLine).toHaveBeenCalledWith(
      'Software.md',
      release1.line,
      release1.rawLine,
      expect.stringContaining('📅 2027-01-01')
    )
  })
})
