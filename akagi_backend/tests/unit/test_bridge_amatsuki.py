import json
from unittest.mock import patch

import pytest

from akagi_ng.bridge.amatsuki.bridge import STOMP, STOMPFrame
from akagi_ng.bridge.amatsuki.consts import AmatsukiAction, AmatsukiTopic


@pytest.fixture
def bridge(amatsuki_bridge):
    amatsuki_bridge.valid_flow = True
    return amatsuki_bridge


def make_stomp(destination, content_dict):
    stomp = STOMP()
    stomp.frame = STOMPFrame.MESSAGE
    stomp.destination = destination
    stomp.content = json.dumps(content_dict)
    return stomp


def test_parse_returns_none_for_invalid_stomp(bridge):
    """Test parse returns None for invalid STOMP content"""
    content = b"INVALID\n\n"
    result = bridge.parse(content)
    assert result is None


def test_handle_draw(bridge):
    """Test _handle_draw (Tsumo Event)"""
    content = {
        "hai": {"id": 12},  # 4m
        "position": 0,
    }
    stomp = make_stomp(f"{AmatsukiTopic.DRAW_PREFIX}0", content)

    with patch("akagi_ng.bridge.amatsuki.bridge.ID_TO_MJAI_PAI") as mock_mapping:
        mock_mapping.__getitem__.side_effect = lambda x: "4m" if x == 12 else "?"
        result = bridge._handle_draw(stomp)
        assert len(result) == 1
        assert result[0]["type"] == "tsumo"
        assert result[0]["actor"] == 0
        assert result[0]["pai"] == "4m"


def test_handle_tehai_action_kiri(bridge):
    """Test _handle_tehai_action for KIRI (Dahai)"""
    content = {
        "action": AmatsukiAction.KIRI,
        "haiList": [{"id": 12}],  # 4m
        "isKiri": True,
        "isReachDisplay": False,
        "position": 0,
        "tehaiList": [],
    }
    stomp = make_stomp(f"{AmatsukiTopic.TEHAI_ACTION_PREFIX}.0", content)

    with patch("akagi_ng.bridge.amatsuki.bridge.ID_TO_MJAI_PAI") as mock_mapping:
        mock_mapping.__getitem__.side_effect = lambda x: "4m" if x == 12 else "?"
        result = bridge._handle_tehai_action(stomp)
        assert len(result) == 1
        assert result[0]["type"] == "dahai"
        assert result[0]["actor"] == 0
        assert result[0]["pai"] == "4m"
        assert result[0]["tsumogiri"] is True


def test_handle_river_action_pon(bridge):
    """Test _handle_river_action for PON"""
    content = {
        "action": AmatsukiAction.PON,
        "menzu": {"menzuList": [{"id": 12}, {"id": 12}, {"id": 12}]},  # 4m, 4m, 4m
        "position": 0,
    }
    stomp = make_stomp(f"{AmatsukiTopic.RIVER_ACTION_PREFIX}.0", content)
    bridge.last_discard_actor = 1
    bridge.last_discard = "4m"

    with patch("akagi_ng.bridge.amatsuki.bridge.ID_TO_MJAI_PAI") as mock_mapping:
        mock_mapping.__getitem__.side_effect = lambda x: "4m"
        result = bridge._handle_river_action(stomp)
        assert len(result) == 1
        assert result[0]["type"] == "pon"
        assert result[0]["actor"] == 0
        assert result[0]["target"] == 1
        assert result[0]["pai"] == "4m"
        assert len(result[0]["consumed"]) == 2


