import { describe, expect, it } from 'vitest'

import { angularSimilarityPercent, similarityBarWidthPct } from './similarity'

describe('angularSimilarityPercent', () => {
  it('maps 1 to 100%', () => {
    expect(angularSimilarityPercent(1)).toBe(100)
  })

  it('maps -1 to 0%', () => {
    expect(angularSimilarityPercent(-1)).toBe(0)
  })

  it('clamps out-of-range values', () => {
    expect(angularSimilarityPercent(2)).toBe(angularSimilarityPercent(1))
    expect(angularSimilarityPercent(-2)).toBe(angularSimilarityPercent(-1))
  })
})

describe('similarityBarWidthPct', () => {
  it('maps min to 0 and max to 100', () => {
    expect(similarityBarWidthPct(10, 10, 50)).toBe(0)
    expect(similarityBarWidthPct(50, 10, 50)).toBe(100)
    expect(similarityBarWidthPct(30, 10, 50)).toBe(50)
  })

  it('returns 100 when range is degenerate', () => {
    expect(similarityBarWidthPct(42, 42, 42)).toBe(100)
  })
})
