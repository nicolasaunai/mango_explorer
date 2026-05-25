from mango_explorer.papers import PAPERS, EVENT_TYPES, get_random_paper


def test_event_types_present():
    assert set(EVENT_TYPES) == {"FTE", "EDR", "Jet", "Current Sheet", "KH Wave", "Mirror Mode"}


def test_get_random_paper_is_deterministic_with_seed():
    p1 = get_random_paper("FTE", seed=42)
    p2 = get_random_paper("FTE", seed=42)
    assert p1 == p2
    assert "doi" in p1 and "title" in p1
