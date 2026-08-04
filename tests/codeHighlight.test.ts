import { describe, expect, it } from 'vitest'
import { hljsHighlight } from '@shared/codeHighlight'
import { renderKnoteMarkdown } from '@shared/renderMarkdown'

describe('hljsHighlight', () => {
  it('highlights a registered language', () => {
    const html = hljsHighlight('const x = 1;', 'javascript')
    expect(html).toContain('hljs-keyword')
  })

  it('is case-insensitive on the language token', () => {
    expect(hljsHighlight('x = 1', 'Python')).not.toBe('')
  })

  it('returns empty for an unknown language', () => {
    expect(hljsHighlight('whatever', 'brainfuck')).toBe('')
  })

  it('returns empty for an empty language', () => {
    expect(hljsHighlight('whatever', '')).toBe('')
  })
})

describe('renderKnoteMarkdown fenced code highlighting', () => {
  it('produces hljs/language classes for a fenced code block', () => {
    const html = renderKnoteMarkdown('```python\nprint(1)\n```\n')
    expect(html).toContain('class="hljs language-python"')
    expect(html).toContain('hljs-')
  })

  it('falls back to plain escaped text for an unknown language', () => {
    const html = renderKnoteMarkdown('```brainfuck\n+++.\n```\n')
    expect(html).toContain('<pre><code class="language-brainfuck">')
  })
})
