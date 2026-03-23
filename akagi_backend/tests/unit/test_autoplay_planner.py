from types import SimpleNamespace

import pytest

from akagi_ng.autoplay.planner import ActionPlanner
from akagi_ng.schema.constants import MahjongConstants


def _mock_cans(**overrides):
    defaults = {
        "can_discard": True,
        "can_riichi": False,
        "can_chi": False,
        "can_chi_low": False,
        "can_chi_mid": False,
        "can_chi_high": False,
        "can_pon": False,
        "can_kan": False,
        "can_ankan": False,
        "can_kakan": False,
        "can_daiminkan": False,
        "can_tsumo_agari": False,
        "can_ron_agari": False,
        "can_ryukyoku": False,
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def _mock_player_state(*, cans=None, kakan_candidates=None):
    return SimpleNamespace(
        last_cans=cans or _mock_cans(),
        kakan_candidates=lambda: list(kakan_candidates or []),
    )


def test_plan_tsumogiri_discard_targets_drawn_tile():
    planner = ActionPlanner()

    plan = planner.plan(
        {"type": "dahai", "pai": "5m", "tsumogiri": True},
        ["1m", "2m", "3m", "4m", "6m", "7m", "8m", "9m", "1p", "2p", "3p", "4p", "5p"],
        "5m",
    )

    assert len(plan) == 1
    assert plan[0].label == "discard"
    assert plan[0].expected_types == (1,)


def test_plan_reach_click_appends_follow_up_discard():
    planner = ActionPlanner()
    planner.update_operation_list([{"type": 7, "combination": []}])

    plan = planner.plan(
        {"type": "reach", "pai": "1m"},
        ["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1p", "2p", "3p", "4p"],
        None,
    )

    assert [click.label for click in plan] == ["reach", "reach-discard"]
    assert planner.reached is True
    assert planner.pending_reach_discard is False


def test_plan_nukidora_button_supported():
    planner = ActionPlanner()
    planner.update_operation_list([{"type": 11, "combination": []}])

    plan = planner.plan(
        {"type": "nukidora"},
        ["N", "1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1p", "2p", "3p"],
        None,
    )

    assert len(plan) == 1
    assert plan[0].label == "nukidora"
    assert plan[0].expected_types == (11,)


def test_plan_chi_candidate_uses_fallback_operation_reconstruction():
    planner = ActionPlanner()
    player_state = _mock_player_state(
        cans=_mock_cans(can_chi=True, can_chi_low=True, can_chi_mid=True, can_chi_high=True)
    )

    plan = planner.plan(
        {"type": "chi", "consumed": ["1m", "2m"]},
        ["1m", "2m", "2m", "4m", "4m", "5m", "6m", "7m", "8m", "9m", "1p", "2p", "3p"],
        None,
        player_state=player_state,
        last_kawa_tile="3m",
    )

    assert len(plan) == 2
    assert plan[0].label == "chi"
    assert plan[1].label == "chi-candidate"


def test_plan_opening_discard_after_nukidora_targets_tsumo_slot_without_overflow():
    planner = ActionPlanner()

    tehai = ["2p", "3p", "4p", "5p", "8p", "9p", "2s", "2s", "3s", "3s", "3s", "P", "P", "P"]
    plan = planner.plan(
        {"type": "dahai", "pai": "C", "tsumogiri": False},
        tehai,
        "C",
    )

    assert len(plan) == 1
    assert plan[0].label == "discard"
    assert plan[0].coord == planner.get_pai_coord(MahjongConstants.TEHAI_SIZE, tehai)


def test_get_pai_coord_clamps_overflow_indexes_to_tsumo_slot():
    planner = ActionPlanner()
    tehai = ["1m"] * 14

    assert planner.get_pai_coord(14, tehai) == planner.get_pai_coord(MahjongConstants.TEHAI_SIZE, tehai)


def test_get_pai_coord_uses_shortened_tsumo_slot_after_open_meld():
    planner = ActionPlanner()
    tehai = ["2p", "3p", "4p", "5pr", "6p", "6p", "4s", "4s", "6s", "8s", "E"]

    assert planner.get_pai_coord(MahjongConstants.TEHAI_SIZE, tehai) == pytest.approx((11.175, 8.3625))


def test_plan_discard_finds_last_hand_tile_when_tracker_tehai_already_has_14_tiles():
    planner = ActionPlanner()
    planner.is_new_round = False

    tehai = ["1p", "2p", "3p", "7p", "7p", "8p", "9p", "3s", "7s", "9s", "9s", "S", "S", "P"]
    plan = planner.plan(
        {"type": "dahai", "pai": "P", "tsumogiri": False},
        tehai,
        "1p",
    )

    assert len(plan) == 1
    assert plan[0].label == "discard"
    assert plan[0].coord == planner.get_pai_coord(12, tehai)
