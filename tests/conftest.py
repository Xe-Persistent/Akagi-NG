"""测试共享 fixtures 和配置"""

import pytest

from akagi_ng.bridge import MajsoulBridge
from akagi_ng.bridge.liqi import MsgType


@pytest.fixture
def majsoul_bridge():
    """创建一个干净的 MajsoulBridge 实例"""
    return MajsoulBridge()


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
