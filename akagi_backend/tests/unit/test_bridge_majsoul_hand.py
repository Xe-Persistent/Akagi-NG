"""
MajsoulBridge 手牌追踪单元测试（合并版）
包含：
- 基础手牌追踪
- 极端手牌追踪（暗杠/加杠）
- 拔北手牌追踪（三麻）
"""

import sys
import unittest
from pathlib import Path

# 添加项目根目录到 sys.path
sys.path.append(str(Path(__file__).parent.parent.parent))

from akagi_ng.bridge.majsoul import MajsoulBridge
from akagi_ng.bridge.majsoul.liqi import MsgType


class TestMajsoulBridgeHandTracking(unittest.TestCase):
    def setUp(self):
        self.bridge = MajsoulBridge()
        self.bridge.seat = 0

    def test_hand_tracking_new_round(self):
        """测试新回合的手牌初始化。"""
        liqi_message = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionNewRound",
                "data": {
                    "chang": 0,
                    "jushu": 0,
                    "ju": 0,
                    "ben": 0,
                    "liqibang": 0,
                    "doras": ["1m"],
                    "scores": [25000, 25000, 25000, 25000],
                    "tiles": ["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "2z", "3z", "4z"],
                },
            },
        }
        self.bridge.parse_liqi(liqi_message)

        expected_hand = ["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "E", "S", "W", "N"]
        # 注意：1z..4z 映射为 E, S, W, N
        self.assertEqual(len(self.bridge.my_tehais), 13)
        self.assertEqual(self.bridge.my_tehais, expected_hand)
        self.assertIsNone(self.bridge.my_tsumohai)

    def test_hand_tracking_deal_tile(self):
        """测试摸牌时的手牌更新。"""
        # 先初始化手牌
        self.bridge.my_tehais = ["1m"] * 13

        liqi_message = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionDealTile",
                "data": {"seat": 0, "tile": "5m", "leftTileCount": 60},
            },
        }
        self.bridge.parse_liqi(liqi_message)

        self.assertEqual(self.bridge.my_tsumohai, "5m")

    def test_hand_tracking_discard_tsumogiri(self):
        """测试摸切（自摸切牌）。"""
        self.bridge.my_tehais = ["1m"] * 13
        self.bridge.my_tsumohai = "5m"

        liqi_message = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionDiscardTile",
                "data": {"seat": 0, "tile": "5m", "isLiqi": False, "moqie": True},
            },
        }
        self.bridge.parse_liqi(liqi_message)

        self.assertIsNone(self.bridge.my_tsumohai)
        self.assertEqual(len(self.bridge.my_tehais), 13)

    def test_hand_tracking_discard_tedashi_tsumo(self):
        """测试手切（打出手牌），保留自摸牌。"""
        # 手牌: 123m, 自摸: 9m. 打出 1m. 结果: 239m
        self.bridge.my_tehais = ["1m", "2m", "3m"] + ["1z"] * 10
        self.bridge.my_tsumohai = "9m"

        liqi_message = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionDiscardTile",
                "data": {"seat": 0, "tile": "1m", "isLiqi": False, "moqie": False},
            },
        }
        self.bridge.parse_liqi(liqi_message)

        self.assertIsNone(self.bridge.my_tsumohai)
        self.assertNotIn("1m", self.bridge.my_tehais)
        self.assertIn("9m", self.bridge.my_tehais)
        self.assertEqual(len(self.bridge.my_tehais), 13)

    def test_hand_tracking_chi(self):
        """测试吃牌后的手牌更新。"""
        # 手牌: 2m 3m 4m ...
        # 吃 4m (使用手牌中的 2m 3m)
        self.bridge.my_tehais = ["2m", "3m", "4m", "5m"] + ["1z"] * 9

        liqi_message = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionChiPengGang",
                "data": {
                    "seat": 0,
                    "type": 0,  # Chi
                    "tiles": [
                        "2m",
                        "3m",
                        "4m",
                    ],  # MJAI 逻辑：tiles[0,1] 来自手牌？等一下，实现使用的是原始匹配
                    "froms": [1, 0, 0],  # 4m 来自座位 1, 2m 3m 来自座位 0
                },
            },
        }

        self.bridge.parse_liqi(liqi_message)

        self.assertNotIn("3m", self.bridge.my_tehais)
        self.assertNotIn("4m", self.bridge.my_tehais)
        self.assertIn("2m", self.bridge.my_tehais)  # 原来的 2m
        self.assertIn("5m", self.bridge.my_tehais)

    def test_hand_tracking_ankan(self):
        """测试暗杠后的手牌更新。"""
        self.bridge.my_tehais = ["5m", "5m", "5m", "5mr"] + ["1z"] * 9  # 0m 是 5mr
        self.bridge.my_tsumohai = "9m"  # 无关的自摸牌

        liqi_message = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionAnGangAddGang",
                "data": {
                    "seat": 0,
                    "type": 3,  # AnKan
                    "tiles": "0m",  # 杠牌指示
                },
            },
        }

        # 0m -> 5mr.
        # 逻辑: consumed=["5m", "5m", "5m", "5mr"] (在 _handle 逻辑中处理)
        # 应该移除所有 4 张。

        self.bridge.parse_liqi(liqi_message)

        self.assertNotIn("5m", self.bridge.my_tehais)
        self.assertNotIn("5mr", self.bridge.my_tehais)

        # 修正：暗杠触发新的摸牌 (岭上牌)。
        # 之前的自摸牌 ("9m") 必须移入手牌以防止被覆盖。
        self.assertIsNone(self.bridge.my_tsumohai)
        self.assertIn("9m", self.bridge.my_tehais)
        self.assertEqual(len(self.bridge.my_tehais), 10)  # 9原手牌 + 1移入的自摸牌

    def test_hand_tracking_nukidora_tsumo(self):
        """测试当拔北牌是自摸牌时的拔北处理。"""
        self.bridge.my_tehais = ["1m"] * 13
        self.bridge.my_tsumohai = "N"

        liqi_message = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionBaBei",
                "data": {
                    "seat": 0,
                    "moqie": False,
                },
            },
        }

        self.bridge.parse_liqi(liqi_message)

        # 应该消耗掉自摸牌
        self.assertIsNone(self.bridge.my_tsumohai)
        self.assertEqual(len(self.bridge.my_tehais), 13)

    def test_hand_tracking_nukidora_save_previous_tsumo(self):
        """测试拔北时，如果不需要消耗自摸牌，则保存之前的自摸牌。"""
        # 初始: 13张手牌 + 自摸 '3s'。
        # 动作: 拔北 'N' (来自手牌)。
        # 预期: '3s' 移入手牌。'N' 从手牌移除。
        self.bridge.my_tehais = ["1m"] * 12 + ["N"]
        self.bridge.my_tsumohai = "3s"

        liqi_message = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionBaBei",
                "data": {
                    "seat": 0,
                    "moqie": False,
                },
            },
        }

        self.bridge.parse_liqi(liqi_message)

        # 'N' 应该从手牌被移除
        self.assertNotIn("N", self.bridge.my_tehais)
        self.assertIn("3s", self.bridge.my_tehais)
        self.assertIsNone(self.bridge.my_tsumohai)


