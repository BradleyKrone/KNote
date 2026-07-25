import { describe, expect, it } from 'vitest'
import { isMermaidFence, parseFence } from '@/editor/mermaidModel'

describe('parseFence', () => {
  it('extracts the language token and body from a fenced block', () => {
    const raw = ['```mermaid', 'graph TD', '  A --> B', '```'].join('\n')
    expect(parseFence(raw)).toEqual({ lang: 'mermaid', body: 'graph TD\n  A --> B' })
  })

  it('only treats the first word of the info string as the language', () => {
    const raw = ['```mermaid foo', 'graph TD', '```'].join('\n')
    expect(parseFence(raw).lang).toBe('mermaid')
  })

  it('does not treat other languages as mermaid', () => {
    const raw = ['```js', 'const x = 1', '```'].join('\n')
    expect(parseFence(raw).lang).toBe('js')
  })

  it('preserves internal blank lines in the body verbatim', () => {
    const raw = ['```mermaid', 'graph TD', '', '  A --> B', '```'].join('\n')
    expect(parseFence(raw).body).toBe('graph TD\n\n  A --> B')
  })

  it('handles a fence with no body lines', () => {
    const raw = ['```mermaid', '```'].join('\n')
    expect(parseFence(raw).body).toBe('')
  })

  it('handles a fence missing its closing marker', () => {
    const raw = ['```mermaid', 'graph TD'].join('\n')
    expect(parseFence(raw).body).toBe('graph TD')
  })
})

describe('isMermaidFence', () => {
  it('is true for an exact "mermaid" info string', () => {
    expect(isMermaidFence('```mermaid\ngraph TD\n```')).toBe(true)
  })

  it('is false for a different language', () => {
    expect(isMermaidFence('```js\nconst x = 1\n```')).toBe(false)
  })

  it('is case-sensitive', () => {
    expect(isMermaidFence('```Mermaid\ngraph TD\n```')).toBe(false)
  })
})
