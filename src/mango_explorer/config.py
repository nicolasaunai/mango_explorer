"""Active-source selector."""
from __future__ import annotations

from . import data
from .data.fake import FakeSource
from .data.remote import RemoteSource


def use_source(name: str, **kwargs) -> None:
    if name == "fake":
        data.set_active(FakeSource(**kwargs))
    elif name == "remote":
        data.set_active(RemoteSource(**kwargs))
    else:
        raise ValueError(f"Unknown source '{name}'. Use 'fake' or 'remote'.")
