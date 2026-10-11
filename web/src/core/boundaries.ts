// Boundary models; Python reference: src/mango_explorer/boundaries.py

/** Shue et al. 1998 subsolar magnetopause standoff (RE). */
export const shueR0 = (bz: number, pd: number) =>
  (10.22 + 1.29 * Math.tanh(0.184 * (bz + 8.14))) * pd ** (-1 / 6.6);

/** Shue et al. 1998 flaring exponent. */
export const shueAlpha = (bz: number, pd: number) =>
  (0.58 - 0.007 * bz) * (1 + 0.024 * Math.log(pd));

export const shueMp = (theta: number, r0: number, alpha: number) =>
  r0 * (2 / (1 + Math.cos(theta))) ** alpha;

// Jelínek et al. 2012: r = 2 R Pd^(-1/eps) / (cos θ + sqrt(cos²θ + λ² sin²θ))
const jelinek = (theta: number, pd: number, r: number, eps: number, lam: number) => {
  const c = Math.cos(theta), s = Math.sin(theta);
  return (2 * r * pd ** (-1 / eps)) / (c + Math.sqrt(c * c + (lam * s) ** 2));
};
export const jelinekBs = (theta: number, pd: number) => jelinek(theta, pd, 15.02, 6.55, 1.17);
export const jelinekMp = (theta: number, pd: number) => jelinek(theta, pd, 12.82, 5.26, 1.54);
