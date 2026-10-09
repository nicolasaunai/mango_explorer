import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import golden from '$golden/core.json';
import { grid } from './grid';
import { jelinekBs, jelinekMp, shueAlpha, shueMp, shueR0 } from './boundaries';
import { histBin, spatialCell } from './binning';
import { histQuantile } from './stats';
import { CubeView, loadManifest, type FetchBytes } from './atlas';

const close = (a: number, b: number, rel = 1e-9, abs = 1e-9) =>
  expect(Math.abs(a - b)).toBeLessThanOrEqual(abs + rel * Math.abs(b));

describe('grid', () => {
  it('matches the Python grid', () => {
    expect(grid.spatialShape).toEqual([10, 20, 24]);
    expect(grid.cubeShape('clock-cone-Ma')).toEqual([12, 12, 5]);
    expect(grid.cubeShape('cone-Ma')).toEqual([12, 5]);
    expect(grid.frameConditions('PGSM')).not.toContain('clock_deg');
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
    const bySc = await cube.spacecraftCounts(ref.cells[0], ref.selection);
    expect(bySc.reduce((a, b) => a + b, 0)).toBe(ref.n[0]);
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
  it('gives exact counts and clock marginals; ignores conditions it does not hold', async () => {
    const { loadSections, hoursEntry } = await import('./atlas');
    const { HourTable } = await import('./hours');
    const ref = golden.atlas_mini.hours;
    const manifest = await loadManifest(fetchBytes);
    const table = new HourTable(await loadSections(fetchBytes, hoursEntry(manifest, 'GSM')!));
    expect(table.counts(ref.selection)).toEqual({ n: ref.n, neff: ref.neff });
    expect(table.marginal('clock_deg', ref.selection).map((c) => c.neff)).toEqual(ref.clock_marginal_neff);
    const pgsm = new HourTable(await loadSections(fetchBytes, hoursEntry(manifest, 'PGSM')!));
    // a PGSM table holds no clock column: a clock selection is ignored, not a crash
    expect(pgsm.counts({ clock_deg: [3] }).n).toBe(ref.pgsm_n);
    expect(pgsm.marginal('clock_deg', {}).every((c) => c.n === 0)).toBe(true);
  });
});

describe('k-NN', () => {
  const root = fileURLToPath(new URL('../../../golden/atlas-mini/', import.meta.url));
  const fetchBytes: FetchBytes = async (p) => {
    const buf = await readFile(root + p);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  };
  it('reference boundaries match Python', async () => {
    const { DISPLAY_BOUNDARIES: b } = await import('./display');
    const ref = golden.reference;
    ref.theta_rad.forEach((t, i) => { close(b.rMp(t), ref.mp[i]); close(b.rBs(t), ref.bs[i]); });
  });
  it('reproduces the Python k-NN statistics', async () => {
    const { SampleTable } = await import('./atlas');
    const { SpatialHash, knnAt } = await import('./knn');
    const ref = golden.atlas_mini, kn = ref.knn;
    const table = await SampleTable.load(await loadManifest(fetchBytes), 'PGSM', fetchBytes);
    const rows = table.rows(ref.selection);
    expect(rows.length).toBe(kn.n_samples);
    const t = table.base, vals = await table.quantity('Np_ratio');
    const pos = new Float64Array(rows.length * 3), v = new Float64Array(rows.length), iv = new Float64Array(rows.length);
    rows.forEach((r, i) => {
      pos.set([t.x[r], t.y[r], t.z[r]], 3 * i);
      v[i] = vals[r]; iv[i] = t.interval[r];
    });
    const hash = new SpatialHash(pos, kn.cap);
    kn.nodes.forEach((node, i) => {
      const r = knnAt(hash, v, iv, node as [number, number, number], kn.k, kn.cap);
      expect(r.n).toBe(kn.n[i]);
      expect(r.neff).toBe(kn.neff[i]);
      for (const key of ['median', 'q25', 'q75', 'dist_median'] as const) {
        const want = kn[key][i], got = key === 'dist_median' ? r.distMedian : r[key];
        if (want === null) expect(got).toBeNaN(); else close(got, want, 1e-6, 1e-6);
      }
    });
  });
});

describe('packed atlases', () => {
  it('gunzips .gz payloads and leaves plain bytes alone', async () => {
    const { gzipSync } = await import('node:zlib');
    const { maybeGunzip } = await import('./atlas');
    const plain = new Uint8Array([1, 2, 3, 250]);
    const gz = gzipSync(plain);
    const out = new Uint8Array(await maybeGunzip(gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength) as ArrayBuffer));
    expect(Array.from(out)).toEqual([1, 2, 3, 250]);
    expect(Array.from(new Uint8Array(await maybeGunzip(plain.buffer)))).toEqual([1, 2, 3, 250]);
  });
});

describe('voxel k-NN', () => {
  const root = fileURLToPath(new URL('../../../golden/atlas-mini/', import.meta.url));
  const fetchBytes: FetchBytes = async (p) => {
    const buf = await readFile(root + p);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  };
  it('reproduces the Python voxel k-NN (1/d-weighted and plain means)', async () => {
    const { VoxelFrame, voxelKnnAt } = await import('./voxels');
    const ref = golden.atlas_mini, gv = ref.voxel_knn;
    const frame = await VoxelFrame.load(await loadManifest(fetchBytes), 'PGSM', fetchBytes);
    const set = await frame.select('Np_ratio', ref.selection, gv.cap / 2);
    expect(set.total).toBe(gv.n_selected);
    expect(set.vid.length).toBe(gv.n_voxels_selected);
    for (const [name, weighted] of [['weighted', true], ['uniform', false]] as const) {
      gv.nodes.forEach((node, i) => {
        const r = voxelKnnAt(set, node as [number, number, number], gv.k, gv.cap, grid.raw.knn.search_factor, weighted);
        const want = gv[name];
        expect(r.nVoxels).toBe(want.n_voxels[i]);
        expect(r.n).toBe(want.n[i]);
        if (want.value[i] === null) expect(r.value).toBeNaN(); else close(r.value, want.value[i] as number, 1e-6, 1e-9);
        if (want.dist_median[i] === null) expect(r.distMedian).toBeNaN(); else close(r.distMedian, want.dist_median[i] as number, 1e-9, 1e-9);
      });
    }
  });
  it('reproduces the Python vector voxel k-NN (V and B)', async () => {
    const { VoxelFrame, voxelVectorAt } = await import('./voxels');
    const ref = golden.atlas_mini, gv = ref.vector_knn;
    const frame = await VoxelFrame.load(await loadManifest(fetchBytes), 'PGSM', fetchBytes);
    for (const name of ['V_vec', 'B_vec'] as const) {
      const set = await frame.selectVector(name, ref.selection, gv.cap / 2);
      gv.nodes.forEach((node, i) => {
        const r = voxelVectorAt(set, node as [number, number, number], gv.k, gv.cap, grid.raw.knn.search_factor);
        const want = gv[name][i];
        if (want[0] === null) expect(r).toBeNull();
        else want.forEach((w, c) => close(r![c], w as number, 1e-6, 1e-9));
      });
    }
  });
  it('says clearly when the atlas has no vector sums', async () => {
    const { VoxelFrame } = await import('./voxels');
    const m = structuredClone(await loadManifest(fetchBytes));
    for (const f of m.voxels!.frames) for (const c of 'xyz') delete f.quantities[`B_vec_${c}`];
    const frame = await VoxelFrame.load(m, 'PGSM', fetchBytes);
    await expect(frame.selectVector('B_vec', golden.atlas_mini.selection, 1)).rejects.toThrow(/no B_vec voxel sums/);
  });
  it('tells whether every voxel frame carries the V and B vector sums', async () => {
    const { hasVectors } = await import('./atlas');
    const m = await loadManifest(fetchBytes);
    expect(hasVectors(m)).toBe(true);
    const noB = structuredClone(m);
    delete noB.voxels!.frames.find((f) => f.frame === 'GSM')!.quantities.B_vec_x;
    expect(hasVectors(noB)).toBe(false);
    const noV = structuredClone(m);
    for (const f of noV.voxels!.frames) for (const c of 'xyz') delete f.quantities[`V_vec_${c}`];
    expect(hasVectors(noV)).toBe(false);
    expect(hasVectors({ ...m, voxels: undefined })).toBe(false);
    expect(hasVectors(null)).toBe(false);
  });
});
