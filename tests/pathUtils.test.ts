import { describe, expect, it } from 'vitest'
import { isDrawioFile, rootNameOf } from '../src/shared/pathUtils'

describe('isDrawioFile', () => {
  it('recognizes raw .drawio XML files', () => {
    expect(isDrawioFile('Diagrams/Architecture.drawio')).toBe(true)
  })

  it('recognizes the editable SVG export format', () => {
    expect(isDrawioFile('Diagrams/Architecture.drawio.svg')).toBe(true)
  })

  it('recognizes the editable PNG export format', () => {
    expect(isDrawioFile('Diagrams/Architecture.drawio.png')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isDrawioFile('Diagrams/Architecture.DRAWIO.SVG')).toBe(true)
  })

  it('rejects a plain image without the .drawio segment', () => {
    expect(isDrawioFile('Attachments/screenshot.svg')).toBe(false)
    expect(isDrawioFile('Attachments/screenshot.png')).toBe(false)
  })

  it('rejects an unrelated file merely containing "drawio"', () => {
    expect(isDrawioFile('Notes/my-drawio-notes.md')).toBe(false)
  })
})

describe('rootNameOf', () => {
  it('returns the primary root ("") for a path with no mount prefix', () => {
    expect(rootNameOf('Weekly/2026-09-06.md', ['teamargos.org'])).toBe('')
  })

  it('returns the mount name when the first segment matches a mount', () => {
    expect(rootNameOf('teamargos.org/docs/x.md', ['teamargos.org'])).toBe('teamargos.org')
  })

  it('is case-insensitive when matching against mount names', () => {
    expect(rootNameOf('TeamArgos.org/docs/x.md', ['teamargos.org'])).toBe('teamargos.org')
  })

  it('returns the primary root when there are no mounts at all', () => {
    expect(rootNameOf('anything/x.md', [])).toBe('')
  })

  it('returns the primary root for a bare top-level note', () => {
    expect(rootNameOf('Home.md', ['teamargos.org'])).toBe('')
  })
})
