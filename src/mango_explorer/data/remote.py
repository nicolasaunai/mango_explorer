"""Real MANGO server adapter. Stub for POC.

When the deployment blockers clear (HTTPS + CORS on sciqlop.lpp.polytechnique.fr),
implement these four methods using pyodide.http.pyfetch (in Pyodide) or httpx
(in CPython), decoding Arrow IPC with polars.read_ipc.
"""
from __future__ import annotations

from .base import Source


class RemoteSource(Source):
    def __init__(self, base_url: str = "http://sciqlop.lpp.polytechnique.fr/mango/"):
        self.base_url = base_url

    def regions(self) -> list[str]:
        raise NotImplementedError("RemoteSource is a POC stub")

    def filters(self, region: str) -> list[dict]:
        raise NotImplementedError("RemoteSource is a POC stub")

    def columns(self, region: str) -> list[str]:
        raise NotImplementedError("RemoteSource is a POC stub")

    def get_data(self, region: str, **kwargs) -> dict:
        raise NotImplementedError("RemoteSource is a POC stub")
