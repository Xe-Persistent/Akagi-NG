"""Riichi City Bridge 和 Bot 的集成测试"""

import json

import pytest


def make_rc_msg(msg_id: int, msg_type: int, data: dict) -> bytes:
    json_data = json.dumps(data).encode("utf-8")
    msg_len = 15 + len(json_data)
    header = msg_len.to_bytes(4, "big")
    header += b"\x00\x0f\x00\x01"
    header += msg_id.to_bytes(4, "big")
    header += msg_type.to_bytes(2, "big")
    header += b"\x01"
    return header + json_data


@pytest.mark.integration
def test_riichi_city_bridge_full_flow(riichi_city_bridge, integration_controller):
    """测试 Riichi City Bridge 解析消息并由 Controller 处理的流程"""
    # 1. Login UID 消息 (type 0x01)
    login_msg = make_rc_msg(1, 0x01, {"uid": "12345"})
    events = riichi_city_bridge.parse(login_msg)
    assert events is None
    assert riichi_city_bridge.uid == 12345

    # 2. Enter Room 消息
    enter_room_msg = make_rc_msg(
        2,
        0x02,
        {
            "cmd": "cmd_enter_room",
            "data": {
                "options": {"classify_id": 1, "player_count": 4},
                "players": [
                    {"user": {"user_id": 12345}},
                    {"user": {"user_id": 22222}},
                    {"user": {"user_id": 33333}},
                    {"user": {"user_id": 44444}},
                ],
            },
        },
    )
    events = riichi_city_bridge.parse(enter_room_msg)
    assert events == []

    # 3. Game Start 消息
    game_start_msg = make_rc_msg(
        3,
        0x02,
        {
            "cmd": "cmd_game_start",
            "data": {
                "quan_feng": 0x31,  # East
                "bao_pai_card": 0x01,  # 1p
                "dealer_pos": 0,
                "ben_chang_num": 0,
                "li_zhi_bang_num": 0,
                "user_info_list": [
                    {"hand_points": 25000},
                    {"hand_points": 25000},
                    {"hand_points": 25000},
                    {"hand_points": 25000},
                ],
                "hand_cards": [0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x01, 0x02, 0x03, 0x04, 0x05],
            },
        },
    )
    events = riichi_city_bridge.parse(game_start_msg)
    assert len(events) >= 2
    assert events[0]["type"] == "start_game"
    assert events[1]["type"] == "start_kyoku"

    # Controller 处理
    for ev in events:
        res = integration_controller.react(ev)
        assert "error" not in res