class TestMajsoulBridgeHandExtreme(unittest.TestCase):
    def setUp(self):
        self.bridge = MajsoulBridge()
        self.bridge.seat = 0

    def test_kakan_save_tsumohai(self):
        """测试加杠时，如果消耗的是手牌而非刚摸的牌，必须保存刚摸的牌"""
        # 初始状态：
        # 副露：碰了 5m
        # 手牌：10 张牌 + 1 张 5m
        # 自摸：1s
        self.bridge.my_tehais = ["1z"] * 9 + ["5m"]
        self.bridge.my_tsumohai = "1s"

        # 模拟加杠 5m (Kakan)
        # 注意：Kakan 使用 ActionAnGangAddGang，type=2
        liqi_message = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionAnGangAddGang",
                "data": {
                    "seat": 0,
                    "type": 2,  # 2 = 加杠
                    "tiles": "5m",  # 加杠通常只包含那张牌
                },
            },
        }

        self.bridge.parse_liqi(liqi_message)

        # 验证：
        # 1. 5m 应该从手牌消失
        # 2. 1s 应该被移入手牌
        # 3. tsumohai 应该为空 (等待岭上牌)
        self.assertNotIn("5m", self.bridge.my_tehais)
        self.assertIn("1s", self.bridge.my_tehais, "自摸牌 1s 应该被保存到手牌中")
        self.assertIsNone(self.bridge.my_tsumohai)
        self.assertEqual(len(self.bridge.my_tehais), 10)  # 9张1z + 1张1s

    def test_ankan_save_tsumohai(self):
        """测试暗杠时，如果消耗的是手牌里的4张，必须保存刚摸的牌"""
        # 手牌：9张1z + 4张9p
        # 自摸：1s
        self.bridge.my_tehais = ["1z"] * 9 + ["9p", "9p", "9p", "9p"]
        self.bridge.my_tsumohai = "1s"

        # 模拟暗杠 9p (Ankan)
        # ActionAnGangAddGang, type=3
        liqi_message = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionAnGangAddGang",
                "data": {
                    "seat": 0,
                    "type": 3,  # 3 = 暗杠
                    "tiles": "9p",
                },
            },
        }

        self.bridge.parse_liqi(liqi_message)

        self.assertNotIn("9p", self.bridge.my_tehais)
        self.assertIn("1s", self.bridge.my_tehais, "自摸牌 1s 应该被保存到手牌中")
        self.assertIsNone(self.bridge.my_tsumohai)
        self.assertEqual(len(self.bridge.my_tehais), 10)  # 9张1z + 1张1s

    def test_deal_tile_overwrites_cleared_tsumo(self):
        """测试岭上摸牌能正常工作（在 tsmohai 被清空后）"""
        self.bridge.my_tehais = ["1z"] * 10
        self.bridge.my_tsumohai = None

        # 模拟岭上摸牌
        liqi_message = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionDealTile",
                "data": {
                    "seat": 0,
                    "tile": "2s",
                },
            },
        }

        self.bridge.parse_liqi(liqi_message)

        self.assertEqual(self.bridge.my_tsumohai, "2s")
        self.assertEqual(len(self.bridge.my_tehais), 10)


