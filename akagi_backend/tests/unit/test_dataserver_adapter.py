from unittest.mock import MagicMock, patch

import pytest

from akagi_ng.dataserver.adapter import (
    _attach_riichi_lookahead,
    _extract_consumed,
    _get_fuuro_details,
    _handle_chi_fuuro,
    _handle_hora_action,
    _handle_kan_fuuro,
    _handle_pon_fuuro,
    _process_standard_recommendations,
    build_dataserver_payload,
)


@pytest.fixture
def mock_bot():
    bot = MagicMock()
    bot.is_3p = False
    bot.last_kawa_tile = "3m"
    bot.tehai_mjai_with_aka = []

    ps = MagicMock()
    ps.last_cans.can_chi_low = False
    ps.last_cans.can_chi_mid = False
    ps.last_cans.can_chi_high = False
    ps.last_cans.can_pon = False
    ps.last_cans.can_daiminkan = False
    ps.ankan_candidates.return_value = []
    ps.kakan_candidates.return_value = []

    bot.player_state = ps
    return bot


# --- Core Helper Tests ---


def test_extract_consumed_no_aka():
    hand = ["1m", "2m", "3m", "4m", "5m"]
    res = _extract_consumed(hand, ["4m", "5m"])
    assert res == ["4m", "5m"]


def test_extract_consumed_with_aka():
    hand = ["1m", "4m", "5m", "5mr"]
    res = _extract_consumed(hand, ["4m", "5m"])
    assert res == ["4m", "5mr"]


def test_extract_consumed_aka_target_multiple():
    # 测试暗杠时优先消耗 aka
    hand = ["5m", "5m", "5m", "5mr"]
    res = _extract_consumed(hand, ["5m", "5m", "5m", "5m"])
    # 结果里必定包含 5mr
    assert res.count("5mr") == 1
    assert res.count("5m") == 3


def test_extract_consumed_fallback():
    # 如果手牌里没有，退回 base
    hand = ["1m"]
    res = _extract_consumed(hand, ["2m", "3m"])
    assert res == ["2m", "3m"]


# --- Chi Tests ---


def test_handle_chi_fuuro_success(mock_bot):
    mock_bot.player_state.last_cans.can_chi_low = True
    mock_bot.tehai_mjai_with_aka = ["4m", "5m"]

    res = _handle_chi_fuuro(mock_bot, "3m", "chi_low")
    assert len(res) == 1
    assert res[0] == {"tile": "3m", "consumed": ["4m", "5m"]}


def test_handle_chi_fuuro_types(mock_bot):
    mock_bot.player_state.last_cans.can_chi_low = True
    mock_bot.player_state.last_cans.can_chi_mid = True
    mock_bot.player_state.last_cans.can_chi_high = True
    mock_bot.tehai_mjai_with_aka = ["1m", "2m", "4m", "5m"]

    res_low = _handle_chi_fuuro(mock_bot, "3m", "chi_low")
    assert res_low[0]["consumed"] == ["4m", "5m"]

    res_mid = _handle_chi_fuuro(mock_bot, "3m", "chi_mid")
    assert res_mid[0]["consumed"] == ["2m", "4m"]

    res_high = _handle_chi_fuuro(mock_bot, "3m", "chi_high")
    assert res_high[0]["consumed"] == ["1m", "2m"]


def test_handle_chi_fuuro_with_aka_priority(mock_bot):
    mock_bot.player_state.last_cans.can_chi_low = True
    mock_bot.tehai_mjai_with_aka = ["4m", "5m", "5mr"]

    res = _handle_chi_fuuro(mock_bot, "3m", "chi_low")
    assert res[0]["consumed"] == ["4m", "5mr"]


