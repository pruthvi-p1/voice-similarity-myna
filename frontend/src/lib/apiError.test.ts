import { describe, expect, it } from 'vitest'

import { parseApiError } from './apiError'

describe('parseApiError', () => {
  it('reads string detail', () => {
    expect(parseApiError(400, { detail: 'bad request' })).toBe('bad request')
  })

  it('reads object detail message', () => {
    expect(
      parseApiError(503, {
        detail: { message: 'unavailable', code: 'x' },
      }),
    ).toBe('unavailable')
  })

  it('falls back to status when detail missing', () => {
    expect(parseApiError(500, {})).toBe('Request failed (500)')
  })
})
