import { beforeEach, describe, expect, it, vi } from 'vitest'

const replaceLine = vi.fn().mockResolvedValue(undefined)
const insertLine = vi.fn().mockResolvedValue(undefined)
const appendToNote = vi.fn().mockResolvedValue(undefined)
const setFrontmatter = vi.fn().mockResolvedValue(undefined)
/** The "extend the parent?" answer — no (clamp) unless a test says otherwise. */
const confirm = vi.fn().mockResolvedValue(false)

vi.mock('@/shared/rpc', () => ({
  host: {
    replaceLine: (...args: unknown[]) => replaceLine(...args),
    insertLine: (...args: unknown[]) => insertLine(...args),
    appendToNote: (...args: unknown[]) => appendToNote(...args),
    setFrontmatter: (...args: unknown[]) => setFrontmatter(...args)
  }
}))
vi.mock('@/shared/stores', () => ({
  showToast: vi.fn(),
  confirm: (...args: unknown[]) => confirm(...args)
}))

const {
  addProjectMilestone,
  addWorkPackage,
  editProjectDates,
  moveProject,
  planShrink,
  projectEdgeDates,
  trimPrompt,
  moveDatedLine,
  moveDeliverable,
  overrunPrompt,
  planOverrun,
  planPointOverrun,
  projectMilestoneLine,
  resizeDeliverable,
  setProjectDates,
  withDate,
  workPackageLine
} = await import('@/planner/plannerActions')
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

