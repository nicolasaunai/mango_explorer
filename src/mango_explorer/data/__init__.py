# src/mango_explorer/data/__init__.py
"""Active data source for mango_explorer.

The four public functions below proxy to the active Source instance.
"""
from __future__ import annotations

from .base import Source

_active: Source | None = None


def set_active(source: Source) -> None:
    global _active
    _active = source


def _require() -> Source:
    if _active is None:
        raise RuntimeError("No active data source. Call mango_explorer.config.use_source(...)")
    return _active


def regions() -> list[str]:
    return _require().regions()


def filters(region: str) -> list[dict]:
    return _require().filters(region)


def columns(region: str) -> list[str]:
    return _require().columns(region)


def get_data(region: str, **kwargs) -> dict:
    return _require().get_data(region, **kwargs)
