import { describe, expect, it } from 'vitest'
import { shouldShowUpdateNotice } from '@shared/updateNotice'

describe('shouldShowUpdateNotice', () => {
  it('stays silent on first install (no previous version recorded)', () => {
    expect(shouldShowUpdateNotice(undefined, '3.3.0')).toBe(false)
  })

  it('stays silent when the version is unchanged', () => {
    expect(shouldShowUpdateNotice('3.3.0', '3.3.0')).toBe(false)
  })

  it('notifies when the version changed', () => {
    expect(shouldShowUpdateNotice('3.2.0', '3.3.0')).toBe(true)
  })

  it('notifies on a downgrade too', () => {
    expect(shouldShowUpdateNotice('3.3.0', '3.2.0')).toBe(true)
  })
})