def test_handle_river_action_chi(bridge):
    """Test _handle_river_action for CHI"""
    content = {
        "action": AmatsukiAction.CHII,
        "menzu": {"menzuList": [{"id": 4}, {"id": 8}, {"id": 12}]},  # 2m, 3m, 4m
        "position": 0,
    }
    stomp = make_stomp(f"{AmatsukiTopic.RIVER_ACTION_PREFIX}.0", content)
    bridge.last_discard_actor = 3
    bridge.last_discard = "4m"

    with patch("akagi_ng.bridge.amatsuki.bridge.ID_TO_MJAI_PAI") as mock_mapping:
        mock_mapping.__getitem__.side_effect = lambda x: {4: "2m", 8: "3m", 12: "4m"}.get(x, "?")
        result = bridge._handle_river_action(stomp)
        assert len(result) == 1
        assert result[0]["type"] == "chi"
        assert result[0]["actor"] == 0
        assert result[0]["target"] == 3
        assert result[0]["pai"] == "4m"
        assert result[0]["consumed"] == ["2m", "3m"]


def test_handle_join_desk_callback(bridge) -> None:
    bridge.valid_flow = False
    content = {
        "status": 0,
        "errorCode": 0,
        "gameType": 0,
        "gameMode": 1,
        "roomType": 0,
        "currentPlayerCount": 3,
        "maxCount": 3,
        "deskId": "desk123",
    }
    stomp = make_stomp(AmatsukiTopic.JOIN_DESK_CALLBACK, content)
    bridge._handle_join_desk_callback(stomp)
    assert bridge.valid_flow is True
    assert bridge.is_3p is True
    assert bridge.desk_id == "desk123"


def test_handle_sync_dora_initial(bridge) -> None:
    bridge.temp_start_round = {"type": "start_kyoku", "dora_marker": None}
    content = {
        "dora": [{"id": 0}],  # 1m
        "honba": 0,
        "reachCount": 1,
    }
    stomp = make_stomp(AmatsukiTopic.SYNC_DORA_PREFIX + "1", content)
    res = bridge._handle_sync_dora(stomp)
    assert res[0]["dora_marker"] == "1m"
    assert res[0]["kyotaku"] == 1
    assert bridge.temp_start_round is None


def test_handle_sync_dora_update(bridge) -> None:
    bridge.current_dora_count = 1
    content = {
        "dora": [{"id": 0}, {"id": 4}],  # 1m, 2m
        "honba": 0,
        "reachCount": 0,
    }
    stomp = make_stomp(AmatsukiTopic.SYNC_DORA_PREFIX + "1", content)
    res = bridge._handle_sync_dora(stomp)
    assert res[0]["type"] == "dora"
    assert res[0]["dora_marker"] == "2m"
    assert bridge.current_dora_count == 2


def test_handle_tehai_action_ext(bridge) -> None:
    content = {
        "action": AmatsukiAction.ANKAN,
        "position": 0,
        "haiList": [{"id": 0}, {"id": 1}, {"id": 2}, {"id": 3}],
        "isKiri": False,
        "isReachDisplay": False,
    }
    bridge.hand_ids = [0, 1, 2, 3, 4]
    stomp = make_stomp("/topic/tehai_action", content)
    res = bridge._handle_tehai_action(stomp)
    assert res is not None
    assert any(e["type"] == "ankan" for e in res)


def test_handle_tehai_action_reach(bridge) -> None:
    content = {
        "action": AmatsukiAction.REACH,
        "haiList": [{"id": 0}],  # 1m
        "isKiri": True,
        "isReachDisplay": True,
        "position": 0,
    }
    stomp = make_stomp(AmatsukiTopic.TEHAI_ACTION_PREFIX + "1", content)
    res = bridge._handle_tehai_action(stomp)
    assert res[0]["type"] == "reach"
    assert res[1]["type"] == "dahai"
    assert bridge.temp_reach_accepted is not None


def test_handle_tehai_action_kita(bridge) -> None:
    bridge.is_3p = True
    content = {"action": AmatsukiAction.KITA, "haiList": [], "isKiri": False, "isReachDisplay": False, "position": 0}
    stomp = make_stomp(AmatsukiTopic.TEHAI_ACTION_PREFIX + "1", content)
    res = bridge._handle_tehai_action(stomp)
    assert res[0]["type"] == "nukidora"