describe('running past a parent asks whether to extend it', () => {
  /**
   * `release-1` 🛫2026-01-01 📅2026-03-01 with `fix-bugs` nested inside it;
   * the project declares `end:`/`start:` only when `projectEnd`/`projectStart` is given.
   */
  function nestedVault(
    fixBugsStart: string,
    fixBugsEnd: string,
    projectEnd?: string,
    projectStart?: string
  ): Map<string, NoteMeta> {
    const content = [
      '---',
      'type: project',
      'project: software',
      ...(projectStart ? [`start: ${projectStart}`] : []),
      ...(projectEnd ? [`end: ${projectEnd}`] : []),
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
    setFrontmatter.mockClear()
    confirm.mockReset().mockResolvedValue(false)
  })

  it('a work package resized past its deliverable grows the deliverable first, then writes the work package unclamped', async () => {
    confirm.mockResolvedValue(true)
    const model = buildPlannerModel(nestedVault('2026-01-15', '2026-02-01'))
    const fixBugs = model.byId.get('deliverable/software/fix-bugs')!
    const release1 = model.byId.get('deliverable/software/release-1')!

    await resizeDeliverable(model, fixBugs, fixBugs.start, '2026-03-10')

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(replaceLine).toHaveBeenCalledTimes(2)
    expect(replaceLine).toHaveBeenNthCalledWith(
      1,
      'Software.md',
      release1.line,
      release1.rawLine,
      expect.stringContaining('🛫 2026-01-01 📅 2026-03-10')
    )
    expect(replaceLine).toHaveBeenNthCalledWith(
      2,
      'Software.md',
      fixBugs.line,
      fixBugs.rawLine,
      expect.stringContaining('🛫 2026-01-15 📅 2026-03-10')
    )
  })

  it('a work package resized before its deliverable’s start grows the deliverable’s start', async () => {
    confirm.mockResolvedValue(true)
    const model = buildPlannerModel(nestedVault('2026-01-15', '2026-02-01'))
    const fixBugs = model.byId.get('deliverable/software/fix-bugs')!
    const release1 = model.byId.get('deliverable/software/release-1')!

    await resizeDeliverable(model, fixBugs, '2025-12-20', fixBugs.end)

    expect(replaceLine).toHaveBeenNthCalledWith(
      1,
      'Software.md',
      release1.line,
      release1.rawLine,
      expect.stringContaining('🛫 2025-12-20 📅 2026-03-01')
    )
  })

  it('a work package moved past its deliverable keeps its full shift when extended', async () => {
    confirm.mockResolvedValue(true)
    const model = buildPlannerModel(nestedVault('2026-02-01', '2026-02-15'))
    const fixBugs = model.byId.get('deliverable/software/fix-bugs')!

    await moveDeliverable(model, fixBugs.id, 30)

    expect(replaceLine).toHaveBeenNthCalledWith(
      1,
      'Software.md',
      expect.any(Number),
      expect.stringContaining('Release 1'),
      expect.stringContaining('🛫 2026-01-01 📅 2026-03-17')
    )
    expect(replaceLine).toHaveBeenNthCalledWith(
      2,
      'Software.md',
      fixBugs.line,
      fixBugs.rawLine,
      expect.stringContaining('🛫 2026-03-03 📅 2026-03-17')
    )
  })

  it('never asks when the edit stays inside the parent', async () => {
    const model = buildPlannerModel(nestedVault('2026-01-15', '2026-02-01', '2026-06-01'))
    const fixBugs = model.byId.get('deliverable/software/fix-bugs')!

    await resizeDeliverable(model, fixBugs, fixBugs.start, '2026-02-10')

    expect(confirm).not.toHaveBeenCalled()
  })

  it('a deliverable past its project’s end: date moves the end date after the line write', async () => {
    confirm.mockResolvedValue(true)
    const model = buildPlannerModel(nestedVault('2026-01-15', '2026-02-01', '2026-03-05'))
    const release1 = model.byId.get('deliverable/software/release-1')!

    await resizeDeliverable(model, release1, release1.start, '2026-03-20')

    expect(replaceLine).toHaveBeenCalledWith(
      'Software.md',
      release1.line,
      release1.rawLine,
      expect.stringContaining('📅 2026-03-20')
    )
    expect(setFrontmatter).toHaveBeenCalledWith(
      'Software.md',
      expect.objectContaining({ end: '2026-03-20', type: 'project' })
    )
    expect(setFrontmatter.mock.invocationCallOrder[0]).toBeGreaterThan(
      replaceLine.mock.invocationCallOrder[0]
    )
  })

  it('declined, a deliverable stops at its project’s end: date', async () => {
    const model = buildPlannerModel(nestedVault('2026-01-15', '2026-02-01', '2026-03-05'))
    const release1 = model.byId.get('deliverable/software/release-1')!

    await resizeDeliverable(model, release1, release1.start, '2026-03-20')

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(setFrontmatter).not.toHaveBeenCalled()
    expect(replaceLine).toHaveBeenCalledWith(
      'Software.md',
      release1.line,
      release1.rawLine,
      expect.stringContaining('📅 2026-03-05')
    )
  })

  it('declined, a whole-bar move stops at the project’s end: date, keeping length', async () => {
    const model = buildPlannerModel(nestedVault('2026-01-15', '2026-02-01', '2026-03-05'))
    const release1 = model.byId.get('deliverable/software/release-1')!

    await moveDeliverable(model, release1.id, 10)

    expect(replaceLine).toHaveBeenCalledWith(
      'Software.md',
      release1.line,
      release1.rawLine,
      expect.stringContaining('🛫 2026-01-05 📅 2026-03-05')
    )
  })

  it('a work package that pushes its deliverable past the project end asks once and extends both', async () => {
    confirm.mockResolvedValue(true)
    const model = buildPlannerModel(nestedVault('2026-01-15', '2026-02-01', '2026-03-05'))
    const fixBugs = model.byId.get('deliverable/software/fix-bugs')!

    await resizeDeliverable(model, fixBugs, fixBugs.start, '2026-03-20')

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(replaceLine).toHaveBeenNthCalledWith(
      1,
      'Software.md',
      expect.any(Number),
      expect.stringContaining('Release 1'),
      expect.stringContaining('📅 2026-03-20')
    )
    expect(setFrontmatter).toHaveBeenCalledWith(
      'Software.md',
      expect.objectContaining({ end: '2026-03-20' })
    )
  })

  it('a bar already sticking out is neither asked about nor yanked back when moved inward', async () => {
    const model = buildPlannerModel(nestedVault('2026-02-20', '2026-03-10'))
    const fixBugs = model.byId.get('deliverable/software/fix-bugs')!

    await resizeDeliverable(model, fixBugs, '2026-02-25', fixBugs.end)

    expect(confirm).not.toHaveBeenCalled()
    expect(replaceLine).toHaveBeenCalledWith(
      'Software.md',
      fixBugs.line,
      fixBugs.rawLine,
      expect.stringContaining('🛫 2026-02-25 📅 2026-03-10')
    )
  })

  it('moving a deliverable carries its work packages along by the same days', async () => {
    const model = buildPlannerModel(nestedVault('2026-01-15', '2026-02-01'))
    const fixBugs = model.byId.get('deliverable/software/fix-bugs')!
    const release1 = model.byId.get('deliverable/software/release-1')!

    await moveDeliverable(model, release1.id, 7)

    expect(confirm).not.toHaveBeenCalled()
    expect(replaceLine).toHaveBeenCalledTimes(2)
    expect(replaceLine).toHaveBeenNthCalledWith(
      1,
      'Software.md',
      release1.line,
      release1.rawLine,
      expect.stringContaining('🛫 2026-01-08 📅 2026-03-08')
    )
    expect(replaceLine).toHaveBeenNthCalledWith(
      2,
      'Software.md',
      fixBugs.line,
      fixBugs.rawLine,
      expect.stringContaining('🛫 2026-01-22 📅 2026-02-08')
    )
  })

  it('resizing a deliverable leaves its work packages where they are', async () => {
    const model = buildPlannerModel(nestedVault('2026-01-15', '2026-02-01'))
    const release1 = model.byId.get('deliverable/software/release-1')!

    await resizeDeliverable(model, release1, release1.start, '2026-03-10')

    expect(replaceLine).toHaveBeenCalledTimes(1)
  })

  it('overrunPrompt names the parent in the title and lists the before → after spans', () => {
    const model = buildPlannerModel(nestedVault('2026-01-15', '2026-02-01', '2026-03-05'))
    const fixBugs = model.byId.get('deliverable/software/fix-bugs')!
    const overrun = planOverrun(model, fixBugs, fixBugs.start, '2026-03-20')!

    const prompt = overrunPrompt(fixBugs, overrun, 2026)

    expect(prompt.title).toBe('Extend “Release 1”?')
    expect(prompt.message).toBe(
      '“Fix bugs” would end after the deliverable it belongs to, which would then end after its project.'
    )
    expect(prompt.changes).toEqual([
      { label: 'Release 1', from: 'Jan 1 – Mar 1', to: 'Jan 1 – Mar 20' },
      { label: 'Software (project end)', from: 'Mar 5', to: 'Mar 20' }
    ])
  })

  it('planOverrun ignores a project with no end: date', () => {
    const model = buildPlannerModel(nestedVault('2026-01-15', '2026-02-01'))
    const release1 = model.byId.get('deliverable/software/release-1')!

    expect(planOverrun(model, release1, release1.start, '2027-01-01')).toBeNull()
  })

  it('declined, a deliverable stops at its project’s start: date', async () => {
    const model = buildPlannerModel(
      nestedVault('2026-01-15', '2026-02-01', undefined, '2025-12-20')
    )
    const release1 = model.byId.get('deliverable/software/release-1')!

    await resizeDeliverable(model, release1, '2025-12-01', release1.end)

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(setFrontmatter).not.toHaveBeenCalled()
    expect(replaceLine).toHaveBeenCalledWith(
      'Software.md',
      release1.line,
      release1.rawLine,
      expect.stringContaining('🛫 2025-12-20 📅 2026-03-01')
    )
  })

  it('declined, a whole-bar move stops at the project’s start: date, keeping length', async () => {
    const model = buildPlannerModel(
      nestedVault('2026-01-15', '2026-02-01', undefined, '2025-12-25')
    )
    const release1 = model.byId.get('deliverable/software/release-1')!

    await moveDeliverable(model, release1.id, -30)

    expect(replaceLine).toHaveBeenCalledWith(
      'Software.md',
      release1.line,
      release1.rawLine,
      expect.stringContaining('🛫 2025-12-25 📅 2026-02-22')
    )
  })

  it('accepted, a deliverable before its project’s start: moves the start date, last', async () => {
    confirm.mockResolvedValue(true)
    const model = buildPlannerModel(
      nestedVault('2026-01-15', '2026-02-01', '2026-06-01', '2025-12-20')
    )
    const release1 = model.byId.get('deliverable/software/release-1')!

    await resizeDeliverable(model, release1, '2025-12-01', release1.end)

    const written = setFrontmatter.mock.calls[0][1] as Record<string, unknown>
    expect(written).toMatchObject({ start: '2025-12-01', end: '2026-06-01' })
    expect(setFrontmatter.mock.invocationCallOrder[0]).toBeGreaterThan(
      replaceLine.mock.invocationCallOrder[0]
    )
  })

  it('overrunPrompt asks about the project’s start date alone when only that moves', () => {
    const model = buildPlannerModel(
      nestedVault('2026-01-15', '2026-02-01', '2026-06-01', '2025-12-20')
    )
    const release1 = model.byId.get('deliverable/software/release-1')!
    const overrun = planOverrun(model, release1, '2025-12-01', release1.end)!

    expect(overrun.project).toMatchObject({ start: '2025-12-01', end: null })
    const prompt = overrunPrompt(release1, overrun, 2026)
    expect(prompt.title).toBe("Move “Software”'s start date?")
    expect(prompt.message).toBe("“Release 1” would start before the project's start date.")
    expect(prompt.changes).toEqual([
      { label: 'Software (project start)', from: 'Dec 20, 2025', to: 'Dec 1, 2025' }
    ])
  })

  it('a work package that pushes its deliverable before the project start asks once', () => {
    const model = buildPlannerModel(
      nestedVault('2026-01-15', '2026-02-01', undefined, '2025-12-20')
    )
    const fixBugs = model.byId.get('deliverable/software/fix-bugs')!
    const overrun = planOverrun(model, fixBugs, '2025-12-10', fixBugs.end)!

    expect(overrunPrompt(fixBugs, overrun, 2026).message).toBe(
      '“Fix bugs” would start before the deliverable it belongs to, which would then start before its project.'
    )
  })
})

