import { describe, expect, it } from 'vitest'
import {
  anchorLine,
  anchorText,
  blockIdOf,
  blockLink,
  generateBlockId,
  linkAlias,
  makeBlockId,
  slugifyBlockId,
  withoutAnchor
} from '@shared/blockAnchor'

describe('blockIdOf', () => {
  it('reads an existing trailing ^block-id', () => {
    expect(blockIdOf('- [ ] Ship the thing ^a1b2c3')).toBe('a1b2c3')
  })
  it('reads an id after a due date', () => {
    expect(blockIdOf('- [/] Do it 📅 2026-07-17 ^xyz789')).toBe('xyz789')
  })
  it('returns null when there is no anchor', () => {
    expect(blockIdOf('- [ ] Ship the thing')).toBeNull()
  })
  it('ignores a ^ that is not at end of line', () => {
    expect(blockIdOf('- [ ] a^b in the middle')).toBeNull()
  })
})

describe('anchorText', () => {
  it('drops the checkbox prefix', () => {
    expect(anchorText('- [ ] Rewire the pump controller')).toBe('Rewire the pump controller')
  })
  it('drops the milestone marker', () => {
    expect(anchorText('🏁 Line 3 commissioned')).toBe('Line 3 commissioned')
  })
  it('strips tags, due dates, priority and an existing anchor', () => {
    expect(anchorText('- [/] Rewire the pump !! #urgent 📅 2026-08-01 ^rewire-the-pump')).toBe(
      'Rewire the pump'
    )
  })
  it('leaves a plain paragraph alone apart from its anchor', () => {
    expect(anchorText('Some ordinary prose ^para-1')).toBe('Some ordinary prose')
  })
  it('tolerates a trailing CR from a CRLF file', () => {
    expect(anchorText('- [ ] Rewire the pump\r')).toBe('Rewire the pump')
  })
})

describe('slugifyBlockId', () => {
  it('slugifies prose into the block-anchor grammar', () => {
    expect(slugifyBlockId('Rewire the pump controller')).toBe('rewire-the-pump-controller')
  })
  it('collapses punctuation runs and trims edge dashes', () => {
    expect(slugifyBlockId('  Order —  parts (again) ')).toBe('order-parts-again')
  })
  it('returns empty when nothing usable survives', () => {
    expect(slugifyBlockId('🚜🔧')).toBe('')
    expect(slugifyBlockId('--- ???')).toBe('')
  })
  it('caps length at a word boundary', () => {
    const slug = slugifyBlockId(
      'Replace the hydraulic manifold on the number four excavator before winter'
    )
    expect(slug.length).toBeLessThanOrEqual(48)
    // Cut between words, never mid-word and never on a trailing dash.
    expect(slug).toBe('replace-the-hydraulic-manifold-on-the-number')
  })
})

describe('makeBlockId', () => {
  it('derives a readable id from the task text', () => {
    expect(makeBlockId('- [ ] Rewire the pump controller')).toBe('rewire-the-pump-controller')
  })
  it('ignores markers and any anchor already on the line', () => {
    expect(makeBlockId('- [/] Rewire the pump #urgent 📅 2026-08-01')).toBe('rewire-the-pump')
  })
  it('suffixes -2, -3 … when the slug is already taken in the note', () => {
    const line = '- [ ] Order parts'
    expect(makeBlockId(line, ['order-parts'])).toBe('order-parts-2')
    expect(makeBlockId(line, ['order-parts', 'order-parts-2'])).toBe('order-parts-3')
  })
  it('treats taken ids case-insensitively, like sectionLine does', () => {
    expect(makeBlockId('- [ ] Order parts', ['ORDER-PARTS'])).toBe('order-parts-2')
  })
  it('falls back to a random id when the text yields no slug', () => {
    const id = makeBlockId('- [ ] 🚜🔧')
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(id).not.toBe('')
  })
  it('always round-trips through blockIdOf once appended', () => {
    for (const text of ['- [ ] Ship it', '🏁 Done', '- [ ] 🚜', 'plain prose']) {
      const id = makeBlockId(text)
      expect(blockIdOf(anchorLine(text, id))).toBe(id)
    }
  })
})

describe('anchorLine', () => {
  it('appends the anchor at end of line', () => {
    expect(anchorLine('- [ ] Ship it', 'ship-it')).toBe('- [ ] Ship it ^ship-it')
  })
  it('trims trailing whitespace so the anchor really is last', () => {
    expect(anchorLine('- [ ] Ship it   ', 'ship-it')).toBe('- [ ] Ship it ^ship-it')
  })
  it('trims a trailing CR from a CRLF file', () => {
    expect(anchorLine('- [ ] Ship it\r', 'ship-it')).toBe('- [ ] Ship it ^ship-it')
  })
})

describe('withoutAnchor', () => {
  it('drops the anchor but keeps the rest of the line verbatim', () => {
    expect(withoutAnchor('- [/] Rewire the pump #urgent 📅 2026-08-01 ^rewire-the-pump')).toBe(
      '- [/] Rewire the pump #urgent 📅 2026-08-01'
    )
  })
  it('leaves an unanchored line alone', () => {
    expect(withoutAnchor('- [ ] Ship it')).toBe('- [ ] Ship it')
  })
  it('round-trips with anchorLine', () => {
    const text = '- [ ] Ship it'
    expect(withoutAnchor(anchorLine(text, 'ship-it'))).toBe(text)
  })
})

describe('linkAlias', () => {
  it('is the task prose, markers stripped', () => {
    expect(linkAlias('- [/] Rewire the pump !! #urgent 📅 2026-08-01 ^rewire-the-pump')).toBe(
      'Rewire the pump'
    )
  })
  it('removes the characters a wiki-link alias cannot hold', () => {
    expect(linkAlias('- [ ] Fix [the] thing | now')).toBe('Fix the thing now')
  })
  it('caps length at a word boundary', () => {
    const alias = linkAlias(
      '- [ ] Replace the hydraulic manifold on the number four excavator before winter sets in'
    )
    expect(alias.length).toBeLessThanOrEqual(60)
    expect(alias).toBe('Replace the hydraulic manifold on the number four excavator')
  })
})

describe('blockLink', () => {
  it('builds a [[Title#^id]] wiki link', () => {
    expect(blockLink('2026-07-17', 'a1b2c3')).toBe('[[2026-07-17#^a1b2c3]]')
  })
  it('aliases the link to the task text when one is given', () => {
    expect(blockLink('Project Alpha', 'rewire-the-pump', 'Rewire the pump')).toBe(
      '[[Project Alpha#^rewire-the-pump|Rewire the pump]]'
    )
  })
  it('omits the alias pipe for an empty alias', () => {
    expect(blockLink('Project Alpha', 'k3f9d1', '')).toBe('[[Project Alpha#^k3f9d1]]')
  })
})

describe('generateBlockId', () => {
  it('is a short url-safe id matching the block-anchor grammar', () => {
    for (let i = 0; i < 50; i++) {
      const id = generateBlockId()
      expect(id).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(id.length).toBeGreaterThan(0)
      // Round-trips through blockIdOf when appended to a line.
      expect(blockIdOf(`- [ ] task ^${id}`)).toBe(id)
    }
  })
})
