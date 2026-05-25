import pytest
from mango_explorer import config
from mango_explorer import data


def test_use_source_fake_makes_data_callable():
    config.use_source("fake", seed=1, n_points=200)
    assert "magnetosheath" in data.regions()
    df = data.get_data("magnetosheath")
    assert len(df) > 0


def test_use_source_unknown_raises():
    with pytest.raises(ValueError):
        config.use_source("nope")
