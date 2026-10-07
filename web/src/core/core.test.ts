import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import golden from '$golden/core.json';
import { grid } from './grid';
import { jelinekBs, jelinekMp, shueAlpha, shueMp, shueR0 } from './boundaries';
import { azimuthInFrameDeg, clockAngleDeg, coneAngleDeg, vectorToFrame, type Vec3 } from './frames';
import { histBin, spatialCell } from './binning';
import { histQuantile } from './stats';
import { CubeView, loadManifest, type FetchBytes } from './atlas';

const close = (a: number, b: number, rel = 1e-9, abs = 1e-9) =>
  expect(Math.abs(a - b)).toBeLessThanOrEqual(abs + rel * Math.abs(b));

describe('grid', () => {
  it('matches the Python grid', () => {
    expect(grid.spatialShape).toEqual([10, 20, 24]);
    expect(grid.cubeShape('clock-cone-Ma')).toEqual([12, 6, 5]);
    expect(golden.grid).toBe(grid.raw.version);
  });
});

describe('boundaries', () => {
  const th = golden.boundaries.theta_rad;
  for (const c of golden.boundaries.cases) {
    it(`Bz=${c.bz} Pd=${c.pd}`, () => {
      close(shueR0(c.bz, c.pd), c.shue_r0);
      close(shueAlpha(c.bz, c.pd), c.shue_alpha);
      th.forEach((t, i) => {
        close(shueMp(t, c.shue_r0, c.shue_alpha), c.shue_mp[i]);
        close(jelinekBs(t, c.pd), c.jelinek_bs[i]);
        close(jelinekMp(t, c.pd), c.jelinek_mp[i]);
      });
    });
  }
});

describe('frames', () => {
  const f = golden.frames;
  it('clock and cone angles', () => {
    f.imf.forEach((b, i) => {
      close(clockAngleDeg(b[1], b[2]), f.clock_deg[i]);
      close(coneAngleDeg(b[0], b[1], b[2]), f.cone_deg[i]);
    });
  });
  for (const [name, ref] of Object.entries(f.frames)) {
    it(`vectors and azimuths in ${name}`, () => {
      f.vec.forEach((v, i) => {
        const imf = f.imf[i] as Vec3;
        const p = vectorToFrame(name as never, v as Vec3, imf, false);
        const m = vectorToFrame(name as never, v as Vec3, imf, true);
        p.forEach((x, k) => close(x, ref.position[i][k]));
        m.forEach((x, k) => close(x, ref.magnetic[i][k]));
        const az = azimuthInFrameDeg(name as never, v[1], v[2], imf);
        const d = ((az - ref.azimuth_deg[i] + 540) % 360) - 180;
        close(d, 0, 0, 1e-8);
      });
    });
  }
});

describe('binning and quantiles', () => {
  const b = golden.binning;
  it('spatial cells', () => b.d.forEach((d, i) => expect(spatialCell(d, b.theta_deg[i], b.phi_deg[i])).toBe(b.cell[i])));
  it('histogram bins', () => b.np.forEach((v, i) => expect(histBin(v, 'Np')).toBe(b.np_hbin[i])));
  it('quantiles', () => {
    const edges = grid.histAxisEdges('Np');
    for (const [q, vals] of Object.entries(b.hist_quantiles)) {
      b.hist_counts.forEach((row, i) => {
        const got = histQuantile(row, edges, Number(q));
        if (vals[i] === null) expect(got).toBeNaN();
        else close(got, vals[i] as number);
      });
    }
  });
});

describe('atlas reader', () => {
  const root = fileURLToPath(new URL('../../../golden/atlas-mini/', import.meta.url));
  const fetchBytes: FetchBytes = async (p) => {
    const buf = await readFile(root + p);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  };
  it('reproduces the Python query', async () => {
    const ref = golden.atlas_mini;
    const manifest = await loadManifest(fetchBytes);
    const entry = manifest.cubes.find((c) => c.frame === ref.frame)!;
    const cube = await CubeView.load(entry, fetchBytes);
    const res = await cube.query(ref.quantity as never, ref.selection);
    const edges = grid.histAxisEdges(ref.quantity as never);
    ref.cells.forEach((cell, i) => {
      expect(res.n[cell]).toBe(ref.n[i]);
      expect(res.neffUpper[cell]).toBe(ref.neff_upper[i]);
      close(histQuantile(res.hist, edges, 0.5, cell * grid.nHist, grid.nHist), ref.median_axis[i]);
    });
    const nonzero = Array.from(res.n).filter((x) => x > 0).length;
    expect(nonzero).toBe(ref.cells.length);
  });
});

describe('hour table', () => {
  const root = fileURLToPath(new URL('../../../golden/atlas-mini/', import.meta.url));
  const fetchBytes: FetchBytes = async (p) => {
    const buf = await readFile(root + p);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  };
  it('gives exact counts and clock marginals', async () => {
    const { loadSections } = await import('./atlas');
    const { HourTable } = await import('./hours');
    const ref = golden.atlas_mini;
    const manifest = await loadManifest(fetchBytes);
    const table = new HourTable(await loadSections(fetchBytes, manifest.hours));
    expect(table.counts(ref.selection)).toEqual({ n: ref.hours_n, neff: ref.hours_neff });
    expect(table.marginal('clock_deg', ref.selection).map((c) => c.neff)).toEqual(ref.clock_marginal_neff);
  });
});
