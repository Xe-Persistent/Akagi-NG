"""Amatsuki Bridge 和 Bot 的集成测试"""

import json

from akagi_ng.bridge.amatsuki.consts import AmatsukiTopic


def make_stomp_frame(destination, content):
    """构造 STOMP 消息帧 (bytes)"""
    content_str = json.dumps(content)
    # STOMP 格式:
    # command
    # header1:value1
    # header2:value2
    #
    # content\x00
    frame = f"MESSAGE\ndestination:{destination}\ncontent-type:application/json\n\n{content_str}\x00"
    return frame.encode("utf-8")


def test_amatsuki_bridge_full_flow(amatsuki_bridge, integration_controller, mock_mortal_engine):
    """测试 Amatsuki 桥接器从 JOIN 到出牌的完整流程"""

    # 1. Join Desk (初始化流程)
    join_content = {
        "status": 0,
        "errorCode": 0,
        "gameType": 0,  # 日麻
        "gameMode": 0,  # 4P (0)
        "roomType": 0,
        "currentPlayerCount": 4,
        "maxCount": 4,
        "deskId": "desk101",
    }
    join_msg = make_stomp_frame(AmatsukiTopic.JOIN_DESK_CALLBACK, join_content)

    events = amatsuki_bridge.parse(join_msg)
    assert events is None  # Join 只改变状态，不产生 MJAI
    assert amatsuki_bridge.valid_flow is True

    # 2. Round Start (start_game + start_kyoku)
    # 手牌: 1m (id=0) * 13
    hand_tiles = [{"id": 0} for _ in range(13)]

    start_content = {
        "bakaze": 0,
        "honba": 0,
        "isAllLast": False,
        "oya": 0,
        "playerPoints": [25000, 25000, 25000, 25000],
        "playerTiles": [
            # Seat 0 (Self)
            {
                "haiRiver": [],
                "tehai": {
                    "hand": hand_tiles,
                    "kitaArea": [],
                    "lockArea": [],
                },
            },
            # Seat 1, 2, 3 (Other)
            *[
                {
                    "haiRiver": [],
                    "tehai": {
                        "hand": [{"id": -1}],
                        "kitaArea": [],
                        "lockArea": [],
                    },
                }
                for _ in range(3)
            ],
        ],
    }

    # 模拟 Amatsuki 的 topic 动态后缀 (通常是桌号或随机ID，这里假设为 '1')
    start_msg = make_stomp_frame(AmatsukiTopic.ROUND_START_PREFIX + "1", start_content)
    events = amatsuki_bridge.parse(start_msg)

    # 第一次只会是 `start_game`，`start_kyoku` 被缓存等待 DoraSync
    assert len(events) == 1
    assert events[0]["type"] == "start_game"

    # 将 start_game 发送给 controller
    res = integration_controller.react(events[0])
    assert res["type"] == "none"

    # 3. Sync Dora (触发 cached start_kyoku)
    dora_content = {
        "dora": [{"id": 4}],  # 2m
        "honba": 0,
        "reachCount": 0,
    }
    dora_msg = make_stomp_frame(AmatsukiTopic.SYNC_DORA_PREFIX + "1", dora_content)
    events = amatsuki_bridge.parse(dora_msg)

    assert len(events) == 1
    assert events[0]["type"] == "start_kyoku"
    assert events[0]["dora_marker"] == "2m"

    # 发送 start_kyoku 给 controller
    res = integration_controller.react(events[0])
    assert res["type"] == "none"

    # 4. Handle Draw (TSUMO)
    draw_content = {
        "hai": {"id": 8},  # 3m
        "position": 0,
    }
    draw_msg = make_stomp_frame(AmatsukiTopic.DRAW_PREFIX + "1", draw_content)
    events = amatsuki_bridge.parse(draw_msg)

    assert len(events) == 1
    assert events[0]["type"] == "tsumo"
    assert events[0]["pai"] == "3m"

    # 发送 tsumo 给 controller，期望获得 mock 引擎的响应
    res = integration_controller.react(events[0])
    # Mock engine 默认返回 type: none，但会包含 meta
    assert res["type"] == "none"
    assert "meta" in res
    assert res["meta"]["engine_type"] == "mortal_mock"
