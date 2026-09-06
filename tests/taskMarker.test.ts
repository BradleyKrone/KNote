import { describe, expect, it } from 'vitest'
import {
  isTaskLine,
  setTaskMarker,
  stripInlineMarkers,
  stripTaskMarker,
  taskMarkerRange
} from '@shared/parser/patterns'
import { anchorText, slugifyBlockId } from '@shared/blockAnchor'

describe('isTaskLine', () => {
  it('accepts the marker straight after the checkbox, whatever the bullet or status', () => {
    expect(isTaskLine('- [ ] @task ship it')).toBe(true)
    expect(isTaskLine('- [x] @task ship it')).toBe(true)
    expect(isTaskLine('* [/] @task doing')).toBe(true)
    expect(isTaskLine('+ [w] @task waiting')).toBe(true)
    expect(isTaskLine('1. [ ] @task numbered')).toBe(true)
    expect(isTaskLine('1) [ ] @task numbered')).toBe(true)
  })

  it('ignores indentation entirely', () => {
    expect(isTaskLine('        - [ ] @task deeply indented')).toBe(true)
    expect(isTaskLine('\t\t- [ ] @task tab indented')).toBe(true)
    expect(isTaskLine('- [ ] flush left but unmarked')).toBe(false)
  })

  it('accepts a bare marker with no prose yet', () => {
    expect(isTaskLine('- [ ] @task')).toBe(true)
  })

  it('rejects a marker that is not the first thing after the checkbox', () => {
    expect(isTaskLine('- [ ] see @taskmaster')).toBe(false)
    expect(isTaskLine('- [ ] the @task convention')).toBe(false)
    expect(isTaskLine('- [ ] ship it @task')).toBe(false)
  })

  it('rejects a marker not bounded by whitespace', () => {
    expect(isTaskLine('- [ ] @taskmaster')).toBe(false)
    expect(isTaskLine('- [ ] @task: go')).toBe(false)
  })

  it('rejects lines that are not checkboxes at all', () => {
    expect(isTaskLine('- @task not a checkbox')).toBe(false)
    expect(isTaskLine('@task')).toBe(false)
    expect(isTaskLine('')).toBe(false)
  })

  it('tolerates a trailing CR, so CRLF notes read the same', () => {
    expect(isTaskLine('- [ ] @task ship it\r')).toBe(true)
    expect(isTaskLine('- [ ] @task\r')).toBe(true)
  })

  it('tolerates extra space between the checkbox and the marker', () => {
    expect(isTaskLine('- [ ]  @task ship it')).toBe(true)
  })
})

describe('stripTaskMarker', () => {
  it('cuts the marker off, leaving the prose', () => {
    expect(stripTaskMarker('@task ship it 📅 2026-09-20')).toBe('ship it 📅 2026-09-20')
    expect(stripTaskMarker('@task')).toBe('')
  })

  it('passes unmarked text through untouched', () => {
    expect(stripTaskMarker('ship it')).toBe('ship it')
    expect(stripTaskMarker('the @task convention')).toBe('the @task convention')
    expect(stripTaskMarker('@taskmaster')).toBe('@taskmaster')
  })
})

describe('taskMarkerRange', () => {
  it('locates the marker after the checkbox', () => {
    expect(taskMarkerRange('- [ ] @task hi')).toEqual({ from: 6, to: 11 })
    expect(taskMarkerRange('1. [/] @task hi')).toEqual({ from: 7, to: 12 })
    expect(taskMarkerRange('    - [x] @task hi')).toEqual({ from: 10, to: 15 })
  })

  it('locates it past extra spacing rather than assuming exactly one', () => {
    expect(taskMarkerRange('- [ ]   @task hi')).toEqual({ from: 8, to: 13 })
  })

  it('is null when the line carries no marker', () => {
    expect(taskMarkerRange('- [ ] hi')).toBeNull()
    expect(taskMarkerRange('plain text')).toBeNull()
  })
})

describe('setTaskMarker', () => {
  it('promotes a plain checkbox, preserving indent, bullet and status char', () => {
    expect(setTaskMarker('- [ ] ship it', true)).toBe('- [ ] @task ship it')
    expect(setTaskMarker('  * [x] ship it', true)).toBe('  * [x] @task ship it')
    expect(setTaskMarker('1. [/] ship it', true)).toBe('1. [/] @task ship it')
  })

  it('demotes a task back to a plain checkbox', () => {
    expect(setTaskMarker('- [ ] @task ship it', false)).toBe('- [ ] ship it')
    expect(setTaskMarker('  - [x] @task ship it', false)).toBe('  - [x] ship it')
  })

  it('is idempotent in both directions', () => {
    expect(setTaskMarker('- [ ] @task ship it', true)).toBe('- [ ] @task ship it')
    expect(setTaskMarker('- [ ] ship it', false)).toBe('- [ ] ship it')
  })

  it('handles an empty checkbox', () => {
    expect(setTaskMarker('- [ ]', true)).toBe('- [ ] @task')
    expect(setTaskMarker('- [ ] @task', false)).toBe('- [ ]')
  })

  it('keeps a block anchor last', () => {
    expect(setTaskMarker('- [ ] ship it ^ship-it', true)).toBe('- [ ] @task ship it ^ship-it')
    expect(setTaskMarker('- [ ] @task ship it ^ship-it', false)).toBe('- [ ] ship it ^ship-it')
  })

  it('returns null for a line that is not a checkbox', () => {
    expect(setTaskMarker('- just a bullet', true)).toBeNull()
    expect(setTaskMarker('# heading', true)).toBeNull()
  })
})

describe('the marker never reaches a label', () => {
  it('is stripped by stripInlineMarkers, but only at the head', () => {
    expect(stripInlineMarkers('@task Ship it 📅 2026-09-20 !!')).toBe('Ship it')
    expect(stripInlineMarkers('see @taskmaster')).toBe('see @taskmaster')
    expect(stripInlineMarkers('the @task convention')).toBe('the @task convention')
  })

  it('keeps it out of a block anchor slug and its alias', () => {
    expect(anchorText('- [ ] @task Rewire the pump controller 📅 2026-09-20')).toBe(
      'Rewire the pump controller'
    )
    expect(slugifyBlockId(anchorText('- [ ] @task Rewire the pump'))).toBe('rewire-the-pump')
  })
})
