"""Tests for space_mango provenance capture."""
from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from mango_explorer.atlas.provenance import _git_commit, space_mango_provenance


def test_git_commit_not_in_repo(tmp_path: Path) -> None:
    """File not in a git repo returns empty dict."""
    fake_file = tmp_path / "pkg" / "__init__.py"
    fake_file.parent.mkdir()
    fake_file.touch()
    result = _git_commit(fake_file)
    assert result == {}


def test_git_commit_clean_repo(tmp_path: Path) -> None:
    """Tracked file in clean repo returns commit hash, no dirty flag."""
    # Initialize repo and create one commit
    subprocess.run(
        ["git", "init"],
        cwd=tmp_path,
        check=True,
        capture_output=True,
    )
    # Create and track a file
    tracked_file = tmp_path / "pkg" / "__init__.py"
    tracked_file.parent.mkdir()
    tracked_file.write_text("# package")
    subprocess.run(
        ["git", "-C", str(tmp_path), "add", str(tracked_file)],
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["git", "-C", str(tmp_path), "-c", "user.email=t@t", "-c", "user.name=t",
         "-c", "commit.gpgsign=false", "commit", "-m", "initial"],
        check=True,
        capture_output=True,
    )

    result = _git_commit(tracked_file)
    assert "commit" in result
    assert len(result["commit"]) >= 7
    assert "dirty" not in result


def test_git_commit_dirty_repo(tmp_path: Path) -> None:
    """Tracked file in dirty repo shows dirty: True."""
    # Initialize repo and create one commit
    subprocess.run(
        ["git", "init"],
        cwd=tmp_path,
        check=True,
        capture_output=True,
    )
    tracked_file = tmp_path / "pkg" / "__init__.py"
    tracked_file.parent.mkdir()
    tracked_file.write_text("# package")
    subprocess.run(
        ["git", "-C", str(tmp_path), "add", str(tracked_file)],
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["git", "-C", str(tmp_path), "-c", "user.email=t@t", "-c", "user.name=t",
         "-c", "commit.gpgsign=false", "commit", "-m", "initial"],
        check=True,
        capture_output=True,
    )

    # Add untracked file
    (tmp_path / "untracked.txt").write_text("content")

    result = _git_commit(tracked_file)
    assert "commit" in result
    assert result.get("dirty") is True


def test_git_commit_ignored_file(tmp_path: Path) -> None:
    """File under gitignored directory returns empty dict even if in a git repo."""
    # Initialize repo
    subprocess.run(
        ["git", "init"],
        cwd=tmp_path,
        check=True,
        capture_output=True,
    )
    # Create .gitignore that ignores venv/
    gitignore = tmp_path / ".gitignore"
    gitignore.write_text("venv/\n")
    subprocess.run(
        ["git", "-C", str(tmp_path), "add", ".gitignore"],
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["git", "-C", str(tmp_path), "-c", "user.email=t@t", "-c", "user.name=t",
         "-c", "commit.gpgsign=false", "commit", "-m", "initial"],
        check=True,
        capture_output=True,
    )
    # Create a file under venv/pkg (not tracked because it's in .gitignore)
    ignored_file = tmp_path / "venv" / "pkg" / "__init__.py"
    ignored_file.parent.mkdir(parents=True)
    ignored_file.write_text("# package")

    result = _git_commit(ignored_file)
    assert result == {}


def test_space_mango_provenance_has_version() -> None:
    """Smoke test: space_mango_provenance() returns dict with version key."""
    pytest.importorskip("space_mango")  # not installed in CI (atlas builds only)
    result = space_mango_provenance()
    assert isinstance(result, dict)
    assert "version" in result
