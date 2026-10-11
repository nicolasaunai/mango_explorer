"""Write web/src/render/luts.json: 256-entry RGB colormaps for the explorer.

Sources: batlow, grayC, vik (Crameri, Scientific colour maps, 10.5281/zenodo.1243862, via cmcrameri);
viridis, cividis, RdBu_r (matplotlib). Run: .venv/bin/python scripts/make_luts.py
"""
from __future__ import annotations

import json
from pathlib import Path

import matplotlib
import numpy as np
from cmcrameri import cm as ccm

MAPS = {
    "batlow": ccm.batlow,
    "viridis": matplotlib.colormaps["viridis"],
    "cividis": matplotlib.colormaps["cividis"],
    "grayC": ccm.grayC,
    "vik": ccm.vik,
    "RdBu_r": matplotlib.colormaps["RdBu_r"],
}

out = {}
for name, cmap in MAPS.items():
    rgb = (np.asarray(cmap(np.linspace(0, 1, 256)))[:, :3] * 255).round().astype(np.uint8)
    out[name] = rgb.tobytes().hex()
path = Path(__file__).resolve().parents[1] / "web" / "src" / "render" / "luts.json"
path.write_text(json.dumps(out))
print("wrote", path)