def test_handle_chi_fuuro_edge_cases(mock_bot):
    # No last_kawa
    assert _handle_chi_fuuro(mock_bot, None, "chi_low") == []

    # Can chi but parsing fails -> empty consumed
    mock_bot.player_state.last_cans.can_chi_low = True
    res = _handle_chi_fuuro(mock_bot, "E", "chi_low")
    assert res == [{"tile": "E", "consumed": []}]

    # Not allowed by libriichi
    mock_bot.player_state.last_cans.can_chi_low = False
    res = _handle_chi_fuuro(mock_bot, "3m", "chi_low")
    assert res == [{"tile": "3m", "consumed": []}]


# --- Pon Tests ---


def test_handle_pon_fuuro_success(mock_bot):
    mock_bot.player_state.last_cans.can_pon = True
    mock_bot.tehai_mjai_with_aka = ["1m", "1m", "2p"]
    res = _handle_pon_fuuro(mock_bot, "1m")
    assert res == [{"tile": "1m", "consumed": ["1m", "1m"]}]


def test_handle_pon_fuuro_fallback(mock_bot):
    mock_bot.player_state.last_cans.can_pon = False
    res = _handle_pon_fuuro(mock_bot, "1m")
    assert res == [{"tile": "1m", "consumed": []}]


def test_handle_pon_fuuro_with_aka_priority(mock_bot):
    mock_bot.player_state.last_cans.can_pon = True
    mock_bot.tehai_mjai_with_aka = ["5m", "5mr"]
    res = _handle_pon_fuuro(mock_bot, "5m")
    assert "5mr" in res[0]["consumed"]


# --- Kan Tests ---


def test_handle_kan_fuuro_daiminkan(mock_bot):
    mock_bot.player_state.last_cans.can_daiminkan = True
    mock_bot.tehai_mjai_with_aka = ["1m", "1m", "1m"]
    res = _handle_kan_fuuro(mock_bot, "1m")
    assert res == [{"tile": "1m", "consumed": ["1m", "1m", "1m"]}]


def test_handle_kan_fuuro_ankan_kakan(mock_bot):
    mock_bot.player_state.last_cans.can_daiminkan = False
    mock_bot.player_state.ankan_candidates.return_value = ["2m"]
    mock_bot.player_state.kakan_candidates.return_value = ["3m"]

    mock_bot.tehai_mjai_with_aka = ["2m", "2m", "2m", "2m", "3m"]

    res = _handle_kan_fuuro(mock_bot, "10z")  # dummy kawa
    assert len(res) == 2
    assert res[0] == {"tile": "2m", "consumed": ["2m", "2m", "2m", "2m"]}
    assert res[1] == {"tile": "3m", "consumed": ["3m"]}


def test_handle_kan_fuuro_empty_consumed(mock_bot):
    mock_bot.player_state.last_cans.can_daiminkan = False
    res = _handle_kan_fuuro(mock_bot, None)
    assert res == []


# --- Hora & Others ---


def test_handle_hora_action(mock_bot):
    # Tsumo - last_self_tsumo
    mock_bot.can_tsumo_agari = True
    mock_bot.last_self_tsumo = "5z"
    item = {}
    _handle_hora_action(item, mock_bot)
    assert item == {"action": "tsumo", "tile": "5z"}

    # Ron
    mock_bot.can_tsumo_agari = False
    mock_bot.last_kawa_tile = "9p"
    item = {}
    _handle_hora_action(item, mock_bot)
    assert item == {"action": "ron", "tile": "9p"}


def test_get_fuuro_details_dispatch(mock_bot):
    with patch("akagi_ng.dataserver.adapter._handle_chi_fuuro") as m:
        _get_fuuro_details("chi_low", mock_bot)
        m.assert_called_with(mock_bot, "3m", chi_type="chi_low")

    with patch("akagi_ng.dataserver.adapter._handle_pon_fuuro") as m:
        _get_fuuro_details("pon", mock_bot)
        m.assert_called_with(mock_bot, "3m")

    with patch("akagi_ng.dataserver.adapter._handle_kan_fuuro") as m:
        _get_fuuro_details("kan_select", mock_bot)
        m.assert_called_with(mock_bot, "3m")

    assert _get_fuuro_details("unknown", mock_bot) == []


