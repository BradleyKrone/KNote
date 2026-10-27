import { describe, expect, it } from 'vitest'
import { pathToFileURL } from 'url'
import { encodeFileUrl, isOpenableFileUrl } from '../src/shared/externalUrl'
import { buildMdLink, mdLinkAt } from '../src/webviews/editor/mdLinkLogic'

describe('isOpenableFileUrl', () => {
  it('accepts ordinary documents', () => {
    expect(isOpenableFileUrl('file:///C:/Users/x/My%20Doc.pdf')).toBe(true)
    expect(isOpenableFileUrl('file:///home/x/notes.docx')).toBe(true)
    expect(isOpenableFileUrl('file:///home/x/README')).toBe(true)
  })

  it('refuses runnable files, case-insensitively', () => {
    expect(isOpenableFileUrl('file:///C:/tools/setup.exe')).toBe(false)
    expect(isOpenableFileUrl('file:///C:/tools/run.BAT')).toBe(false)
    expect(isOpenableFileUrl('file:///C:/tools/x%2Eps1')).toBe(false)
  })

  it('refuses other schemes and remote hosts', () => {
    expect(isOpenableFileUrl('https://example.com/a.pdf')).toBe(false)
    expect(isOpenableFileUrl('file://server/share/a.pdf')).toBe(false)
    expect(isOpenableFileUrl('not a url')).toBe(false)
  })
})

describe('file link round trip', () => {
  it('survives spaces and parens inside [text](url)', () => {
    const url = encodeFileUrl(pathToFileURL('/home/x/Report (final) v2.pdf').href)
    const line = buildMdLink('Report', url)
    expect(mdLinkAt(line, 0, 2)?.url).toBe(url)
    expect(isOpenableFileUrl(url)).toBe(true)
  })
})
