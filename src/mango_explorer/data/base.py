# src/mango_explorer/data/base.py
"""Abstract data source matching the space-mango client API."""
from __future__ import annotations

from abc import ABC, abstractmethod
import polars as pl


class Source(ABC):
    @abstractmethod
    def regions(self) -> list[str]: ...

    @abstractmethod
    def filters(self, region: str) -> list[dict]: ...

    @abstractmethod
    def columns(self, region: str) -> list[str]: ...

    @abstractmethod
    def get_data(self, region: str, **kwargs) -> pl.DataFrame: ...
