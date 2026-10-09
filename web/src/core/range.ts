// A colour range typed by the user in physical units, converted to the colour scale's axis.

/** Axis range (log10 on log scales) of a typed [min, max], or null when it is not a valid range. */
export function axisRange(lo: number, hi: number, log: boolean): [number, number] | null {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo >= hi) return null;
  if (log) return lo > 0 ? [Math.log10(lo), Math.log10(hi)] : null;
  return [lo, hi];
}
