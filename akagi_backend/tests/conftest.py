"""测试共享 fixtures 和配置"""

from unittest.mock import MagicMock

import pytest

from akagi_ng.bridge import AmatsukiBridge, MajsoulBridge, RiichiCityBridge, TenhouBridge
from akagi_ng.bridge.majsoul.liqi import MsgType


@pytest.fixture
def mock_flow():
    """创建一个模拟的 HTTPFlow 对象"""
    flow = MagicMock()
    flow.id = "test_flow_id"
    flow.request.url = "wss://example.com"
    return flow


@pytest.fixture
def sample_start_game_message():
    """示例开始游戏消息"""
    return {
        "type": "start_game",
        "id": 0,
    }


@pytest.fixture
def sample_liqi_auth_game_req():
    """示例 Liqi authGame 请求消息"""
    return {
        "method": ".lq.FastTest.authGame",
        "type": MsgType.Req,
        "data": {"accountId": 12345},
    }


@pytest.fixture
def sample_liqi_auth_game_res_4p():
    """示例 Liqi authGame 响应消息（4人麻将）"""
    return {
        "method": ".lq.FastTest.authGame",
        "type": MsgType.Res,
        "data": {
            "seatList": [1, 2, 3, 4],
            "gameConfig": {"meta": {"modeId": 1}},
        },
    }


@pytest.fixture
def sample_liqi_auth_game_res_3p():
    """示例 Liqi authGame 响应消息（3人麻将）"""
    return {
        "method": ".lq.FastTest.authGame",
        "type": MsgType.Res,
        "data": {
            "seatList": [1, 2, 3],
            "gameConfig": {"meta": {"modeId": 11}},
        },
    }


# --- Shared Data & Mocks ---


@pytest.fixture
def sample_tehai_strs():
    """示例手牌（字符串格式）"""
    return ["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1p", "2p", "3p", "4p"]


@pytest.fixture
def sample_tehai_indices():
    """示例手牌（索引格式）"""
    return [0, 1, 2, 4, 5, 8, 9, 10, 12, 13, 16, 17, 20]


# --- Bridge Fixtures ---


@pytest.fixture
def majsoul_bridge():
    """创建一个干净的 MajsoulBridge 实例"""
    return MajsoulBridge()


@pytest.fixture
def amatsuki_bridge(sample_tehai_strs):
    """创建一个干净的 AmatsukiBridge 实例"""
    bridge = AmatsukiBridge()
    bridge.valid_flow = True
    bridge.seat = 0
    bridge.desk_id = 123
    bridge.game_status = MagicMock()
    bridge.game_status.tehai = sample_tehai_strs
    return bridge


@pytest.fixture
def riichi_city_bridge():
    """创建一个干净的 RiichiCityBridge 实例"""
    bridge = RiichiCityBridge()
    bridge.uid = 1001
    bridge.game_status = MagicMock()  # Use MagicMock specifically
    bridge.game_status.accept_reach = None
    bridge.game_status.dora_markers = []
    bridge.game_status.player_list = [1000, 1001, 1002, 1003]  # User at index 1
    bridge.game_status.seat = 1
    bridge.game_status.last_dahai_actor = 0
    return bridge


@pytest.fixture
def tenhou_bridge(sample_tehai_indices):
    """创建一个干净的 TenhouBridge 实例"""
    bridge = TenhouBridge()
    bridge.state = MagicMock()
    bridge.state.seat = 0
    bridge.state.hand = sample_tehai_indices
    return bridge
