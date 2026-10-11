"""Offline pipeline that turns MANGO rows (through space_mango) into the static atlas read by the web explorer.

The binning contract lives in ``mango_explorer/spec/grid-v3.json``; every module here reads its
edges from :func:`mango_explorer.atlas.grid.load_grid` rather than hard-coding them.
"""
from mango_explorer.atlas.columns import FRAME_COLUMNS
from mango_explorer.atlas.grid import Grid, load_grid
from mango_explorer.atlas.query import cell_statistics

__all__ = ["FRAME_COLUMNS", "Grid", "cell_statistics", "load_grid"]
