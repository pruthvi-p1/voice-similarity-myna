/** Cosine in [-1, 1] → angular similarity %: 100% aligned, 0% opposite. */
export function angularSimilarityPercent(cosine: number): number {
  const c = Math.max(-1, Math.min(1, cosine))
  return (1 - Math.acos(c) / Math.PI) * 100
}

/** Bar width 0–100 where min and max are from the current result set. */
export function similarityBarWidthPct(
  value: number,
  min: number,
  max: number,
): number {
  if (max <= min) return 100
  return ((value - min) / (max - min)) * 100
}
