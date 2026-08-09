import { describe, expect, it } from 'vitest'
import { isDrawioFile } from '../src/shared/pathUtils'

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
