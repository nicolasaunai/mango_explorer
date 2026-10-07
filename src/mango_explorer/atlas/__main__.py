"""Command line: python -m mango_explorer.atlas build --out DIR (--arrow F... | --parquet-dir D | --synthetic N)"""
from __future__ import annotations

import argparse
from pathlib import Path

from mango_explorer.atlas import sources
from mango_explorer.atlas.grid import load_grid
from mango_explorer.atlas.pipeline import build_atlas


def main(argv=None) -> None:
    p = argparse.ArgumentParser(prog="python -m mango_explorer.atlas")
    sub = p.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="build a static atlas")
    src = b.add_mutually_exclusive_group(required=True)
    src.add_argument("--arrow", nargs="+", type=Path, help="Arrow IPC files from the MANGO server")
    src.add_argument("--parquet-dir", type=Path, help="<MANGO_DATA_DIR>/magnetosheath")
    src.add_argument("--synthetic", type=int, metavar="N_ROWS", help="synthetic rows (testing)")
    b.add_argument("--out", type=Path, required=True)
    b.add_argument("--grid", default="grid-v1")
    b.add_argument("--frames", nargs="+")
    b.add_argument("--cubes", nargs="+")
    b.add_argument("--chunk-rows", type=int, default=sources.CHUNK_ROWS)
    args = p.parse_args(argv)

    grid = load_grid(args.grid)
    if args.arrow:
        chunks = sources.iter_arrow_files(args.arrow, args.chunk_rows)
        source = {"kind": "arrow", "files": [f.name for f in args.arrow]}
    elif args.parquet_dir:
        chunks = sources.iter_hive_parquet(args.parquet_dir, args.chunk_rows)
        source = {"kind": "hive-parquet", "dir": str(args.parquet_dir)}
    else:
        from mango_explorer.atlas.synthetic import synthetic_magnetosheath

        chunks = sources.iter_polars(synthetic_magnetosheath(args.synthetic), args.chunk_rows)
        source = {"kind": "synthetic", "rows": args.synthetic}
    m = build_atlas(chunks, grid, args.out, frames=args.frames, cube_ids=args.cubes, source=source)
    print(f"atlas written to {args.out}: {m['stats']}  ({m['build_seconds']} s)")


if __name__ == "__main__":
    main()