def test_handle_river_action_minkan(bridge) -> None:
    bridge.last_discard = "1m"
    bridge.last_discard_actor = 1
    content = {
        "action": AmatsukiAction.MINKAN,
        "position": 0,
        "menzu": {"menzuList": [{"id": 0}, {"id": 1}, {"id": 2}, {"id": 3}]},
    }
    stomp = make_stomp(AmatsukiTopic.RIVER_ACTION_PREFIX + "1", content)
    res = bridge._handle_river_action(stomp)
    assert res[0]["type"] == "daiminkan"
    assert res[0]["actor"] == 0
    assert res[0]["target"] == 1


def test_handle_round_start_happy_path(bridge):
    """测试 roundStart 正常流程"""
    bridge.game_started = False
    bridge.seat = None
    content = {
        "bakaze": 0,
        "honba": 0,
        "isAllLast": False,
        "oya": 0,
        "playerPoints": [25000, 25000, 25000, 25000],
        "playerTiles": [
            {
                "haiRiver": [],
                "tehai": {
                    "hand": [{"id": 0}] * 13,
                    "kitaArea": [],
                    "lockArea": [],
                },
            }
        ]
        + [
            {
                "haiRiver": [],
                "tehai": {
                    "hand": [{"id": -1}],
                    "kitaArea": [],
                    "lockArea": [],
                },
            }
        ]
        * 3,
    }
    stomp = make_stomp(AmatsukiTopic.ROUND_START_PREFIX + "1", content)
    res = bridge._handle_round_start(stomp)
    assert bridge.game_started is True
    assert bridge.seat == 0
    assert len(res) == 1
    assert res[0]["type"] == "start_game"
    assert bridge.temp_start_round is not None
    assert bridge.temp_start_round["type"] == "start_kyoku"


def test_bridge_reset(bridge):
    bridge.valid_flow = True
    bridge.reset()
    assert bridge.valid_flow is False
    assert bridge.hand_ids == []


def test_handle_end_events(bridge) -> None:
    stomp_ron = make_stomp(
        AmatsukiTopic.RON_ACTION_PREFIX + "1", {"agariInfo": {}, "increaseAndDecrease": [], "isTsumo": False}
    )
    assert bridge._handle_ron_action(stomp_ron)[0]["type"] == "end_kyoku"

    stomp_ryu = make_stomp(
        AmatsukiTopic.RYUKYOKU_ACTION_PREFIX + "1", {"reason": 1, "scores": [25000, 25000, 25000, 25000]}
    )
    assert bridge._handle_ryukyoku_action(stomp_ryu)[0]["type"] == "end_kyoku"

    stomp_end = make_stomp(AmatsukiTopic.GAME_END_PREFIX + "1", {})
    assert bridge._handle_game_end(stomp_end)[0]["type"] == "end_game"


def test_validate_content_error_branch(bridge) -> None:
    stomp = STOMP()
    stomp.content = None
    assert bridge._validate_content(None, stomp) is False


def test_stomp_parse_headers():
    """测试 STOMP 解析各种头部字段"""
    content = (
        b"MESSAGE\n"
        b"destination:/topic/test\n"
        b"content-length:10\n"
        b"content-type:application/json\n"
        b"subscription:sub-123\n"
        b"message-id:msg-456\n"
        b"unknown-header:val\n"
        b"\n"
        b'{"a":1}\x00'
    )
    stomp = STOMP().parse(content)
    assert stomp.frame == STOMPFrame.MESSAGE
    assert stomp.destination == "/topic/test"
    assert stomp.content_length == 10
    assert stomp.content_type == "application/json"
    assert stomp.subscription == "sub-123"
    assert stomp.message_id == "msg-456"
    assert stomp.content == '{"a":1}'


