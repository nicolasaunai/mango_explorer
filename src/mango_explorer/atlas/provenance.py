"""Capture provenance of space_mango, accounting for editable installs.

When space_mango is installed editable (`pip install -e`), importlib.metadata.version()
returns the version from install-time metadata, not the actual running code's commit.
This module captures both the reported version and the actual git commit if the code
lives in a git working tree.
"""
from __future__ import annotations

import importlib.metadata
import subprocess
from pathlib import Path


def _git_commit(path: Path) -> dict:
    """Extract git commit info from a directory, or return {} if not in a git repo.

    Args:
        path: Directory to check for git status

    Returns:
        Dict with "commit" (7+ hex chars) and optionally "dirty": True,
        or empty dict if not in a git repo or git command fails.
    """
    try:
        result = subprocess.run(
            ["git", "-C", str(path), "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            return {}
        commit = result.stdout.strip()
        if not commit:
            return {}

        # Check if working tree is dirty
        status_result = subprocess.run(
            ["git", "-C", str(path), "status", "--porcelain"],
            capture_output=True,
            text=True,
            check=False,
        )
        info = {"commit": commit}
        if status_result.returncode == 0 and status_result.stdout.strip():
            info["dirty"] = True
        return info
    except FileNotFoundError:
        # git not found
        return {}


def space_mango_provenance() -> dict:
    """Capture version and git commit of the running space_mango code.

    Returns:
        Dict with at least "version" key. If space_mango's directory is inside
        a git working tree, also includes "commit" and possibly "dirty": True.
    """
    import space_mango

    version = importlib.metadata.version("space-mango")
    info = {"version": version}

    # Find the space_mango package directory and check for git
    sm_path = Path(space_mango.__file__).parent
    git_info = _git_commit(sm_path)
    info.update(git_info)

    return info
