"""Command line: python -m mango_explorer.atlas build --out DIR (--mango-api | --synthetic N)"""
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
    src.add_argument("--mango-api", action="store_true",
                     help="download from the MANGO server with space_mango >= 0.3 (cached, resumable)")
    src.add_argument("--synthetic", type=int, metavar="N_ROWS", help="synthetic rows (testing)")
    b.add_argument("--spacecraft", nargs="+", help="with --mango-api: only these spacecraft")
    b.add_argument("--years", nargs="+", type=int, help="with --mango-api: only these years")
    b.add_argument("--out", type=Path, required=True)
    b.add_argument("--grid", default="grid-v3")
    b.add_argument("--frames", nargs="+", help="frames to build (default: every frame of the grid)")
    b.add_argument("--chunk-rows", type=int, default=sources.CHUNK_ROWS)
    b.add_argument("--sample-fraction", type=float, metavar="F",
                   help="k-NN sample tables: keep this random fraction of the samples (1 = all); default from the grid spec")
    pk = sub.add_parser("pack", help="gzip an atlas for static hosting")
    pk.add_argument("src", type=Path)
    pk.add_argument("dst", type=Path)
    pk.add_argument("--sample-fraction", type=float, help="thin the k-NN sample tables to this fraction of the data")
    args = p.parse_args(argv)
    if args.cmd == "pack":
        from mango_explorer.atlas.store import pack_atlas

        pack_atlas(args.src, args.dst, args.sample_fraction)
        print(f"packed {args.src} -> {args.dst}")
        return

    grid = load_grid(args.grid)
    frames = tuple(args.frames or grid.frames)
    if args.mango_api:
        import importlib.metadata

        import space_mango as sm

        from mango_explorer.atlas.columns import mango_request

        streams = {f: sources.iter_mango_api(f, grid, args.spacecraft, args.years) for f in frames}
        info = sm.dataset_info()
        source = {"kind": "mango-api", "space_mango": importlib.metadata.version("space-mango"),
                  "dataset_version": info["version"], "citation": info.get("citation"),
                  "requests": {f: mango_request(f, grid) for f in frames},
                  "spacecraft": args.spacecraft or "all", "years": args.years or "all"}
    else:
        from mango_explorer.atlas.synthetic import synthetic_frame, synthetic_magnetosheath

        df = synthetic_magnetosheath(args.synthetic)
        streams = {f: sources.iter_polars(synthetic_frame(df, f), f, args.chunk_rows) for f in frames}
        source = {"kind": "synthetic", "rows": args.synthetic}
    m = build_atlas(streams, grid, args.out, source=source, sample_fraction=args.sample_fraction)
    print(f"atlas written to {args.out}: {m['stats']}  ({m['build_seconds']} s)")


if __name__ == "__main__":
    main()
