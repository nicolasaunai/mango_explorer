// Quantiles from fixed-edge histograms; Python reference: src/mango_explorer/atlas/stats.py

/** Quantile q of one histogram, in axis space; NaN when empty. */
export function histQuantile(counts: ArrayLike<number>, edges: number[], q: number, offset = 0, nb = edges.length - 1): number {
  let total = 0;
  for (let i = 0; i < nb; i++) total += counts[offset + i];
  if (total <= 0) return NaN;
  const target = q * total;
  let cum = 0;
  for (let i = 0; i < nb; i++) {
    const c = counts[offset + i];
    if (cum + c >= target) {
      const frac = c > 0 ? (target - cum) / c : 0;
      return edges[i] + frac * (edges[i + 1] - edges[i]);
    }
    cum += c;
  }
  return edges[nb];
}
