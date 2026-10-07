"""On-disk atlas: a manifest.json plus little-endian binary files the browser reads directly.

Each binary file is a concatenation of typed sections; the manifest records every section's
name, dtype, length and byte offset. Sections are ordered by item size (4, 2, 1 bytes) so each
one stays naturally aligned for a JS TypedArray view.
"""
from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from mango_explorer.atlas.cube import CubeData
from mango_explorer.atlas.grid import Grid, load_grid

_JS_TYPES = {"uint32": "Uint32Array", "int32": "Int32Array", "uint16": "Uint16Array",
             "uint8": "Uint8Array", "float32": "Float32Array"}


def _write_sections(path: Path, sections: list[tuple[str, np.ndarray]]) -> list[dict]:
    meta, offset = [], 0
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        for name, arr in sorted(sections, key=lambda s: -s[1].dtype.itemsize):
            arr = np.ascontiguousarray(arr, dtype=arr.dtype.newbyteorder("<"))
            f.write(arr.tobytes())
            meta.append({"name": name, "dtype": arr.dtype.name, "length": int(arr.size),
                         "offset": offset})
            offset += arr.nbytes
    return meta


def _read_sections(path: Path, meta: list[dict]) -> dict[str, np.ndarray]:
    raw = path.read_bytes()
    return {s["name"]: np.frombuffer(raw, dtype=np.dtype(s["dtype"]).newbyteorder("<"),
                                     count=s["length"], offset=s["offset"]) for s in meta}


def _split_cell_keys(keys: np.ndarray, n_cells: int, n_cond: int):
    cond = keys // n_cells
    offsets = np.searchsorted(cond, np.arange(n_cond + 1)).astype(np.uint32)
    return offsets, (keys % n_cells).astype(np.uint16)


def write_cube(root: Path, cube: CubeData) -> dict:
    g = cube.grid
    nc, nb, ncond = g.n_cells, g.n_hist, cube.n_conditions
    base = Path("cubes") / cube.cube_id / cube.frame
    entry = {"id": cube.cube_id, "frame": cube.frame, "dims": list(cube.dims),
             "shape": list(cube.shape), "quantities": {}}
    for q, (keys, counts) in cube.hist.items():
        cond = keys // (nc * nb)
        offsets = np.searchsorted(cond, np.arange(ncond + 1)).astype(np.uint32)
        rel = base / f"{q}.bin"
        entry["quantities"][q] = {"path": rel.as_posix(), "sections": _write_sections(root / rel, [
            ("cond_offsets", offsets),
            ("count", counts.astype(np.uint32)),
            ("cell", ((keys // nb) % nc).astype(np.uint16)),
            ("hbin", (keys % nb).astype(np.uint8)),
        ])}
    s_off, s_cell = _split_cell_keys(cube.samples[0], nc, ncond)
    e_off, e_cell = _split_cell_keys(cube.neff[0], nc, ncond)
    rel = base / "counts.bin"
    entry["counts"] = {"path": rel.as_posix(), "sections": _write_sections(root / rel, [
        ("n_cond_offsets", s_off), ("n", cube.samples[1].astype(np.uint32)), ("n_cell", s_cell),
        ("neff_cond_offsets", e_off), ("neff", cube.neff[1].astype(np.uint32)),
        ("neff_cell", e_cell),
    ])}
    n_sc = len(g.spacecraft)
    keys, counts = cube.by_sc
    cc = keys // n_sc
    rel = base / "spacecraft.bin"
    entry["spacecraft"] = {"path": rel.as_posix(), "names": list(g.spacecraft),
                           "sections": _write_sections(root / rel, [
        ("cond_offsets", np.searchsorted(cc // nc, np.arange(ncond + 1)).astype(np.uint32)),
        ("n", counts.astype(np.uint32)),
        ("cell", (cc % nc).astype(np.uint16)),
        ("sc", (keys % n_sc).astype(np.uint8)),
    ])}
    return entry


def read_cube(root: Path, entry: dict, grid: Grid) -> CubeData:
    nc, nb = grid.n_cells, grid.n_hist

    def keys_from(offsets, cell):
        cond = np.repeat(np.arange(len(offsets) - 1), np.diff(offsets.astype(np.int64)))
        return cond * nc + cell.astype(np.int64)

    hist = {}
    for q, f in entry["quantities"].items():
        s = _read_sections(root / f["path"], f["sections"])
        cc = keys_from(s["cond_offsets"], s["cell"])
        hist[q] = (cc * nb + s["hbin"].astype(np.int64), s["count"].astype(np.int64))
    s = _read_sections(root / entry["counts"]["path"], entry["counts"]["sections"])
    sc = _read_sections(root / entry["spacecraft"]["path"], entry["spacecraft"]["sections"])
    n_sc = len(grid.spacecraft)
    by_sc = (keys_from(sc["cond_offsets"], sc["cell"]) * n_sc + sc["sc"].astype(np.int64),
             sc["n"].astype(np.int64))
    return CubeData(
        grid=grid, cube_id=entry["id"], frame=entry["frame"], hist=hist,
        samples=(keys_from(s["n_cond_offsets"], s["n_cell"]), s["n"].astype(np.int64)),
        neff=(keys_from(s["neff_cond_offsets"], s["neff_cell"]), s["neff"].astype(np.int64)),
        by_sc=by_sc,
    )


def write_atlas(root: Path, grid: Grid, cubes: list[CubeData], hours: dict[str, np.ndarray],
                info: dict) -> dict:
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    manifest = {
        "format": "mango-atlas/1",
        "grid": grid.version,
        "created": datetime.now(UTC).isoformat(timespec="seconds"),
        **info,
        "hours": {"path": "hours.bin", "n_rows": len(hours["n"]),
                  "sections": _write_sections(root / "hours.bin", list(hours.items()))},
        "cubes": [write_cube(root, c) for c in cubes],
        "js_types": _JS_TYPES,
    }
    (root / "manifest.json").write_text(json.dumps(manifest, indent=1))
    return manifest


def read_atlas(root: Path):
    root = Path(root)
    manifest = json.loads((root / "manifest.json").read_text())
    grid = load_grid(manifest["grid"])
    cubes = [read_cube(root, e, grid) for e in manifest["cubes"]]
    hours = _read_sections(root / "hours.bin", manifest["hours"]["sections"])
    return manifest, cubes, hours