describe('setProjectDates', () => {
  beforeEach(() => setFrontmatter.mockClear())

  it('writes both sides in one frontmatter rewrite', async () => {
    await setProjectDates('P.md', { type: 'project' }, { start: '2026-01-01', end: '2026-03-01' })
    expect(setFrontmatter).toHaveBeenCalledTimes(1)
    expect(setFrontmatter).toHaveBeenCalledWith('P.md', {
      type: 'project',
      start: '2026-01-01',
      end: '2026-03-01'
    })
  })

  it('clears a side given null and leaves one given undefined alone', async () => {
    await setProjectDates('P.md', { start: '2026-01-01', end: '2026-03-01' }, { start: null })
    expect(setFrontmatter).toHaveBeenCalledWith('P.md', { end: '2026-03-01' })
  })

  it('drops the due:/deadline: aliases whenever it writes end:', async () => {
    await setProjectDates('P.md', { due: '2026-02-01', deadline: '2026-02-02' }, { end: null })
    expect(setFrontmatter).toHaveBeenCalledWith('P.md', {})
  })
})

describe('project milestones', () => {
  beforeEach(() => appendToNote.mockClear())

  it('writes a 🏁 line naming no deliverable', () => {
    expect(projectMilestoneLine('Go live', '2026-02-01')).toBe('🏁 Go live 📅 2026-02-01')
  })

  it('appends it to the project note', async () => {
    await addProjectMilestone('Project.md', 'Go live', '2026-02-01')
    expect(appendToNote).toHaveBeenCalledWith('Project.md', '🏁 Go live 📅 2026-02-01')
  })

  it('round-trips onto the project row, not any deliverable', () => {
    const text = [
      '---',
      'type: project',
      'project: p',
      '---',
      '',
      '- [ ] @task A 🛫 2026-01-01 📅 2026-01-09 @deliverable(p/a)',
      projectMilestoneLine('Go live', '2026-02-01'),
      ''
    ].join('\n')
    const model = buildPlannerModel(new Map([['Project.md', parseNote('Project.md', text)]]))
    expect(model.projects[0].milestones.map((m) => [m.text, m.date])).toEqual([
      ['Go live', '2026-02-01']
    ])
    expect(model.byId.get('deliverable/p/a')!.milestones).toEqual([])
  })
})

