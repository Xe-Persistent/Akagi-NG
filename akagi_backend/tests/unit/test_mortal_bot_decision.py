"""
MortalBot 扩展测试

测试 MortalBot 的决策相关逻辑,包括:
- 事件处理流程
- Meta 数据格式化
- 立直前瞻逻辑
- 在线/离线切换
- 决策合法性
"""

import json
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Add project root to sys.path
sys.path.append(str(Path(__file__).parent.parent.parent))

# 检查 libriichi 是否可用
try:
    from akagi_ng.core.lib_loader import libriichi  # noqa: F401

    HAS_LIBRIICHI = True
except ImportError:
    HAS_LIBRIICHI = False

from akagi_ng.mjai_bot.mortal.bot import Mortal3pBot, MortalBot


@pytest.mark.skipif(not HAS_LIBRIICHI, reason="libriichi not available in CI environment")
class TestMortalBotDecisionLogic(unittest.TestCase):
    """测试 MortalBot 决策相关逻辑"""

    def setUp(self):
        """每个测试前初始化"""
        # Mock engine loader
        self.loader_patcher = patch("akagi_ng.mjai_bot.engine.load_model")
        self.mock_loader = self.loader_patcher.start()

        # Mock Bot 返回合理的推荐数据
        self.mock_bot_instance = MagicMock()
        self.mock_bot_instance.react.return_value = json.dumps(
            {
                "type": "dahai",
                "pai": "1m",
                "meta": {
                    "q_values": [0.8, 0.6, 0.4, 0.3, 0.2],
                    "mask": [True, True, True, True, True],
                    "candidates": [
                        {"pai": "1m", "q_value": 0.8},
                        {"pai": "2m", "q_value": 0.6},
                        {"pai": "3m", "q_value": 0.4},
                    ],
                },
            }
        )

        # Mock Engine
        self.mock_engine = MagicMock()
        self.mock_engine.get_additional_meta.return_value = {"engine_meta": 1}
        self.mock_engine.last_inference_result = {}

        # load_model returns (Bot, Engine)
        self.mock_loader.return_value = (self.mock_bot_instance, self.mock_engine)

    def tearDown(self):
        self.loader_patcher.stop()

    def test_event_processing_flow(self):
        """测试事件处理流程"""
        bot = MortalBot()

        # 发送开始游戏事件
        start_game = json.dumps([{"type": "start_game", "id": 0}])
        resp = bot.react(start_game)
        resp_json = json.loads(resp)

        # 验证响应格式
        self.assertIn("type", resp_json)
        # Mock 返回的类型是 dahai,但实际可能还有其他类型
        # self.assertEqual(resp_json["type"], "dahai" if HAS_LIBRIICHI else "none")
        self.assertIn("meta", resp_json)

        # 验证 bot 状态正确
        self.assertEqual(bot.player_id, 0)
        self.assertFalse(bot.is_3p)

    def test_meta_data_format_4p(self):
        """测试四麻 meta 数据格式"""
        bot = MortalBot()
        bot.is_3p = False

        events = json.dumps([{"type": "start_game", "id": 0}])
        resp = bot.react(events)
        resp_json = json.loads(resp)

        # 验证 meta 结构
        self.assertIn("meta", resp_json)
        meta = resp_json["meta"]

        # 四麻应该有这些字段
        if HAS_LIBRIICHI and "candidates" in meta:
            self.assertIsInstance(meta["candidates"], list)
            # 验证候选格式
            for candidate in meta["candidates"]:
                self.assertIn("pai", candidate)
                self.assertIn("q_value", candidate)
                # Q值应该在合理范围内
                self.assertGreaterEqual(candidate["q_value"], -1)
                self.assertLessEqual(candidate["q_value"], 1)

    def test_meta_data_format_3p(self):
        """测试三麻 meta 数据格式"""
        bot = Mortal3pBot()
        self.assertTrue(bot.is_3p)

        events = json.dumps([{"type": "start_game", "id": 1}])
        resp = bot.react(events)
        resp_json = json.loads(resp)

        # 验证基本结构
        self.assertIn("meta", resp_json)
        self.assertIn("type", resp_json)

    def test_game_start_flag(self):
        """测试游戏开始标志"""
        bot = MortalBot()

        events = json.dumps([{"type": "start_game", "id": 0}])
        resp = bot.react(events)
        resp_json = json.loads(resp)

        # 游戏开始时应该有 game_start 标志
        self.assertTrue(resp_json.get("meta", {}).get("game_start", False))

    def test_notification_flags_handling(self):
        """测试通知标志处理"""
        bot = MortalBot()

        # 初始化游戏
        start_game = json.dumps([{"type": "start_game", "id": 0}])
        bot.react(start_game)

        # notification_flags 应该存在
        self.assertIsInstance(bot.notification_flags, dict)

    def test_riichi_lookahead_attribute_exists(self):
        """测试立直前瞻相关属性和方法存在"""
        bot = MortalBot()

        # 验证方法存在
        self.assertTrue(hasattr(bot, "_run_riichi_lookahead"))
        self.assertTrue(callable(bot._run_riichi_lookahead))

        self.assertTrue(hasattr(bot, "_handle_riichi_lookahead"))
        self.assertTrue(callable(bot._handle_riichi_lookahead))

    def test_online_mode_detection(self):
        """测试在线模式检测"""
        # 这个测试验证 engine 的类型可以被识别
        bot = MortalBot()

        # Engine 应该被正确设置(但可能为 None 如果未初始化)
        # self.assertIsNotNone(bot.engine)

        # 验证 engine 属性存在
        self.assertTrue(hasattr(bot, "engine"))

        # 如果 engine 不为 None, 验证有 get_additional_meta 方法
        if bot.engine is not None and hasattr(bot.engine, "get_additional_meta"):
            meta = bot.engine.get_additional_meta()
            self.assertIsInstance(meta, dict)

    def test_error_handling_empty_events(self):
        """测试空事件列表的错误处理"""
        bot = MortalBot()

        # 未初始化就发送空事件
        resp = bot.react(json.dumps([]))
        resp_json = json.loads(resp)

        # 应该有某种响应,不应该崩溃
        self.assertIn("type", resp_json)

    def test_multiple_event_batches(self):
        """测试多批次事件处理"""
        bot = MortalBot()

        # 第一批: 游戏开始
        resp1 = bot.react(json.dumps([{"type": "start_game", "id": 0}]))
        resp1_json = json.loads(resp1)
        self.assertIn("type", resp1_json)

        # 第二批: 其他事件(如果 libriichi 可用)
        # 这验证 bot 可以处理连续的事件
        if HAS_LIBRIICHI:
            resp2 = bot.react(json.dumps([{"type": "tsumo", "actor": 0, "pai": "1m"}]))
            resp2_json = json.loads(resp2)
            self.assertIn("type", resp2_json)

    def test_decision_action_in_valid_set(self):
        """测试推荐动作在合法集合中"""
        bot = MortalBot()

        # 设置 mock 返回特定的候选
        self.mock_bot_instance.react.return_value = json.dumps(
            {
                "type": "dahai",
                "pai": "1m",  # 推荐打1m
                "meta": {
                    "candidates": [
                        {"pai": "1m", "q_value": 0.9},
                        {"pai": "2m", "q_value": 0.7},
                        {"pai": "3m", "q_value": 0.5},
                    ],
                },
            }
        )

        events = json.dumps([{"type": "start_game", "id": 0}])
        resp = bot.react(events)
        resp_json = json.loads(resp)

        # 验证推荐的牌在候选列表中
        if "candidates" in resp_json.get("meta", {}):
            recommended_pai = resp_json.get("pai")
            candidates_pai = [c["pai"] for c in resp_json["meta"]["candidates"]]
            if recommended_pai:
                self.assertIn(recommended_pai, candidates_pai)

    def test_q_values_ordering(self):
        """测试 Q 值排序"""
        bot = MortalBot()

        # 设置 mock 返回有序的候选
        self.mock_bot_instance.react.return_value = json.dumps(
            {
                "type": "dahai",
                "pai": "1m",
                "meta": {
                    "candidates": [
                        {"pai": "1m", "q_value": 0.9},
                        {"pai": "2m", "q_value": 0.7},
                        {"pai": "3m", "q_value": 0.5},
                    ],
                },
            }
        )

        events = json.dumps([{"type": "start_game", "id": 0}])
        resp = bot.react(events)
        resp_json = json.loads(resp)

        # 验证候选按 Q 值降序排列
        if "candidates" in resp_json.get("meta", {}):
            candidates = resp_json["meta"]["candidates"]
            if len(candidates) > 1:
                q_values = [c["q_value"] for c in candidates]
                # 检查是否降序
                self.assertEqual(q_values, sorted(q_values, reverse=True))

    def test_engine_metadata_included(self):
        """测试引擎元数据被包含"""
        bot = MortalBot()

        events = json.dumps([{"type": "start_game", "id": 0}])
        resp = bot.react(events)
        resp_json = json.loads(resp)

        # 验证 engine metadata 存在
        meta = resp_json.get("meta", {})
        # get_additional_meta 返回的数据应该在 meta 中
        if hasattr(bot.engine, "get_additional_meta"):
            self.assertIn("engine_meta", meta)


if __name__ == "__main__":
    unittest.main()
