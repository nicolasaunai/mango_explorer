"""Tests for space_mango provenance capture."""
from __future__ import annotations

import subprocess
from pathlib import Path

from mango_explorer.atlas.provenance import _git_commit


def test_git_commit_not_in_repo(tmp_path: Path) -> None:
    """Directory not in a git repo returns empty dict."""
    result = _git_commit(tmp_path)
    assert result == {}


def test_git_commit_clean_repo(tmp_path: Path) -> None:
    """Git repo with one commit (clean) returns commit hash, no dirty flag."""
    # Initialize repo and create one commit
    subprocess.run(
        ["git", "init"],
        cwd=tmp_path,
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "initial"],
        cwd=tmp_path,
        check=True,
        capture_output=True,
    )

    result = _git_commit(tmp_path)
    assert "commit" in result
    assert len(result["commit"]) >= 7
    assert "dirty" not in result


def test_git_commit_dirty_repo(tmp_path: Path) -> None:
    """Git repo with untracked file shows dirty: True."""
    # Initialize repo and create one commit
    subprocess.run(
        ["git", "init"],
        cwd=tmp_path,
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "initial"],
        cwd=tmp_path,
        check=True,
        capture_output=True,
    )

    # Add untracked file
    (tmp_path / "untracked.txt").write_text("content")

    result = _git_commit(tmp_path)
    assert "commit" in result
    assert result.get("dirty") is True
