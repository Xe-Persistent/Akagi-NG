from unittest.mock import MagicMock, patch

import pytest

from akagi_ng.core.constants import MahjongConstants
from akagi_ng.dataserver.adapter import (
    _attach_riichi_lookahead,
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
    bot.find_chi_candidates.return_value = []
    bot.find_pon_candidates.return_value = []
    bot.find_daiminkan_candidates.return_value = []
    bot.find_ankan_candidates.return_value = []
    bot.find_kakan_candidates.return_value = []
    return bot


# --- Chi Tests ---


def test_handle_chi_fuuro_success(mock_bot):
    mock_bot.find_chi_candidates.return_value = [{"consumed": ["1m", "2m"]}]
    res = _handle_chi_fuuro(mock_bot, "3m")
    assert len(res) == 1
    assert res[0] == {"tile": "3m", "consumed": ["1m", "2m"]}


def test_handle_chi_fuuro_filtering(mock_bot):
    # Eat 3m with: 1m2m, 2m4m, 4m5m
    mock_bot.find_chi_candidates.return_value = [
        {"consumed": ["1m", "2m"]},  # chi_high (3m is largest)
        {"consumed": ["2m", "4m"]},  # chi_mid  (3m is middle)
        {"consumed": ["4m", "5m"]},  # chi_low  (3m is smallest)
    ]

    assert _handle_chi_fuuro(mock_bot, "3m", "chi_low")[0]["consumed"] == ["4m", "5m"]
    assert _handle_chi_fuuro(mock_bot, "3m", "chi_mid")[0]["consumed"] == ["2m", "4m"]
    assert _handle_chi_fuuro(mock_bot, "3m", "chi_high")[0]["consumed"] == ["1m", "2m"]


def test_handle_chi_fuuro_edge_cases(mock_bot):
    # No last_kawa
    assert _handle_chi_fuuro(mock_bot, None) == []

    # Invalid consumed length -> fallback to empty consumed
    mock_bot.find_chi_candidates.return_value = [{"consumed": ["1m"]}]
    res = _handle_chi_fuuro(mock_bot, "3m")
    assert res == [{"tile": "3m", "consumed": []}]

    # No candidates fallback (without chi_type)
    mock_bot.find_chi_candidates.return_value = []
    res = _handle_chi_fuuro(mock_bot, "3m")
    assert res == [{"tile": "3m", "consumed": []}]


def test_handle_chi_fuuro_error(mock_bot):
    mock_bot.find_chi_candidates.side_effect = Exception("error")
    with patch("akagi_ng.dataserver.adapter.logger.warning") as mock_warn:
        res = _handle_chi_fuuro(mock_bot, "3m")
        assert res == []
        mock_warn.assert_called()


# --- Pon Tests ---


def test_handle_pon_fuuro_success(mock_bot):
    mock_bot.find_pon_candidates.return_value = [{"consumed": ["1m", "1m"]}]
    res = _handle_pon_fuuro(mock_bot, "1m")
    assert res == [{"tile": "1m", "consumed": ["1m", "1m"]}]


def test_handle_pon_fuuro_fallback(mock_bot):
    mock_bot.find_pon_candidates.return_value = []
    res = _handle_pon_fuuro(mock_bot, "1m")
    assert res == [{"tile": "1m", "consumed": []}]


def test_handle_pon_fuuro_edge_cases(mock_bot):
    assert _handle_pon_fuuro(mock_bot, None) == []
    mock_bot.find_pon_candidates.side_effect = AttributeError("err")
    assert _handle_pon_fuuro(mock_bot, "1m") == []


# --- Kan Tests ---


def test_handle_kan_fuuro_daiminkan(mock_bot):
    mock_bot.find_daiminkan_candidates.return_value = [{"consumed": ["1m", "1m", "1m"]}]
    res = _handle_kan_fuuro(mock_bot, "1m")
    assert res == [{"tile": "1m", "consumed": ["1m", "1m", "1m"]}]


def test_handle_kan_fuuro_ankan_kakan(mock_bot):
    mock_bot.find_daiminkan_candidates.return_value = []
    mock_bot.find_ankan_candidates.return_value = [{"consumed": ["2m", "2m", "2m", "2m"]}]
    mock_bot.find_kakan_candidates.return_value = [{"consumed": ["3m"]}]
    res = _handle_kan_fuuro(mock_bot, "10z")  # dummy kawa
    assert len(res) == 2
    assert res[0] == {"tile": "2m", "consumed": ["2m", "2m", "2m", "2m"]}
    assert res[1] == {"tile": "3m", "consumed": ["3m"]}


def test_handle_kan_fuuro_empty_consumed(mock_bot):
    mock_bot.find_daiminkan_candidates.return_value = []
    mock_bot.find_ankan_candidates.return_value = [{"consumed": []}]
    res = _handle_kan_fuuro(mock_bot, None)
    assert res == [{"tile": "?", "consumed": []}]


def test_handle_kan_fuuro_error(mock_bot):
    mock_bot.find_daiminkan_candidates.side_effect = Exception("err")
    assert _handle_kan_fuuro(mock_bot, "1m") == []


# --- Hora & Others ---


def test_handle_hora_action(mock_bot):
    # Tsumo - last_self_tsumo
    mock_bot.can_tsumo_agari = True
    mock_bot.last_self_tsumo = "5z"
    item = {}
    _handle_hora_action(item, mock_bot)
    assert item == {"action": "tsumo", "tile": "5z"}

    # Tsumo - tehai fallback
    mock_bot.last_self_tsumo = None
    mock_bot.tehai = ["1m", "2m"]
    item = {}
    _handle_hora_action(item, mock_bot)
    assert item == {"action": "tsumo", "tile": "2m"}

    # Ron
    mock_bot.can_tsumo_agari = False
    mock_bot.last_kawa_tile = "9p"
    item = {}
    _handle_hora_action(item, mock_bot)
    assert item == {"action": "ron", "tile": "9p"}

    # Ron - None tile coverage
    mock_bot.last_kawa_tile = None
    item = {"action": "ron"}
    _handle_hora_action(item, mock_bot)
    assert "tile" not in item


def test_handle_hora_action_tehai_missing(mock_bot):
    # Coverage for line 126->exit
    mock_bot.can_tsumo_agari = True
    mock_bot.last_self_tsumo = None
    mock_bot.tehai = []  # empty tehai
    item = {"action": "tsumo"}
    _handle_hora_action(item, mock_bot)
    assert item == {"action": "tsumo"}


def test_get_fuuro_details_dispatch(mock_bot):
    with patch("akagi_ng.dataserver.adapter._handle_chi_fuuro") as m:
        _get_fuuro_details("chi_low", mock_bot)
        m.assert_called_with(mock_bot, "3m", chi_type="chi_low")

    with patch("akagi_ng.dataserver.adapter._handle_pon_fuuro") as m:
        _get_fuuro_details("pon", mock_bot)
        m.assert_called_with(mock_bot, "3m")

    with patch("akagi_ng.dataserver.adapter._handle_kan_fuuro") as m:
        _get_fuuro_details("kan", mock_bot)
        m.assert_called_with(mock_bot, "3m")

    assert _get_fuuro_details("unknown", mock_bot) == []


# --- Build Payload & Pipeline ---


def test_process_standard_recommendations_detailed(mock_bot):
    meta = {
        "q_values": [0] * 46,
        "mask_bits": [0] * 46,
    }
    # Coverage for line 140 (missing keys)
    assert _process_standard_recommendations({}, mock_bot) == []

    with patch("akagi_ng.dataserver.adapter.meta_to_recommend") as mock_m2r:
        # Test chi_low mapping and multi-fuuro expansion
        mock_m2r.return_value = [("chi_low", 0.9)]
        mock_bot.find_chi_candidates.return_value = [{"consumed": ["4m", "5m"]}]
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
        assert len(recs[0]["sim_candidates"]) == MahjongConstants.MIN_RIICHI_CANDIDATES

        # 2b. Filtered out entirely (line 204 false branch)
        mock_m2r.return_value = [("1m", 0.9)]
        mock_bot.discardable_tiles_riichi_declaration = ["2m"]  # only 2m valid
        recs = [{"action": "reach"}]
        _attach_riichi_lookahead(recs, meta, mock_bot)
        assert "sim_candidates" not in recs[0]

    # 3. No recs from meta_to_recommend (line 190)
    with patch("akagi_ng.dataserver.adapter.meta_to_recommend", return_value=[]):
        recs = [{"action": "reach"}]
        _attach_riichi_lookahead(recs, meta, mock_bot)
        assert "sim_candidates" not in recs[0]

    # 4. Exception path (line 211)
    with patch("akagi_ng.dataserver.adapter.meta_to_recommend", side_effect=Exception("crash")):
        _attach_riichi_lookahead(recs, meta, mock_bot)
        assert "sim_candidates" not in recs[0]

    # 5. Reach not in recommendations (branch not taken loop)
    recs = [{"action": "da"}]
    with patch("akagi_ng.dataserver.adapter.meta_to_recommend", return_value=[("1m", 0.9)]):
        _attach_riichi_lookahead(recs, meta, mock_bot)
        assert "sim_candidates" not in recs[0]


def test_build_dataserver_payload_comprehensive(mock_bot):
    assert build_dataserver_payload({}, None) is None
    assert build_dataserver_payload({}, mock_bot) is None  # no meta

    mjai_res = {
        "meta": {"q_values": [], "mask_bits": [], "engine_type": "test", "is_fallback": False, "circuit_open": False}
    }
    mock_bot.self_riichi_accepted = True

    # Success with logging
    with (
        patch("akagi_ng.dataserver.adapter._process_standard_recommendations", return_value=[{"action": "da"}]),
        patch("akagi_ng.dataserver.adapter.logger.debug") as mock_debug,
    ):
        payload = build_dataserver_payload(mjai_res, mock_bot)
        assert "is_riichi" not in payload
        # Flattened meta check
        assert "engine_type" in payload
        assert "is_fallback" in payload
        assert "circuit_open" in payload
        # Ensure we didn't just copy the whole meta dict under a key
        assert "meta" not in payload

        # Riichi filtering test: action 'da' is not in allowed list, so it should be filtered out
        assert payload["recommendations"] == []
        mock_debug.assert_not_called()

    # Empty recs path
    with patch("akagi_ng.dataserver.adapter._process_standard_recommendations", return_value=[]):
        payload = build_dataserver_payload(mjai_res, mock_bot)
        assert payload["recommendations"] == []

    # Test allowed action in Riichi
    with patch(
        "akagi_ng.dataserver.adapter._process_standard_recommendations",
        return_value=[{"action": "tsumo"}, {"action": "discard"}],
    ):
        payload = build_dataserver_payload(mjai_res, mock_bot)
        assert len(payload["recommendations"]) == 1
        assert payload["recommendations"][0]["action"] == "tsumo"

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
    # Essential: Explicitly set False to prevent MagicMock truthiness from triggering Riichi filter
    mock_bot.self_riichi_accepted = False

    with patch("akagi_ng.dataserver.adapter.meta_to_recommend") as mock_m2r:
        mock_m2r.return_value = [("1m", 0.9)]
        result = build_dataserver_payload(mjai_response, mock_bot)
        assert result is not None
        assert "recommendations" in result
        assert result["recommendations"][0]["action"] == "1m"