describe('dragging a milestone', () => {
  /** Release 1 (Jan 1 – Mar 1) ⊃ Fix bugs (Jan 15 – Feb 1), each with a milestone. */
  function vault(projectEnd?: string): Map<string, NoteMeta> {
    const content = [
      '---',
      'type: project',
      'project: software',
      ...(projectEnd ? [`end: ${projectEnd}`] : []),
      '---',
      '',
      '- [ ] @task Release 1 🛫 2026-01-01 📅 2026-03-01 @deliverable(software/release-1)',
      '🏁 Ship 📅 2026-02-20 @deliverable(software/release-1)',
      '- [ ] @task Fix bugs 🛫 2026-01-15 📅 2026-02-01 @deliverable(software/fix-bugs) @parent(release-1)',
      '🏁 Triage 📅 2026-01-20 @deliverable(software/fix-bugs)',
      '🏁 Go live 📅 2026-02-25',
      ''
    ].join('\n')
    return new Map([['Software.md', parseNote('Software.md', content)]])
  }

  function setup(projectEnd?: string) {
    const model = buildPlannerModel(vault(projectEnd))
    const release1 = model.byId.get('deliverable/software/release-1')!
    const fixBugs = model.byId.get('deliverable/software/fix-bugs')!
    const item = (m: { path: string; line: number; rawLine: string; text: string }) => ({
      ...m,
      label: m.text
    })
    return {
      model,
      release1,
      fixBugs,
      ship: release1.milestones[0],
      triage: fixBugs.milestones[0],
      goLive: model.projects[0].milestones[0],
      item
    }
  }

  beforeEach(() => {
    replaceLine.mockClear()
    setFrontmatter.mockClear()
    confirm.mockReset().mockResolvedValue(false)
  })

  it('swaps the date in place, keeping the marker spelling and position', () => {
    expect(withDate('🏁 Go live 📅 2026-02-01 @deliverable(p/a) ^m1', '2026-02-05')).toBe(
      '🏁 Go live 📅 2026-02-05 @deliverable(p/a) ^m1'
    )
    expect(withDate('🏁 Go live @due(2026-02-01) !!!', '2026-01-30')).toBe(
      '🏁 Go live @due(2026-01-30) !!!'
    )
  })

  it('inside its deliverable, moves without asking', async () => {
    const { model, release1, ship, item } = setup()
    await moveDatedLine(
      model,
      { kind: 'deliverable', deliverable: release1 },
      item(ship),
      ship.date,
      3
    )
    expect(confirm).not.toHaveBeenCalled()
    expect(replaceLine).toHaveBeenCalledWith(
      'Software.md',
      ship.line,
      ship.rawLine,
      '🏁 Ship 📅 2026-02-23 @deliverable(software/release-1)'
    )
  })

  it('writes nothing for a zero-day drag', async () => {
    const { model, release1, ship, item } = setup()
    await moveDatedLine(
      model,
      { kind: 'deliverable', deliverable: release1 },
      item(ship),
      ship.date,
      0
    )
    expect(replaceLine).not.toHaveBeenCalled()
  })

  it('declined, stops at its deliverable’s end', async () => {
    const { model, release1, ship, item } = setup()
    const onPlan = vi.fn()
    await moveDatedLine(
      model,
      { kind: 'deliverable', deliverable: release1 },
      item(ship),
      ship.date,
      30,
      onPlan
    )
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(onPlan).toHaveBeenCalledWith('2026-03-01', new Map())
    expect(replaceLine).toHaveBeenCalledTimes(1)
    expect(replaceLine).toHaveBeenCalledWith(
      'Software.md',
      ship.line,
      ship.rawLine,
      expect.stringContaining('📅 2026-03-01')
    )
  })

  it('accepted, grows its deliverable first, then writes the milestone', async () => {
    confirm.mockResolvedValue(true)
    const { model, release1, ship, item } = setup()
    await moveDatedLine(
      model,
      { kind: 'deliverable', deliverable: release1 },
      item(ship),
      ship.date,
      30
    )
    expect(replaceLine).toHaveBeenCalledTimes(2)
    expect(replaceLine).toHaveBeenNthCalledWith(
      1,
      'Software.md',
      release1.line,
      release1.rawLine,
      expect.stringContaining('🛫 2026-01-01 📅 2026-03-22')
    )
    expect(replaceLine).toHaveBeenNthCalledWith(
      2,
      'Software.md',
      ship.line,
      ship.rawLine,
      expect.stringContaining('📅 2026-03-22')
    )
  })

  it('under a work package, grows the whole chain outermost first, project last', async () => {
    confirm.mockResolvedValue(true)
    const { model, release1, fixBugs, triage, item } = setup('2026-03-05')
    const owner = { kind: 'deliverable', deliverable: fixBugs } as const
    const overrun = planPointOverrun(model, owner, triage.date, '2026-03-20')!
    expect(overrunPrompt(item(triage), overrun, 2026)).toEqual({
      title: 'Extend “Fix bugs”?',
      message:
        '“Triage” would end after the deliverable it belongs to, which would then end after its deliverable, which would then end after its project.',
      changes: [
        { label: 'Fix bugs', from: 'Jan 15 – Feb 1', to: 'Jan 15 – Mar 20' },
        { label: 'Release 1', from: 'Jan 1 – Mar 1', to: 'Jan 1 – Mar 20' },
        { label: 'Software (project end)', from: 'Mar 5', to: 'Mar 20' }
      ]
    })

    await moveDatedLine(model, owner, item(triage), triage.date, 59)

    expect(replaceLine.mock.calls.map((c) => c[1])).toEqual([
      release1.line,
      fixBugs.line,
      triage.line
    ])
    expect(setFrontmatter).toHaveBeenCalledTimes(1)
    expect(setFrontmatter.mock.invocationCallOrder[0]).toBeGreaterThan(
      replaceLine.mock.invocationCallOrder[2]
    )
  })

  it('on the project row, asks to move the project’s end; declined, stops at it', async () => {
    const { model, goLive, item } = setup('2026-03-05')
    const owner = { kind: 'project', project: model.projects[0] } as const
    expect(planPointOverrun(model, owner, goLive.date, '2026-03-04')).toBeNull()
    expect(planPointOverrun(model, owner, goLive.date, '2026-03-10')).toMatchObject({
      parents: [],
      project: { start: null, end: '2026-03-10' }
    })

    await moveDatedLine(model, owner, item(goLive), goLive.date, 20)

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(setFrontmatter).not.toHaveBeenCalled()
    expect(replaceLine).toHaveBeenCalledWith(
      'Software.md',
      goLive.line,
      goLive.rawLine,
      '🏁 Go live 📅 2026-03-05'
    )
  })

  it('on a project with no dates, moves freely', async () => {
    const { model, goLive, item } = setup()
    await moveDatedLine(
      model,
      { kind: 'project', project: model.projects[0] },
      item(goLive),
      goLive.date,
      60
    )
    expect(confirm).not.toHaveBeenCalled()
    expect(replaceLine).toHaveBeenCalledWith(
      'Software.md',
      goLive.line,
      goLive.rawLine,
      '🏁 Go live 📅 2026-04-26'
    )
  })
})

