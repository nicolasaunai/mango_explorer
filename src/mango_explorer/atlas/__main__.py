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
    src.add_argument("--mango-api", action="store_true",
                     help="download from the MANGO server with space_mango >= 0.2 (cached, resumable)")
    b.add_argument("--spacecraft", nargs="+", help="with --mango-api: only these spacecraft")
    b.add_argument("--years", nargs="+", type=int, help="with --mango-api: only these years")
    b.add_argument("--out", type=Path, required=True)
    b.add_argument("--grid", default="grid-v2")
    b.add_argument("--frames", nargs="+")
    b.add_argument("--cubes", nargs="+")
    b.add_argument("--chunk-rows", type=int, default=sources.CHUNK_ROWS)
    b.add_argument("--sample-fraction", type=float, metavar="F",
                   help="k-NN sample table: keep this random fraction of the samples (1 = all); "
                        "default from the grid spec")
    pk = sub.add_parser("pack", help="gzip an atlas for static hosting")
    pk.add_argument("src", type=Path)
    pk.add_argument("dst", type=Path)
    pk.add_argument("--sample-fraction", type=float, help="thin the k-NN sample table to this fraction of the data")
    args = p.parse_args(argv)
    if args.cmd == "pack":
        from mango_explorer.atlas.store import pack_atlas

        pack_atlas(args.src, args.dst, args.sample_fraction)
        print(f"packed {args.src} -> {args.dst}")
        return

    grid = load_grid(args.grid)
    if args.arrow:
        chunks = sources.iter_arrow_files(args.arrow, args.chunk_rows)
        source = {"kind": "arrow", "files": [f.name for f in args.arrow]}
    elif args.mango_api:
        import space_mango as sm

        chunks = sources.iter_mango_api(args.spacecraft, args.years)
        info = sm.dataset_info()
        version = info["version"] if isinstance(info, dict) else getattr(info, "version", None)
        citation = info.get("citation") if isinstance(info, dict) else getattr(info, "citation", None)
        source = {"kind": "mango-api", "dataset_version": version, "citation": citation,
                  "spacecraft": args.spacecraft or "all", "years": args.years or "all"}
    elif args.parquet_dir:
        chunks = sources.iter_hive_parquet(args.parquet_dir, args.chunk_rows)
        source = {"kind": "hive-parquet", "dir": str(args.parquet_dir)}
    else:
        from mango_explorer.atlas.synthetic import synthetic_magnetosheath

        chunks = sources.iter_polars(synthetic_magnetosheath(args.synthetic), args.chunk_rows)
        source = {"kind": "synthetic", "rows": args.synthetic}
    m = build_atlas(chunks, grid, args.out, frames=args.frames, cube_ids=args.cubes, source=source,
                    sample_fraction=args.sample_fraction)
    print(f"atlas written to {args.out}: {m['stats']}  ({m['build_seconds']} s)")


if __name__ == "__main__":
    main()
