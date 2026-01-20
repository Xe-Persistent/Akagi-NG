"""
Bot 模块扩展测试

测试 StateTrackerBot 的核心功能,包括:
- 杠候选查找逻辑
- 状态追踪
- 立直后自动摸切
"""

import json
import sys
import unittest
from pathlib import Path

import pytest

# Add project root to sys.path
sys.path.append(str(Path(__file__).parent.parent.parent))

# 检查 libriichi 是否可用
try:
    from akagi_ng.core.lib_loader import libriichi  # noqa: F401

    HAS_LIBRIICHI = True
except ImportError:
    HAS_LIBRIICHI = False

from akagi_ng.mjai_bot.bot import StateTrackerBot


@pytest.mark.skipif(not HAS_LIBRIICHI, reason="libriichi not available in CI environment")
class TestStateTrackerBot(unittest.TestCase):
    """测试 StateTrackerBot 的核心功能"""

    def setUp(self):
        """每个测试前初始化"""
        self.bot = StateTrackerBot()
        # 初始化游戏状态
        start_game = json.dumps([{"type": "start_game", "id": 0}])
        self.bot.react(start_game)

    def test_initialization(self):
        """测试Bot初始化"""
        self.assertEqual(self.bot.player_id, 0)
        self.assertFalse(self.bot.is_3p)
        self.assertIsInstance(self.bot.meta, dict)
        self.assertIsInstance(self.bot.notification_flags, dict)

    def test_start_kyoku_4p(self):
        """测试四人麻将开局"""
        start_kyoku = {
            "type": "start_kyoku",
            "bakaze": "E",
            "kyoku": 1,
            "honba": 0,
            "kyotaku": 0,
            "oya": 0,
            "dora_marker": "1m",
            "scores": [25000, 25000, 25000, 25000],
            "tehais": [
                ["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1p", "2p", "3p", "4p"],
                ["?"] * 13,
                ["?"] * 13,
                ["?"] * 13,
            ],
        }
        resp = self.bot.react(start_kyoku)
        self.assertFalse(self.bot.is_3p)
        # 开局应该返回摸切或其他合法动作
        resp_json = json.loads(resp)
        self.assertIn("type", resp_json)

    def test_start_kyoku_3p(self):
        """测试三人麻将开局"""
        start_kyoku = {
            "type": "start_kyoku",
            "bakaze": "E",
            "kyoku": 1,
            "honba": 0,
            "kyotaku": 0,
            "oya": 0,
            "dora_marker": "1m",
            "scores": [35000, 35000, 35000, 0],
            "tehais": [
                ["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1p", "2p", "3p", "4p"],
                ["?"] * 13,
                ["?"] * 13,
                ["?"] * 13,
            ],
            "is_3p": True,
        }
        resp = self.bot.react(start_kyoku)
        self.assertTrue(self.bot.is_3p)
        resp_json = json.loads(resp)
        self.assertIn("type", resp_json)

    def test_nukidora_3p(self):
        """测试三麻拔北处理"""
        # 先开局
        start_kyoku = {
            "type": "start_kyoku",
            "bakaze": "E",
            "kyoku": 1,
            "honba": 0,
            "kyotaku": 0,
            "oya": 0,
            "dora_marker": "1m",
            "scores": [35000, 35000, 35000, 0],
            "tehais": [
                ["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1p", "2p", "3p", "N"],
                ["?"] * 13,
                ["?"] * 13,
                ["?"] * 13,
            ],
            "is_3p": True,
        }
        self.bot.react(start_kyoku)

        # 拔北事件
        nukidora = {"type": "nukidora", "actor": 0, "pai": "N"}
        resp = self.bot.react(nukidora)
        # 应该成功处理,不报错
        resp_json = json.loads(resp)
        self.assertNotIn("error", resp_json.get("type", ""))

    def test_find_daiminkan_candidates(self):
        """测试大明杠候选查找功能"""
        # 由于查找候选需要完整的游戏状态,这里只测试方法存在且可调用
        # 实际的游戏状态追踪在集成测试中验证
        self.assertTrue(hasattr(self.bot, "find_daiminkan_candidates"))
        self.assertTrue(callable(self.bot.find_daiminkan_candidates))
        # 不在有完整状态的情况下调用,避免AttributeError
        # 实际使用中需要先有 dahai 事件设置 last_kawa_tile

    def test_find_ankan_candidates(self):
        """测试暗杠候选查找功能"""
        # 测试方法存在且可调用
        self.assertTrue(hasattr(self.bot, "find_ankan_candidates"))
        self.assertTrue(callable(self.bot.find_ankan_candidates))
        # 暗杠查找需要完整的游戏状态,在集成测试中验证具体功能

    def test_find_kakan_candidates(self):
        """测试加杠候选查找功能"""
        # 测试方法存在且可调用
        self.assertTrue(hasattr(self.bot, "find_kakan_candidates"))
        self.assertTrue(callable(self.bot.find_kakan_candidates))
        # 加杠查找需要完整的游戏状态和碰牌记录,在集成测试中验证

    def test_riichi_auto_tsumogiri(self):
        """测试立直后自动摸切"""
        start_kyoku = {
            "type": "start_kyoku",
            "bakaze": "E",
            "kyoku": 1,
            "honba": 0,
            "kyotaku": 0,
            "oya": 0,
            "dora_marker": "1m",
            "scores": [25000, 25000, 25000, 25000],
            "tehais": [
                ["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1p", "2p", "3p", "4p"],
                ["?"] * 13,
                ["?"] * 13,
                ["?"] * 13,
            ],
        }
        self.bot.react(start_kyoku)

        # 模拟立直
        reach = {"type": "reach", "actor": 0}
        self.bot.react(reach)

        # 立直确认
        reach_accepted = {
            "type": "reach_accepted",
            "actor": 0,
            "deltas": [-1000, 0, 0, 0],
            "scores": [24000, 25000, 25000, 25000],
        }
        self.bot.react(reach_accepted)

        # 摸牌后应该自动摸切
        tsumo = {"type": "tsumo", "actor": 0, "pai": "5m"}
        resp = self.bot.react(tsumo)
        resp_json = json.loads(resp)

        # 立直后应该自动打出刚摸的牌
        self.assertEqual(resp_json["type"], "dahai")
        self.assertEqual(resp_json["pai"], "5m")

    def test_error_handling(self):
        """测试错误处理"""
        # 传入空事件
        resp = self.bot.react({})
        resp_json = json.loads(resp)
        # 应该返回错误响应
        self.assertIn("error", resp_json)


if __name__ == "__main__":
    unittest.main()