describe('shrinking a parent fits its children back inside it', () => {
  /**
   * Software, `start: 2026-01-01` → `end: 2026-06-30`: Release 1 (Jan 1 → Mar 1)
   * holding the Fix bugs work package and a Beta 🏁, Release 2 (Apr 1 → Jun 1),
   * and a project-level Launch 🏁. Fix bugs's dates are overridable.
   */
  function shrinkVault(fixBugs = ['2026-02-01', '2026-02-20']): Map<string, NoteMeta> {
    const content = [
      '---',
      'type: project',
      'project: software',
      'start: 2026-01-01',
      'end: 2026-06-30',
      '---',
      '',
      '- [ ] @task Release 1 🛫 2026-01-01 📅 2026-03-01 @deliverable(software/release-1)',
      `- [ ] @task Fix bugs 🛫 ${fixBugs[0]} 📅 ${fixBugs[1]} @deliverable(software/fix-bugs) @parent(release-1)`,
      '🏁 Beta 📅 2026-02-25 @deliverable(software/release-1)',
      '- [ ] @task Release 2 🛫 2026-04-01 📅 2026-06-01 @deliverable(software/release-2)',
      '🏁 Launch 📅 2026-06-20',
      ''
    ].join('\n')
    return new Map([['Software.md', parseNote('Software.md', content)]])
  }

  const summary = (
    reflow: ReturnType<typeof planShrink>
  ): { spans: unknown[]; points: unknown[] } => ({
    spans: reflow.spans.map((s) => [s.deliverable.label, s.start, s.end, s.trimmed]),
    points: reflow.points.map((p) => [p.ref.label, p.to])
  })

  beforeEach(() => {
    replaceLine.mockClear()
    setFrontmatter.mockClear()
    confirm.mockReset().mockResolvedValue(false)
  })

  it('slides a work package in, keeping its length, and stops a milestone at the new end', () => {
    const model = buildPlannerModel(shrinkVault())
    const release1 = model.byId.get('deliverable/software/release-1')!
    const reflow = planShrink(
      { kind: 'deliverable', deliverable: release1 },
      { start: release1.start, end: release1.end },
      { start: release1.start, end: '2026-02-15' }
    )
    expect(summary(reflow)).toEqual({
      spans: [['Fix bugs', '2026-01-27', '2026-02-15', false]],
      points: [['Beta', '2026-02-15']]
    })
  })

  it('trims a child longer than the new window to fill it', () => {
    const model = buildPlannerModel(shrinkVault())
    const release1 = model.byId.get('deliverable/software/release-1')!
    const reflow = planShrink(
      { kind: 'deliverable', deliverable: release1 },
      { start: release1.start, end: release1.end },
      { start: '2026-02-01', end: '2026-02-10' }
    )
    expect(summary(reflow)).toEqual({
      spans: [['Fix bugs', '2026-02-01', '2026-02-10', true]],
      points: [['Beta', '2026-02-10']]
    })
  })

  it('leaves a child already sticking out of a side that did not move', () => {
    const model = buildPlannerModel(shrinkVault(['2026-02-20', '2026-03-10']))
    const release1 = model.byId.get('deliverable/software/release-1')!
    const reflow = planShrink(
      { kind: 'deliverable', deliverable: release1 },
      { start: release1.start, end: release1.end },
      { start: '2026-01-10', end: release1.end }
    )
    expect(reflow.spans).toEqual([])
  })

  it('a project shrink fits its deliverables, then what they hold, then its own milestones', () => {
    const model = buildPlannerModel(shrinkVault())
    const reflow = planShrink(
      { kind: 'project', project: model.projects[0] },
      { start: '2026-01-01', end: '2026-06-30' },
      { start: '2026-01-01', end: '2026-02-20' }
    )
    expect(summary(reflow)).toEqual({
      spans: [
        ['Release 1', '2026-01-01', '2026-02-20', true],
        ['Release 2', '2026-01-01', '2026-02-20', true]
      ],
      points: [
        ['Launch', '2026-02-20'],
        ['Beta', '2026-02-20']
      ]
    })
  })

  it('a slid deliverable carries everything it holds along by the same days', () => {
    const model = buildPlannerModel(shrinkVault())
    const reflow = planShrink(
      { kind: 'project', project: model.projects[0] },
      { start: '2026-01-01', end: '2026-06-30' },
      { start: '2026-01-01', end: '2026-05-01' }
    )
    // Release 2 slides back 31 days; Release 1 is untouched; Launch stops at the end.
    expect(summary(reflow)).toEqual({
      spans: [['Release 2', '2026-03-01', '2026-05-01', false]],
      points: [['Launch', '2026-05-01']]
    })
  })

  it('resizeDeliverable writes the parent, then the children it fits, without asking', async () => {
    const model = buildPlannerModel(shrinkVault())
    const release1 = model.byId.get('deliverable/software/release-1')!
    const fixBugs = model.byId.get('deliverable/software/fix-bugs')!
    const beta = release1.milestones[0]

    await resizeDeliverable(model, release1, release1.start, '2026-02-15')

    expect(confirm).not.toHaveBeenCalled()
    expect(replaceLine.mock.calls.map((c) => [c[1], c[3]])).toEqual([
      [release1.line, expect.stringContaining('🛫 2026-01-01 📅 2026-02-15')],
      [fixBugs.line, expect.stringContaining('🛫 2026-01-27 📅 2026-02-15')],
      [beta.line, '🏁 Beta 📅 2026-02-15 @deliverable(software/release-1)']
    ])
  })

  it('warns before trimming, and Cancel writes nothing at all', async () => {
    const model = buildPlannerModel(shrinkVault())
    const release1 = model.byId.get('deliverable/software/release-1')!
    const onPlan = vi.fn()

    await resizeDeliverable(model, release1, '2026-02-01', '2026-02-10', onPlan)

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm.mock.calls[0][1]).toMatchObject({ title: 'Shorten “Fix bugs”?' })
    expect(replaceLine).not.toHaveBeenCalled()
    expect(onPlan).toHaveBeenCalledWith(new Map(), new Map())
  })

  it('trimPrompt lists each shortened bar before → after', () => {
    const model = buildPlannerModel(shrinkVault())
    const reflow = planShrink(
      { kind: 'project', project: model.projects[0] },
      { start: '2026-01-01', end: '2026-06-30' },
      { start: '2026-01-01', end: '2026-02-20' }
    )
    expect(trimPrompt(reflow, 2026)).toMatchObject({
      title: 'Shorten 2 bars?',
      changes: [
        { label: 'Release 1', from: 'Jan 1 – Mar 1', to: 'Jan 1 – Feb 20' },
        { label: 'Release 2', from: 'Apr 1 – Jun 1', to: 'Jan 1 – Feb 20' }
      ]
    })
  })

  it('editProjectDates fits the children first and rewrites the frontmatter last', async () => {
    const model = buildPlannerModel(shrinkVault())
    const project = model.projects[0]

    expect(await editProjectDates(project, { end: '2026-05-01' })).toBe(true)

    expect(replaceLine).toHaveBeenCalledTimes(2)
    expect(setFrontmatter).toHaveBeenCalledWith(
      'Software.md',
      expect.objectContaining({ start: '2026-01-01', end: '2026-05-01' })
    )
    expect(setFrontmatter.mock.invocationCallOrder[0]).toBeGreaterThan(
      replaceLine.mock.invocationCallOrder[1]
    )
  })

  it('editProjectDates writes nothing when a trim is cancelled', async () => {
    const model = buildPlannerModel(shrinkVault())
    expect(await editProjectDates(model.projects[0], { end: '2026-02-20' })).toBe(false)
    expect(replaceLine).not.toHaveBeenCalled()
    expect(setFrontmatter).not.toHaveBeenCalled()
  })

  it('growing a project touches nothing but its dates', async () => {
    const model = buildPlannerModel(shrinkVault())
    await editProjectDates(model.projects[0], { end: '2026-08-01' })
    expect(replaceLine).not.toHaveBeenCalled()
    expect(setFrontmatter).toHaveBeenCalledTimes(1)
  })

  it('projectEdgeDates never lets one edge cross the other', () => {
    const project = buildPlannerModel(shrinkVault()).projects[0]
    expect(projectEdgeDates(project, 'end', -10)).toEqual({ end: '2026-06-20' })
    expect(projectEdgeDates(project, 'end', -400)).toEqual({ end: '2026-01-01' })
    expect(projectEdgeDates(project, 'start', 400)).toEqual({ start: '2026-06-30' })
  })
})

