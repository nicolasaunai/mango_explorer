"""Capture provenance of space_mango, accounting for editable installs.

When space_mango is installed editable, importlib.metadata.version() returns install-time
metadata, not the actual running code's commit; this module captures both plus git state.
"""
from __future__ import annotations

import importlib.metadata
import subprocess
from pathlib import Path


def _git_commit(file_path: Path) -> dict:
    """Extract git commit info from a file, or return {} if not tracked by git.

    Only reports commit if the file is tracked by the git repo, to avoid reporting
    the enclosing repository's commit when a package is installed in a gitignored
    directory (e.g., .venv).

    Args:
        file_path: File path to check for git tracking and commit

    Returns:
        Dict with "commit" (7+ hex chars) and optionally "dirty": True,
        or empty dict if not in a git repo, not tracked, or git command fails.
    """
    try:
        # Check if file is tracked by git
        ls_files_result = subprocess.run(
            ["git", "-C", str(file_path.parent), "ls-files", "--error-unmatch", str(file_path)],
            capture_output=True,
            text=True,
            check=False,
        )
        if ls_files_result.returncode != 0:
            # File not tracked by git (or not in a git repo)
            return {}

        # File is tracked, get the commit
        result = subprocess.run(
            ["git", "-C", str(file_path.parent), "rev-parse", "--short", "HEAD"],
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
            ["git", "-C", str(file_path.parent), "status", "--porcelain"],
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
        Dict with at least "version" key; also includes "commit" and possibly
        "dirty": True if the package is tracked in a git working tree.
    """
    import space_mango

    version = importlib.metadata.version("space-mango")
    info = {"version": version}

    # Find the space_mango package __init__.py and check for git
    sm_init = Path(space_mango.__file__)
    git_info = _git_commit(sm_init)
    info.update(git_info)

    return info
