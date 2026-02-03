import json
from unittest.mock import patch

import pytest

from akagi_ng.bridge.riichi_city.bridge import RCMessage
from akagi_ng.bridge.riichi_city.consts import RCAction
from akagi_ng.core.constants import MahjongConstants


@pytest.fixture
def bridge(riichi_city_bridge):
    riichi_city_bridge.uid = 100
    riichi_city_bridge.game_status.player_list = [100, 101, 102, 103]
    riichi_city_bridge.game_status.seat = 0
    return riichi_city_bridge


def make_rc_packet(msg_id: int, msg_type: int, data: dict) -> bytes:
    body = bytes(json.dumps(data), "utf-8")
    msg_len = 15 + len(body)
    packet = msg_len.to_bytes(4, "big")
    packet += b"\x00\x0f\x00\x01"  # HEADER_SIGNATURE
    packet += msg_id.to_bytes(4, "big")
    packet += msg_type.to_bytes(2, "big")
    packet += b"\x01"
    packet += body
    return packet


def test_handle_in_card_brc(bridge):
    """Test _handle_in_card_brc (Draw Tile)"""
    msg_data = {
        "data": {
            "user_id": 101,
            "card": "1m",
        }
    }
    rc_msg = RCMessage(1, 1, msg_data)

    with patch("akagi_ng.bridge.riichi_city.bridge.CARD2MJAI") as mock_mapping:
        mock_mapping.__getitem__.side_effect = lambda x: x
        result = bridge._handle_in_card_brc(rc_msg)
        assert len(result) == 1
        assert result[0]["type"] == "tsumo"
        assert result[0]["actor"] == 1
        assert result[0]["pai"] == "1m"


def test_handle_game_action_brc_dahai(bridge):
    """Test _handle_game_action_brc for DAHAI"""
    msg_data = {
        "data": {
            "action_info": [
                {
                    "action": RCAction.DAHAI_REACH,
                    "user_id": 101,
                    "card": "1m",
                    "move_cards_pos": [MahjongConstants.TSUMO_TEHAI_SIZE],
                    "is_li_zhi": False,
                }
            ]
        }
    }
    rc_msg = RCMessage(1, 1, msg_data)

    with patch("akagi_ng.bridge.riichi_city.bridge.CARD2MJAI") as mock_mapping:
        mock_mapping.__getitem__.side_effect = lambda x: x
        result = bridge._handle_game_action_brc(rc_msg)
        assert len(result) == 1
        assert result[0]["type"] == "dahai"
        assert result[0]["actor"] == 1
        assert result[0]["pai"] == "1m"
        assert result[0]["tsumogiri"] is True


def test_handle_game_action_brc_pon(bridge):
    """Test _handle_game_action_brc for PON"""
    bridge.game_status.last_dahai_actor = 0
    msg_data = {
        "data": {"action_info": [{"action": RCAction.PON, "user_id": 101, "card": "1m", "group_cards": ["1m", "1m"]}]}
    }
    rc_msg = RCMessage(1, 1, msg_data)

    with patch("akagi_ng.bridge.riichi_city.bridge.CARD2MJAI") as mock_mapping:
        mock_mapping.__getitem__.side_effect = lambda x: x
        result = bridge._handle_game_action_brc(rc_msg)
        assert len(result) == 1
        assert result[0]["type"] == "pon"
        assert result[0]["actor"] == 1
        assert result[0]["target"] == 0
        assert result[0]["pai"] == "1m"
        assert result[0]["consumed"] == ["1m", "1m"]


def test_handle_game_action_brc_chi(bridge):
    """Test _handle_game_action_brc for CHI"""
    bridge.game_status.last_dahai_actor = 0
    msg_data = {
        "data": {
            "action_info": [
                {
                    "action": RCAction.CHI_LOW,
                    "user_id": 101,
                    "card": "3m",
                    "group_cards": ["1m", "2m"],
                }
            ]
        }
    }
    rc_msg = RCMessage(1, 1, msg_data)

    with patch("akagi_ng.bridge.riichi_city.bridge.CARD2MJAI") as mock_mapping:
        mock_mapping.__getitem__.side_effect = lambda x: x
        result = bridge._handle_game_action_brc(rc_msg)
        assert len(result) == 1
        assert result[0]["type"] == "chi"
        assert result[0]["actor"] == 1
        assert result[0]["target"] == 0
        assert result[0]["pai"] == "3m"
        assert result[0]["consumed"] == ["1m", "2m"]


def test_handle_game_action_brc_ron(bridge):
    """Test _handle_game_action_brc for RON"""
    msg_data = {
        "data": {
            "action_info": [
                {
                    "action": RCAction.HORA,
                    "user_id": 101,
                }
            ]
        }
    }
    rc_msg = RCMessage(1, 1, msg_data)
    result = bridge._handle_game_action_brc(rc_msg)
    assert len(result) == 1
    assert result[0]["type"] == "end_kyoku"