describe('moveProject', () => {
  /** Software (dates overridable), Ops whose Rollout waits on Release 1, and a Notes.md member task. */
  function twoProjects(
    frontmatter = ['start: 2026-01-01', 'end: 2026-03-31']
  ): Map<string, NoteMeta> {
    const software = [
      '---',
      'type: project',
      'project: software',
      ...frontmatter,
      '---',
      '',
      '- [ ] @task Release 1 🛫 2026-01-01 📅 2026-03-01 @deliverable(software/release-1)',
      '- [ ] @task Fix bugs 🛫 2026-01-10 📅 2026-01-20 @deliverable(software/fix-bugs) @parent(release-1)',
      '🏁 Beta 📅 2026-02-25 @deliverable(software/release-1)',
      '🏁 Launch 📅 2026-03-20',
      ''
    ].join('\n')
    const ops = [
      '---',
      'type: project',
      'project: ops',
      '---',
      '',
      '- [ ] @task Rollout 🛫 2026-03-02 📅 2026-03-10 @deliverable(ops/rollout) ⛓ @deliverable(software/release-1)',
      ''
    ].join('\n')
    const notes = ['- [ ] Write docs 📅 2026-02-01 @deliverable(software/release-1)', ''].join('\n')
    return new Map([
      ['Software.md', parseNote('Software.md', software)],
      ['Ops.md', parseNote('Ops.md', ops)],
      ['Notes.md', parseNote('Notes.md', notes)]
    ])
  }

  beforeEach(() => {
    replaceLine.mockClear()
    setFrontmatter.mockClear()
  })

  it('shifts every bar, diamond and dependent, then the project dates, last', async () => {
    const model = buildPlannerModel(twoProjects())
    const project = model.projects.find((p) => p.slug === 'software')!

    await moveProject(model, project, 7)

    const written = replaceLine.mock.calls.map((c) => [c[0], c[3]])
    expect(written).toEqual(
      expect.arrayContaining([
        ['Software.md', expect.stringMatching(/Release 1 .*🛫 2026-01-08 📅 2026-03-08/)],
        ['Software.md', expect.stringMatching(/Fix bugs .*🛫 2026-01-17 📅 2026-01-27/)],
        ['Ops.md', expect.stringMatching(/Rollout .*🛫 2026-03-09 📅 2026-03-17/)],
        ['Software.md', '🏁 Beta 📅 2026-03-04 @deliverable(software/release-1)'],
        ['Software.md', '🏁 Launch 📅 2026-03-27'],
        ['Notes.md', '- [ ] Write docs 📅 2026-02-08 @deliverable(software/release-1)']
      ])
    )
    expect(written).toHaveLength(6)
    expect(setFrontmatter).toHaveBeenCalledWith(
      'Software.md',
      expect.objectContaining({ start: '2026-01-08', end: '2026-04-07' })
    )
    expect(setFrontmatter.mock.invocationCallOrder[0]).toBeGreaterThan(
      Math.max(...replaceLine.mock.invocationCallOrder)
    )
  })

  it('writes only the side of its dates a project declared', async () => {
    const model = buildPlannerModel(twoProjects(['end: 2026-03-31']))
    await moveProject(
      model,
      model.projects.find((p) => p.slug === 'software')!,
      -3
    )
    const fm = setFrontmatter.mock.calls[0][1] as Record<string, unknown>
    expect(fm.end).toBe('2026-03-28')
    expect(fm.start).toBeUndefined()
  })

  it('a project with no dates moves its contents and leaves its frontmatter alone', async () => {
    const model = buildPlannerModel(twoProjects([]))
    await moveProject(
      model,
      model.projects.find((p) => p.slug === 'software')!,
      2
    )
    expect(replaceLine).toHaveBeenCalled()
    expect(setFrontmatter).not.toHaveBeenCalled()
  })
})
