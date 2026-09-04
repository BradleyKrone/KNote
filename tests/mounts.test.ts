import { describe, expect, it } from 'vitest'
import { resolve } from 'path'
import { planMounts } from '../src/core/mounts'

const PRIMARY = resolve('C:/vault/KNote')
const REPO = resolve('C:/git/teamargos.org')
const DOCS = resolve('C:/other/docs')

describe('planMounts', () => {
  it('mounts a folder under its own base name', () => {
    const plan = planMounts(PRIMARY, [REPO], [])
    expect(plan.mounts).toEqual([{ name: 'teamargos.org', root: REPO }])
    expect(plan.rejected).toEqual([])
  })

  it('keeps workspace order and skips the primary root itself', () => {
    const plan = planMounts(PRIMARY, [REPO, PRIMARY, DOCS], [])
    expect(plan.mounts.map((m) => m.name)).toEqual(['teamargos.org', 'docs'])
    // The vault is not a mount of itself, and that is not worth reporting.
    expect(plan.rejected).toEqual([])
  })

  it('rejects a folder the user excluded', () => {
    const plan = planMounts(PRIMARY, [REPO], [], { excluded: [REPO] })
    expect(plan.mounts).toEqual([])
    expect(plan.rejected[0].reason).toMatch(/excluded/)
  })

  it('excludes case-insensitively, as Windows paths compare', () => {
    const plan = planMounts(PRIMARY, [REPO], [], { excluded: [REPO.toUpperCase()] })
    expect(plan.mounts).toEqual([])
  })

  it('rejects a folder nested inside the vault — it is already indexed', () => {
    const inside = resolve(PRIMARY, 'Projects')
    const plan = planMounts(PRIMARY, [inside], [])
    expect(plan.mounts).toEqual([])
    expect(plan.rejected[0].reason).toMatch(/already inside the vault/)
  })

  it('rejects a folder that contains the vault', () => {
    const plan = planMounts(PRIMARY, [resolve('C:/vault')], [])
    expect(plan.rejected[0].reason).toMatch(/contains the vault/)
  })

  it('rejects a folder overlapping one already mounted, so no file gets two paths', () => {
    const nested = resolve(REPO, 'docs')
    const plan = planMounts(PRIMARY, [REPO, nested], [])
    expect(plan.mounts.map((m) => m.name)).toEqual(['teamargos.org'])
    expect(plan.rejected[0].reason).toMatch(/overlaps.*teamargos\.org/)
  })

  it('rejects a name already taken at the vault root rather than renaming it', () => {
    const plan = planMounts(PRIMARY, [DOCS], ['Weekly', 'Docs'])
    expect(plan.mounts).toEqual([])
    expect(plan.rejected[0].reason).toMatch(/already taken/)
  })

  it('rejects two workspace folders sharing a base name, keeping the first', () => {
    const a = resolve('C:/a/docs')
    const b = resolve('C:/b/docs')
    const plan = planMounts(PRIMARY, [a, b], [])
    expect(plan.mounts).toEqual([{ name: 'docs', root: a }])
    expect(plan.rejected[0].path).toBe(b)
  })

  it('honors an explicit mount name, which is how a collision is resolved', () => {
    const a = resolve('C:/a/docs')
    const b = resolve('C:/b/docs')
    const plan = planMounts(PRIMARY, [a, b], [], { names: { [b]: 'b-docs' } })
    expect(plan.mounts.map((m) => m.name)).toEqual(['docs', 'b-docs'])
  })

  it('rejects names KNote would ignore or misread', () => {
    const dotted = resolve('C:/x/.hidden')
    const reserved = resolve('C:/x/node_modules')
    const plan = planMounts(PRIMARY, [dotted, reserved], [])
    expect(plan.mounts).toEqual([])
    expect(plan.rejected.map((r) => r.reason)).toEqual([
      expect.stringMatching(/starts with a dot/),
      expect.stringMatching(/reserved/)
    ])
  })

  it('allows a dotted name that is not a dotfile', () => {
    expect(planMounts(PRIMARY, [REPO], []).mounts[0].name).toBe('teamargos.org')
  })
})
