"""Bridge 和 Bot 的集成测试

测试 Bridge 解析消息后 Bot 能够正确响应的完整流程
"""

import pytest

from akagi_ng.bridge.majsoul.liqi import MsgType


@pytest.mark.integration
def test_bridge_parses_start_game(majsoul_bridge):
    """测试 Bridge 能够正确解析开始游戏消息"""
    # 准备 authGame 请求
    auth_req = {
        "method": ".lq.FastTest.authGame",
        "type": MsgType.Req,
        "data": {"accountId": 12345},
    }

    result = majsoul_bridge.parse_liqi(auth_req)
    assert result == []  # Request 不产生 MJAI 消息
    assert majsoul_bridge.accountId == 12345


@pytest.mark.integration
def test_bridge_parses_start_game_response_4p(majsoul_bridge):
    """测试 Bridge 能够正确解析 4 人麻将开始游戏响应"""
    # 设置 accountId
    majsoul_bridge.accountId = 12345

    # 准备 authGame 响应
    auth_res = {
        "method": ".lq.FastTest.authGame",
        "type": MsgType.Res,
        "data": {
            "seatList": [12345, 23456, 34567, 45678],
            "gameConfig": {"meta": {"modeId": 1}},
        },
    }

    result = majsoul_bridge.parse_liqi(auth_res)

    # 验证返回了 start_game 消息
    assert len(result) == 1
    assert result[0]["type"] == "start_game"
    assert result[0]["id"] == 0  # seat 0
    assert majsoul_bridge.is_3p is False


@pytest.mark.integration
def test_bridge_parses_start_game_response_3p(majsoul_bridge):
    """测试 Bridge 能够正确解析 3 人麻将开始游戏响应"""
    # 设置 accountId
    majsoul_bridge.accountId = 12345

    # 准备 authGame 响应（3 人麻将）
    auth_res = {
        "method": ".lq.FastTest.authGame",
        "type": MsgType.Res,
        "data": {
            "seatList": [12345, 23456, 34567],
            "gameConfig": {"meta": {"modeId": 11}},
        },
    }

    result = majsoul_bridge.parse_liqi(auth_res)

    # 验证返回了 start_game 消息
    assert len(result) == 1
    assert result[0]["type"] == "start_game"
    assert result[0]["id"] == 0  # seat 0
    assert majsoul_bridge.is_3p is True


@pytest.mark.integration
def test_bridge_complete_kyoku_flow(majsoul_bridge):
    """测试一个完整的局的消息流程"""
    # 设置账号和开始游戏
    majsoul_bridge.accountId = 12345

    auth_res = {
        "method": ".lq.FastTest.authGame",
        "type": MsgType.Res,
        "data": {
            "seatList": [12345, 23456, 34567, 45678],
            "gameConfig": {"meta": {"modeId": 1}},
        },
    }

    result = majsoul_bridge.parse_liqi(auth_res)
    assert len(result) == 1
    assert result[0]["type"] == "start_game"

    # 模拟 ActionNewRound 消息
    new_round = {
        "method": ".lq.ActionPrototype",
        "type": MsgType.Notify,
        "data": {
            "name": "ActionNewRound",
            "data": {
                "chang": 0,  # 东
                "ju": 0,  # 1 局
                "ben": 0,  # 本场
                "liqibang": 0,  # 立直棒
                "doras": ["1p"],
                "scores": [25000, 25000, 25000, 25000],
                "tiles": ["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1p", "2p", "3p", "4p"],
            },
        },
    }

    result = majsoul_bridge.parse_liqi(new_round)

    # 验证返回了 start_kyoku 消息
    assert len(result) == 1
    assert result[0]["type"] == "start_kyoku"
    assert result[0]["bakaze"] == "E"
    assert result[0]["kyoku"] == 1
    assert result[0]["honba"] == 0
    assert result[0]["kyotaku"] == 0
    assert result[0]["dora_marker"] == "1p"
    assert result[0]["scores"] == [25000, 25000, 25000, 25000]


@pytest.mark.integration
@pytest.mark.slow
def test_bridge_handles_multiple_kyoku(majsoul_bridge):
    """测试 Bridge 能够处理多局游戏"""
    # 这是一个较慢的测试，模拟多局游戏场景

    # 初始化
    majsoul_bridge.accountId = 12345
    auth_res = {
        "method": ".lq.FastTest.authGame",
        "type": MsgType.Res,
        "data": {
            "seatList": [12345, 23456, 34567, 45678],
            "gameConfig": {"meta": {"modeId": 1}},
        },
    }
    majsoul_bridge.parse_liqi(auth_res)

    # 模拟 3 局游戏
    for kyoku in range(3):
        new_round = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionNewRound",
                "data": {
                    "chang": kyoku // 4,
                    "ju": kyoku % 4,
                    "ben": 0,
                    "liqibang": 0,
                    "doras": ["1p"],
                    "scores": [25000, 25000, 25000, 25000],
                    "tiles": ["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1p", "2p", "3p", "4p"],
                },
            },
        }

        result = majsoul_bridge.parse_liqi(new_round)
        assert len(result) == 1
        assert result[0]["type"] == "start_kyoku"
        assert result[0]["kyoku"] == (kyoku % 4) + 1

        # 模拟局结束
        end_kyoku = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {"name": "ActionNoTile", "data": {}},
        }

        result = majsoul_bridge.parse_liqi(end_kyoku)
        assert len(result) == 1
        assert result[0]["type"] == "end_kyoku"