# --- Build Payload & Pipeline ---


def test_process_standard_recommendations_detailed(mock_bot):
    meta = {
        "q_values": [0] * 46,
        "mask_bits": [0] * 46,
    }
    # Coverage for line missing keys
    assert _process_standard_recommendations({}, mock_bot) == []

    with patch("akagi_ng.dataserver.adapter.meta_to_recommend") as mock_m2r:
        # Test chi_low mapping and multi-fuuro expansion
        mock_m2r.return_value = [("chi_low", 0.9)]
        mock_bot.player_state.last_cans.can_chi_low = True
        mock_bot.tehai_mjai_with_aka = ["4m", "5m"]

        res = _process_standard_recommendations(meta, mock_bot)
        assert res[0]["action"] == "chi"
        assert res[0]["consumed"] == ["4m", "5m"]

    with patch("akagi_ng.dataserver.adapter.meta_to_recommend") as mock_m2r:
        # Test 3P nukidora and other actions
        mock_m2r.return_value = [("nukidora", 0.9), ("kan_select", 0.8), ("hora", 0.7)]
        mock_bot.is_3p = True
        mock_bot.can_tsumo_agari = True
        mock_bot.last_self_tsumo = "5z"
        res = _process_standard_recommendations(meta, mock_bot)
        assert res[0]["action"] == "nukidora"
        assert res[0]["tile"] == "N"
        assert res[1]["action"] == "kan"
        assert res[2]["action"] == "tsumo"


def test_attach_riichi_lookahead_all_branches(mock_bot):
    meta = {"riichi_lookahead": {"dummy": "meta"}}

    # Multi-path test
    recs = [{"action": "reach"}]
    mock_bot.discardable_tiles_riichi_declaration = ["1m"]

    with patch("akagi_ng.dataserver.adapter.meta_to_recommend") as mock_m2r:
        # 1. Valid rec
        mock_m2r.return_value = [("1m", 0.9), ("2m", 0.8)]
        _attach_riichi_lookahead(recs, meta, mock_bot)
        assert len(recs[0]["sim_candidates"]) == 1

        # 2. Limit test
        mock_m2r.return_value = [(str(i), 0.5) for i in range(20)]
        mock_bot.discardable_tiles_riichi_declaration = None  # all valid
        _attach_riichi_lookahead(recs, meta, mock_bot)
        assert len(recs[0]["sim_candidates"]) == 5


def test_build_dataserver_payload_comprehensive(mock_bot):
    assert build_dataserver_payload({}, None) is None
    assert build_dataserver_payload({}, mock_bot) is None  # no meta

    mjai_res = {
        "meta": {"q_values": [], "mask_bits": [], "engine_type": "test", "fallback_used": False, "circuit_open": False}
    }
    mock_bot.self_riichi_accepted = True

    # Empty recs path
    with patch("akagi_ng.dataserver.adapter._process_standard_recommendations", return_value=[]):
        payload = build_dataserver_payload(mjai_res, mock_bot)
        assert payload["recommendations"] == []

    # Exception path
    with patch("akagi_ng.dataserver.adapter._process_standard_recommendations", side_effect=RuntimeError("crash")):
        assert build_dataserver_payload(mjai_res, mock_bot) is None


def test_build_dataserver_payload_with_valid_meta(mock_bot):
    """Parity test for test_frontend_adapter_filter.py"""
    mjai_response = {
        "type": "dahai",
        "meta": {
            "q_values": [1.0, 2.0],
            "mask_bits": 3,
        },
    }
    mock_bot.is_3p = False
    mock_bot.last_kawa_tile = "1m"
    mock_bot.self_riichi_accepted = False

    with patch("akagi_ng.dataserver.adapter.meta_to_recommend") as mock_m2r:
        mock_m2r.return_value = [("1m", 0.9)]
        result = build_dataserver_payload(mjai_response, mock_bot)
        assert result is not None
        assert "recommendations" in result
        assert result["recommendations"][0]["action"] == "1m"
