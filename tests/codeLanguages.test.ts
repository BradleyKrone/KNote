import { describe, expect, it } from 'vitest'
import { resolveCodeLanguage } from '@/editor/codeLanguages'

describe('resolveCodeLanguage', () => {
  it('resolves canonical language names', () => {
    expect(resolveCodeLanguage('python')).toBe('python')
    expect(resolveCodeLanguage('rust')).toBe('rust')
  })

  it('resolves common aliases', () => {
    expect(resolveCodeLanguage('js')).toBe('javascript')
    expect(resolveCodeLanguage('ts')).toBe('typescript')
    expect(resolveCodeLanguage('py')).toBe('python')
    expect(resolveCodeLanguage('sh')).toBe('bash')
    expect(resolveCodeLanguage('yml')).toBe('yaml')
    expect(resolveCodeLanguage('c')).toBe('cpp')
  })

  it('is case-insensitive and trims whitespace', () => {
    expect(resolveCodeLanguage('  JavaScript  ')).toBe('javascript')
    expect(resolveCodeLanguage('PY')).toBe('python')
  })

  it('returns null for unknown or empty languages', () => {
    expect(resolveCodeLanguage('brainfuck')).toBeNull()
    expect(resolveCodeLanguage('')).toBeNull()
    expect(resolveCodeLanguage('   ')).toBeNull()
  })
})
