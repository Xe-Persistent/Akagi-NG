"""Tenhou Bridge 和 Bot 的集成测试"""

import json

import pytest


@pytest.mark.integration
def test_tenhou_bridge_full_flow(tenhou_bridge, integration_controller):
    """测试 Tenhou Bridge 解析消息并由 Controller 处理的流程"""
    # 1. HELO 消息 (JSON 格式)
    helo_msg = json.dumps({"tag": "HELO", "name": "User", "tid": "0", "sx": "M"}).encode("utf-8")

    events = tenhou_bridge.parse(helo_msg)
    # HELO 不产生 MJAI 事件，仅初始化
    assert events is None

    # 2. TAIKYOKU 消息 (start_game)
    taikyoku_msg = json.dumps({"tag": "TAIKYOKU", "oya": "0"}).encode("utf-8")
    events = tenhou_bridge.parse(taikyoku_msg)
    assert len(events) == 1
    assert events[0]["type"] == "start_game"

    # Controller 处理 start_game
    res = integration_controller.react(events[0])
    assert res["type"] == "none"

    # 3. INIT 消息 (start_kyoku)
    init_msg = json.dumps(
        {
            "tag": "INIT",
            "seed": "0,0,0,0,0,4",
            "ten": "250,250,250,250",
            "oya": "0",
            "hai": "0,4,8,12,16,20,24,28,32,36,40,44,48",
        }
    ).encode("utf-8")

    events = tenhou_bridge.parse(init_msg)
    assert len(events) == 1
    assert events[0]["type"] == "start_kyoku"

    # Controller 处理 start_kyoku
    # 这会尝试加载 Bot
    res = integration_controller.react(events[0])
    # 如果环境中有模型，可能会加载成功；否则会失败
    # 我们这里主要检查流程是否走通
    assert "error" not in res or res["error"] != "BOT_RUNTIME_ERROR"

    # 4. T 消息 (tsumo)
    # Tenhou JSON logs wrap tags in JSON objects
    tsumo_msg = json.dumps({"tag": "T52"}).encode("utf-8")
    events = tenhou_bridge.parse(tsumo_msg)
    assert len(events) == 1
    assert events[0]["type"] == "tsumo"

    # Controller 处理 tsumo
    res = integration_controller.react(events[0])
    # 应该有响应（dahai 或者 none，取决于 Bot）
    assert "type" in res
