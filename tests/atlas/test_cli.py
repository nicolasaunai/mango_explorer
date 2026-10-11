import json

import pytest

from mango_explorer.atlas.__main__ import main


def test_synthetic_build_writes_both_frames(tmp_path):
    main(["build", "--synthetic", "20000", "--out", str(tmp_path)])
    m = json.loads((tmp_path / "manifest.json").read_text())
    assert m["grid"] == "grid-v3" and m["source"]["kind"] == "synthetic"
    assert [c["frame"] for c in m["cubes"]] == ["GSM", "PGSM"]


def test_one_frame_only(tmp_path):
    main(["build", "--synthetic", "8000", "--frames", "PGSM", "--out", str(tmp_path)])
    m = json.loads((tmp_path / "manifest.json").read_text())
    assert [c["frame"] for c in m["cubes"]] == ["PGSM"]


def test_old_sources_are_gone(tmp_path):
    with pytest.raises(SystemExit):
        main(["build", "--parquet-dir", str(tmp_path), "--out", str(tmp_path / "o")])