def test_stomp_content_dict_error():
    """测试 STOMP content_dict 在 JSON 错误时的处理"""
    stomp = STOMP()
    stomp.content = '{"invalid": json}'
    assert stomp.content_dict() is None


def test_handle_join_desk_callback_failures(bridge):
    """测试 JOIN_DESK_CALLBACK 的各种失败情况"""
    # 状态错误
    bridge.valid_flow = False
    stomp = make_stomp(AmatsukiTopic.JOIN_DESK_CALLBACK, {"status": 1, "errorCode": 0})
    bridge._handle_join_desk_callback(stomp)
    assert bridge.valid_flow is False

    # 错误码错误
    bridge.valid_flow = False
    stomp = make_stomp(AmatsukiTopic.JOIN_DESK_CALLBACK, {"status": 0, "errorCode": 1})
    bridge._handle_join_desk_callback(stomp)
    assert bridge.valid_flow is False

    # 游戏类型错误
    bridge.valid_flow = False
    stomp = make_stomp(AmatsukiTopic.JOIN_DESK_CALLBACK, {"status": 0, "errorCode": 0, "gameType": 1})
    bridge._handle_join_desk_callback(stomp)
    assert bridge.valid_flow is False

    # 游戏模式错误
    bridge.valid_flow = False
    stomp = make_stomp(AmatsukiTopic.JOIN_DESK_CALLBACK, {"status": 0, "errorCode": 0, "gameType": 0, "gameMode": 2})
    bridge._handle_join_desk_callback(stomp)
    assert bridge.valid_flow is False


def test_handle_round_start_missing_keys(bridge):
    """测试 roundStart 缺失关键字段"""
    stomp = make_stomp(AmatsukiTopic.ROUND_START_PREFIX + "1", {"bakaze": 0})
    assert bridge._handle_round_start(stomp) is None


def test_build_kakan_variations(bridge):
    """测试加杠的多样性（赤宝牌处理）"""
    # 赤 5m (ID 16 是 5mr)
    res = bridge._build_kakan({"haiList": [{"id": 16}]}, 0)
    assert res[0]["consumed"] == ["5m", "5m", "5m"]

    # 普通 5m (ID 17 是 5m)
    res = bridge._build_kakan({"haiList": [{"id": 17}]}, 0)
    assert res[0]["consumed"] == ["5mr", "5m", "5m"]


def test_build_wreach(bridge):
    """测试 WREACH 动作"""
    res = bridge._build_wreach({"haiList": [{"id": 0}]}, 0)
    assert res[0]["type"] == "reach"
    assert res[1]["type"] == "dahai"
    assert res[1]["tsumogiri"] is True


def test_handle_tehai_action_unknown(bridge):
    """测试未知的手牌动作"""
    stomp = make_stomp(AmatsukiTopic.TEHAI_ACTION_PREFIX, {"action": "UNKNOWN", "haiList": [], "position": 0})
    assert bridge._handle_tehai_action(stomp) is None


def test_handle_river_action_unknown(bridge):
    """测试未知的河牌动作"""
    stomp = make_stomp(
        AmatsukiTopic.RIVER_ACTION_PREFIX, {"action": AmatsukiAction.KIRI, "menzu": {"menzuList": []}, "position": 0}
    )
    assert bridge._handle_river_action(stomp) is None


def test_parse_dispatch_logic(bridge):
    """测试 parse 的分发逻辑"""
    # 匹配 prefix_handlers
    stomp_draw = f'MESSAGE\ndestination:{AmatsukiTopic.DRAW_PREFIX}0\n\n{{"hai":{{"id":0}},"position":0}}\x00'
    res = bridge.parse(stomp_draw.encode())
    assert res is not None
    assert res[0]["type"] == "tsumo"

    # 不匹配任何 handler
    stomp_unknown = "MESSAGE\ndestination:/unknown/topic\n\n{}\x00"
    assert bridge.parse(stomp_unknown.encode()) is None