class TestMajsoulBridgeKitaDebug(unittest.TestCase):
    def setUp(self):
        self.bridge = MajsoulBridge()
        self.bridge.seat = 0
        self.bridge.is_3p = True  # Kita 通常是三麻

    def test_dealer_kita_initial_hand(self):
        """测试作为庄家（14张牌）时立即拔北的情况。"""
        # 庄家开局有 14 张牌：假设 13 张 'E' 和 1 张 'N' (北)
        # 注意：MajSoul 以字符串列表形式发送牌
        # 在三麻中，N 是 4z。
        tiles = ["1z"] * 13 + ["4z"]

        # 模拟 ActionNewRound
        liqi_message_new_round = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionNewRound",
                "data": {
                    "chang": 0,
                    "ju": 0,
                    "ben": 0,
                    "liqibang": 0,
                    "doras": ["1p"],
                    "scores": [25000, 25000, 25000],
                    "tiles": tiles,
                },
            },
        }
        self.bridge.parse_liqi(liqi_message_new_round)

        # 检查初始状态
        # bridge.my_tehais 应该是 13 张 'E' (已排序)
        # bridge.my_tsumohai 应该是 'N' (从 4z 映射)
        self.assertEqual(len(self.bridge.my_tehais), 13)
        self.assertEqual(self.bridge.my_tsumohai, "N")
        self.assertEqual(self.bridge.my_tehais[0], "E")

        # 模拟拔北 (ActionBaBei)
        liqi_message_kita = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionBaBei",
                "data": {
                    "seat": 0,
                    "moqie": False,  # 对拔北通常无关紧要
                },
            },
        }
        self.bridge.parse_liqi(liqi_message_kita)

        # 预期：
        # 'N' (如果是自摸牌) 被移除。
        # my_tehais 仍然是 13 张 'E'。
        # my_tsumohai 变为 None。
        self.assertIsNone(self.bridge.my_tsumohai)
        self.assertEqual(len(self.bridge.my_tehais), 13)
        self.assertEqual(self.bridge.my_tehais[0], "E")

        # 模拟岭上摸牌
        liqi_message_deal = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionDealTile",
                "data": {
                    "seat": 0,
                    "tile": "2z",  # 岭上牌
                },
            },
        }
        self.bridge.parse_liqi(liqi_message_deal)

        self.assertEqual(self.bridge.my_tsumohai, "S")
        self.assertEqual(len(self.bridge.my_tehais), 13)

    def test_continuous_kita(self):
        """测试连续拔北。"""
        self.bridge.my_tehais = ["E"] * 13
        self.bridge.my_tsumohai = "N"

        # 第 1 次拔北
        liqi_message_kita1 = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionBaBei",
                "data": {"seat": 0},
            },
        }
        self.bridge.parse_liqi(liqi_message_kita1)

        self.assertIsNone(self.bridge.my_tsumohai)
        self.assertEqual(len(self.bridge.my_tehais), 13)

        # 岭上 -> 再摸到 'N'
        liqi_message_deal1 = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionDealTile",
                "data": {
                    "seat": 0,
                    "tile": "4z",  # 另一张 N
                },
            },
        }
        self.bridge.parse_liqi(liqi_message_deal1)

        self.assertEqual(self.bridge.my_tsumohai, "N")

        # 第 2 次拔北
        self.bridge.parse_liqi(liqi_message_kita1)

        self.assertIsNone(self.bridge.my_tsumohai)
        self.assertEqual(len(self.bridge.my_tehais), 13)

    def test_dealer_kita_from_hand_not_tsumo(self):
        """测试庄家拔北时，北风在主手牌（13张）中而不是第14张的情况。"""
        # 手牌: 12 'E', 1 'N' (在索引0), 1 'S' (在最后)
        # N 是 4z.
        tiles = ["4z"] + ["1z"] * 12 + ["2z"]

        liqi_message_new_round = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionNewRound",
                "data": {
                    "chang": 0,
                    "ju": 0,
                    "ben": 0,
                    "liqibang": 0,
                    "doras": ["1p"],
                    "scores": [25000, 25000, 25000],
                    "tiles": tiles,
                },
            },
        }
        self.bridge.parse_liqi(liqi_message_new_round)

        # 预期初始状态（使用新逻辑：全排序并分割）：
        # 所有牌排序: 'E' x12, 'S', 'N'。
        # my_tehais (前 13): 'E' x12 + 'S'。
        # my_tsumohai (最后 1): 'N'。

        self.assertEqual(self.bridge.my_tsumohai, "N")
        self.assertIn("S", self.bridge.my_tehais)
        self.assertEqual(len(self.bridge.my_tehais), 13)

        # 模拟拔北 (ActionBaBei)
        # 我们需要模拟拔 'N'。
        # 'N' 当前在 my_tsumohai。

        liqi_message_kita = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionBaBei",
                "data": {"seat": 0},
            },
        }
        self.bridge.parse_liqi(liqi_message_kita)

        # 预期:
        # 'N' (tsumohai) 被消耗。
        # my_tehais 保持 'E' x12 + 'S'。
        # my_tsumohai 变为 None。

        self.assertNotIn("N", self.bridge.my_tehais)
        self.assertIn("S", self.bridge.my_tehais)
        self.assertIsNone(self.bridge.my_tsumohai)
        self.assertEqual(len(self.bridge.my_tehais), 13)

    def test_dealer_hidden_kita_bug(self):
        """
        复现Bug：如果第14张牌比前13张中的某些牌小，Bot 收到的手牌会丢失最大的牌。
        示例: tiles = ["N", "1p", ... "1p"] (13 '1p's)。
        tiles[0] = "N" (内部手牌)
        tiles[13] = "1p" (自摸牌)
        全排序 = ["1p"x14, "N"].
        Bot Tehais (最小的13张) = ["1p"x13].
        Bot Tsumo = "1p".
        Bot 看到的总手牌 = 14张 "1p"。 "N" 丢失了。
        """
        tiles = ["4z"] + ["1p"] * 13
        # tiles[0] = N (4z)
        # tiles[1...12] = 1p
        # tiles[13] = 1p

        liqi_message_new_round = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionNewRound",
                "data": {
                    "chang": 0,
                    "ju": 0,
                    "ben": 0,
                    "liqibang": 0,
                    "doras": ["1p"],
                    "scores": [25000, 25000, 25000],
                    "tiles": tiles,
                },
            },
        }

        # 我们需要检查 parse_liqi 返回的消息，看看 Bot 能看到什么。
        events = self.bridge.parse_liqi(liqi_message_new_round)

        start_kyoku = next(e for e in events if e["type"] == "start_kyoku")
        tsumo = next(e for e in events if e["type"] == "tsumo")

        # 检查 Bot 的手牌
        bot_tehais = start_kyoku["tehais"][0]
        bot_tsumo = tsumo["pai"]

        # 预期: Bot 应该能看到 "N"。
        # 目前 (Buggy): Bot 看到手牌 13 张 "1p" + 自摸 1 张 "1p"。没有 N。

        all_bot_tiles = [*bot_tehais, bot_tsumo]
        self.assertIn("N", all_bot_tiles, "Bot 的视野中应该包含 'N' 牌")


if __name__ == "__main__":
    unittest.main()