def test_handle_game_action_brc_reach(bridge):
    """Test _handle_game_action_brc for REACH"""
    msg_data = {
        "data": {
            "action_info": [
                {
                    "action": RCAction.DAHAI_REACH,
                    "user_id": 101,
                    "card": "1m",
                    "move_cards_pos": [0],
                    "is_li_zhi": True,
                }
            ]
        }
    }
    rc_msg = RCMessage(1, 1, msg_data)

    with patch("akagi_ng.bridge.riichi_city.bridge.CARD2MJAI") as mock_mapping:
        mock_mapping.__getitem__.side_effect = lambda x: x
        result = bridge._handle_game_action_brc(rc_msg)
        assert len(result) == 2
        assert result[0]["type"] == "reach"
        assert result[1]["type"] == "dahai"
        assert bridge.game_status.accept_reach is not None


def test_preprocess_invalid_len(bridge) -> None:
    data = b"\x00\x00\x00\x20" + b"\x00" * 10
    assert bridge.preprocess(data) is None


def test_preprocess_invalid_signature(bridge) -> None:
    data = b"\x00\x00\x00\x10" + b"\x00" * 4 + b"\x00" * 8
    assert bridge.preprocess(data) is None


def test_parse_login_uid(bridge) -> None:
    packet = make_rc_packet(1, 0x01, {"uid": 999})
    bridge.parse(packet)
    assert bridge.uid == 999


def test_handle_enter_room(bridge) -> None:
    data = {
        "cmd": "cmd_enter_room",
        "data": {
            "options": {"classify_id": 1, "player_count": 4},
            "players": [
                {"user": {"user_id": 100}},
                {"user": {"user_id": 101}},
                {"user": {"user_id": 102}},
                {"user": {"user_id": 103}},
            ],
        },
    }
    msg = RCMessage(1, 2, data)
    bridge._handle_enter_room(msg)
    assert bridge.game_status.is_3p is False
    assert len(bridge.game_status.player_list) == 4


def test_handle_game_start_4p(bridge) -> None:
    bridge.uid = 100
    bridge.game_status.player_list = [101, 100, 102, 103]
    bridge.game_status.game_start = True
    data = {
        "cmd": "cmd_game_start",
        "data": {
            "quan_feng": 0,
            "bao_pai_card": 0,
            "dealer_pos": 0,
            "ben_chang_num": 0,
            "li_zhi_bang_num": 0,
            "user_info_list": [{"hand_points": 25000}] * 4,
            "hand_cards": [0] * 13,
        },
    }
    msg = RCMessage(1, 2, data)
    res = bridge._handle_game_start(msg)
    assert res[0]["type"] == "start_game"
    assert res[1]["type"] == "start_kyoku"
    assert bridge.game_status.seat == 1


def test_handle_in_card_reach_accepted(bridge) -> None:
    bridge.game_status.accept_reach = {"type": "reach_accepted", "actor": 0}
    data = {"cmd": "cmd_in_card_brc", "data": {"user_id": 100, "card": 0}}
    msg = RCMessage(1, 2, data)
    res = bridge._handle_in_card_brc(msg)
    assert res[0]["type"] == "reach_accepted"
    assert res[1]["type"] == "tsumo"


def test_handle_gang_bao_brc(bridge) -> None:
    data = {"cmd": "cmd_gang_bao_brc", "data": {"cards": [0, 0x22]}}
    msg = RCMessage(1, 2, data)
    bridge._handle_gang_bao_brc(msg)
    assert bridge.game_status.dora_markers == ["2m"]


def test_handle_room_end(bridge) -> None:
    res = bridge._handle_room_end()
    assert res[0]["type"] == "end_game"
    assert bridge.game_status.seat == -1


def test_handle_rc_action_unknown_case(bridge):
    msgs = []
    bridge._handle_rc_action({"action": 999}, msgs)
    assert msgs == []


def test_handle_gang_bao_brc_logic(bridge):
    from akagi_ng.bridge.riichi_city.bridge import GameStatus, RCMessage

    # 0x22 in CARD2MJAI is '2m'
    msg = RCMessage(1, "S2C_GangBao_Brc", {"data": {"cards": [0x22]}})
    bridge.game_status = GameStatus()
    bridge._handle_gang_bao_brc(msg)
    assert "2m" in bridge.game_status.dora_markers


def test_handle_room_end_logic(bridge):
    bridge.game_status.seat = 1
    msgs = bridge._handle_room_end()
    assert msgs[0]["type"] == "end_game"
    assert bridge.game_status.seat == -1  # reset


def test_handle_rc_action_kakan_success(bridge):
    mjai = []
    bridge.game_status.player_list = [100, 200, 300, 400]
    bridge._handle_rc_action({"action": RCAction.KAKAN, "user_id": 100, "card": 4}, mjai)
    assert mjai[0]["type"] == "kakan"
    assert mjai[0]["actor"] == 0


def test_handle_rc_action_types(bridge) -> None:
    mjai = []
    bridge._handle_rc_action({"action": RCAction.ANKAN, "user_id": 100, "card": 0}, mjai)
    assert mjai[0]["type"] == "ankan"

    mjai = []
    bridge._handle_rc_action({"action": RCAction.KAKAN, "user_id": 100, "card": 4}, mjai)
    assert mjai[0]["type"] == "kakan"

    mjai = []
    bridge._handle_rc_action({"action": RCAction.HORA, "user_id": 100}, mjai)
    assert mjai[0]["type"] == "end_kyoku"
