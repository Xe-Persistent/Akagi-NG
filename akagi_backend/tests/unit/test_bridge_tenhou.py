from unittest.mock import MagicMock, patch

import pytest

from akagi_ng.bridge.tenhou.utils.decoder import Meld, MeldType, parse_owari_tag, parse_sc_tag


@pytest.fixture
def bridge(tenhou_bridge):
    tenhou_bridge.state.seat = 0
    return tenhou_bridge


def test_convert_start_game(bridge):
    """Test _convert_start_game (TAIKYOKU)"""
    message = {"tag": "TAIKYOKU", "oya": "0"}
    result = bridge._convert_start_game(message)
    assert len(result) == 1
    assert result[0]["type"] == "start_game"


def test_convert_tsumo(bridge):
    """Test _convert_tsumo (T...)"""
    message = {"tag": "T132"}
    with patch("akagi_ng.bridge.tenhou.bridge.tenhou_to_mjai_one") as mock_conv:
        mock_conv.return_value = "5z"
        result = bridge._convert_tsumo(message)
        assert len(result) == 1
        assert result[0]["type"] == "tsumo"
        assert result[0]["actor"] == 0
        assert result[0]["pai"] == "5z"


def test_convert_tsumo_high_index(bridge):
    """Test _convert_tsumo with high tile index (U...)"""
    message = {"tag": "U132"}
    with patch("akagi_ng.bridge.tenhou.bridge.tenhou_to_mjai_one") as mock_conv:
        mock_conv.return_value = "5z"
        result = bridge._convert_tsumo(message)
        assert result[0]["actor"] == 1


def test_convert_dahai_tsumogiri(bridge):
    """Test _convert_dahai (D...) Tsumogiri"""
    message = {"tag": "D132"}
    bridge.state.hand = [132]
    with patch("akagi_ng.bridge.tenhou.bridge.tenhou_to_mjai_one") as mock_conv:
        mock_conv.return_value = "5z"
        result = bridge._convert_dahai(message)
        assert len(result) == 1
        assert result[0]["type"] == "dahai"
        assert result[0]["tsumogiri"] is True


def test_convert_meld_pon(bridge):
    """Test _convert_meld (N) PON"""
    message = {"tag": "N", "who": "1", "m": "12345"}
    mock_meld = MagicMock(spec=Meld)
    mock_meld.meld_type = "pon"
    mock_meld.target = 0
    mock_meld.pai = "5z"
    mock_meld.consumed = ["5z", "5z"]

    with patch("akagi_ng.bridge.tenhou.bridge.Meld") as MockMeldClass:
        MockMeldClass.parse_meld.return_value = mock_meld
        result = bridge._convert_meld(message)
        assert len(result) == 1
        assert result[0]["type"] == "pon"
        assert result[0]["actor"] == 1


def test_convert_reach(bridge):
    """Test _convert_reach"""
    message = {"tag": "REACH", "who": "1", "step": "1"}
    result = bridge._dispatch_reach(message)
    assert len(result) == 1
    assert result[0]["type"] == "reach"
    assert result[0]["actor"] == 1


def test_decode_message_heartbeat(bridge) -> None:
    assert bridge._decode_message(b"<Z/>") is None


def test_decode_message_invalid_json(bridge) -> None:
    assert bridge._decode_message(b"not json") is None


def test_convert_un_3p(bridge) -> None:
    message = {"tag": "UN", "n0": "User", "n1": "P1", "n2": "P2", "n3": ""}
    bridge._convert_un(message)
    assert bridge.state.is_3p is True


def test_convert_un_4p(bridge) -> None:
    message = {"tag": "UN", "n0": "User", "n1": "P1", "n2": "P2", "n3": "P3"}
    bridge._convert_un(message)
    assert bridge.state.is_3p is False


def test_convert_dora(bridge) -> None:
    message = {"tag": "DORA", "hai": "4"}
    res = bridge._convert_dora(message)
    assert res[0]["type"] == "dora"
    assert res[0]["dora_marker"] == "2m"


def test_convert_end_game(bridge) -> None:
    bridge.state.game_active = True
    res = bridge._convert_end_game()
    assert res[0]["type"] == "end_game"
    assert bridge.state.game_active is False


def test_convert_ryukyoku(bridge) -> None:
    message = {"tag": "RYUUKYOKU", "sc": "250,10,250,-10,250,10,250,-10"}
    res = bridge._convert_ryukyoku(message)
    assert any(e["type"] == "ryukyoku" for e in res)
    assert any(e["type"] == "end_kyoku" for e in res)


