"""Record one day of real space_mango output per frame as test fixtures.

Needs space_mango >= 0.3 with the computed PGSM columns. Run from the repo root:
    .venv/bin/python scripts/record_fixture.py
"""
from __future__ import annotations

import importlib.metadata
import json
from pathlib import Path

import space_mango as sm

from mango_explorer.atlas.columns import mango_request
from mango_explorer.atlas.grid import load_grid

OUT = Path(__file__).resolve().parents[1] / "tests" / "data" / "mango"
WINDOW = {"spacecraft": "C1", "start": "2005-01-03", "stop": "2005-01-04"}


def main() -> None:
    g = load_grid()
    OUT.mkdir(parents=True, exist_ok=True)
    for frame in g.frames:
        df = sm.get_data("magnetosheath", **mango_request(frame, g), **WINDOW).to_polars()
        if df.height < 1000:
            raise SystemExit(f"{frame}: only {df.height} rows in {WINDOW}; pick another day")
        df.write_parquet(OUT / f"{frame}.parquet")
    sm.get_data("magnetosheath", **(mango_request("PGSM", g) | {"clock": 37.5}), **WINDOW) \
        .to_polars().write_parquet(OUT / "PGSM_clock37.5.parquet")
    (OUT / "versions.json").write_text(json.dumps({
        "space_mango": importlib.metadata.version("space-mango"),
        "dataset": sm.dataset_info()["version"], "window": WINDOW}, indent=1))


if __name__ == "__main__":
    main()