def test_convert_hora(bridge) -> None:
    message = {"tag": "AGARI", "sc": "250,10,250,-10,250,10,250,-10"}
    res = bridge._convert_hora(message)
    assert res[0]["type"] == "end_kyoku"


def test_handle_nukidora(bridge) -> None:
    bridge.state.hand = [120]
    res = bridge._handle_nukidora(0)
    assert res[0]["type"] == "nukidora"
    assert 120 not in bridge.state.hand


def test_convert_start_kyoku(bridge) -> None:
    message = {
        "tag": "INIT",
        "seed": "0,0,0,0,0,4",
        "ten": "250,250,250,250",
        "oya": "0",
        "hai": "0,4,8,12,16,20,24,28,32,36,40,44,48",
    }
    res = bridge._convert_start_kyoku(message)
    assert res[0]["type"] == "start_kyoku"
    assert res[0]["bakaze"] == "E"
    assert res[0]["kyoku"] == 1
    assert res[0]["oya"] == 0


def test_dispatch_reach_accepted(bridge) -> None:
    message = {"tag": "REACH", "who": "0", "step": "2", "ten": "240,250,250,250"}
    res = bridge._dispatch_reach(message)
    assert res[0]["type"] == "reach_accepted"
    assert bridge.state.in_riichi is True


def test_convert_helo_reinit(bridge) -> None:
    bridge.state.game_active = True
    res = bridge._convert_helo({"tag": "HELO"})
    assert res[0]["type"] == "end_game"
    assert bridge.state.game_active is False


def test_meld_parse_chi():
    # 为了得到 5m (16), t_chi 需要是 4
    # t_orig = 12, r = 0
    m = (12 << 10) | 4 | 3
    meld = Meld.parse_meld(m)
    assert meld.meld_type == MeldType.CHI
    assert meld.target == 3
    assert meld.pai in ["5m", "5mr"]
    assert any(p in meld.consumed for p in ["5m", "6m", "7m"])
    assert meld.exposed == [20, 24]


def test_meld_parse_pon():
    # 为了得到 1p (36), t_orig 需要是 27 (27//3*4=36)
    m = (27 << 9) | 8 | 1
    meld = Meld.parse_meld(m)
    assert meld.meld_type == MeldType.PON
    assert meld.target == 1
    assert meld.pai == "1p"


def test_meld_parse_kakan():
    # 为了得到 3p (44), t_orig 需要是 33 (33//3*4=44)
    m = (33 << 9) | 16 | 2
    meld = Meld.parse_meld(m)
    assert meld.meld_type == MeldType.KAKAN
    assert meld.pai == "3p"
    assert meld.exposed == [44]


def test_convert_helo_reinit_active_game(tenhou_bridge) -> None:
    tenhou_bridge.state.game_active = True
    msgs = tenhou_bridge._convert_helo({"tag": "HELO"})
    assert msgs is not None
    assert msgs[0]["type"] == "end_game"
    assert tenhou_bridge.state.game_active is False


def test_convert_rejoin(tenhou_bridge) -> None:
    msgs = tenhou_bridge._convert_rejoin({"tag": "REJOIN"})
    assert msgs is None


def test_convert_un_empty_names(tenhou_bridge) -> None:
    # 2 names -> 2P? Unrealistic but tests the count logic
    msg = {"tag": "UN", "n0": "P1", "n1": "P2", "n2": "", "n3": ""}
    tenhou_bridge._convert_un(msg)
    assert tenhou_bridge.state.is_3p is False  # len([P1, P2]) == 2 != 3


def test_meld_parse_daiminkan_ankan():
    # Daiminkan: target != 0, hai0 = 16 (5m)
    m = (16 << 8) | 1
    meld = Meld.parse_meld(m)
    assert meld.meld_type == MeldType.DAIMINKAN
    assert meld.target == 1
    assert meld.tiles == [16, 17, 18, 19]

    # Ankan: target = 0, hai0 = 20 (6m)
    m = (20 << 8) | 0
    meld = Meld.parse_meld(m)
    assert meld.meld_type == MeldType.ANKAN
    assert meld.target == 0
    assert meld.tiles == [20, 21, 22, 23]
    assert meld.consumed == ["6m", "6m", "6m", "6m"]
    assert meld.exposed == [20, 21, 22, 23]


def test_parse_tags():
    sc_msg = {"sc": "250,10,250,-10,250,10,250,-10"}
    assert parse_sc_tag(sc_msg) == [26000, 24000, 26000, 24000]

    owari_msg = {"owari": "250,10,250,-10,250,10,250,-10"}
    assert parse_owari_tag(owari_msg) == [25000, 25000, 25000, 25000]
