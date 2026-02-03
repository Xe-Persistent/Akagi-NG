"""
MajsoulBridge 单元测试

测试雀魂协议解析器（MajsoulBridge）的 MJAI 转换功能。
直接测试 parse_liqi 方法的 MJAI 转换逻辑。
"""

import sys
import unittest
from pathlib import Path

# 添加项目根目录到 sys.path
sys.path.append(str(Path(__file__).parent.parent))

# 直接导入需要的模块，避免循环导入
from akagi_ng.bridge.majsoul import MajsoulBridge
from akagi_ng.bridge.majsoul.liqi import MsgType
from akagi_ng.bridge.majsoul.tile_mapping import MS_TILE_2_MJAI_TILE


class TestMajsoulBridge(unittest.TestCase):
    """MajsoulBridge 单元测试类"""

    def setUp(self):
        """每个测试前重置 Bridge 实例"""
        self.bridge = MajsoulBridge()

    # ========== start_game 相关测试 ==========

    def test_auth_game_request_sets_account_id(self):
        """测试 authGame 请求正确设置 accountId"""
        liqi_message = {
            "method": ".lq.FastTest.authGame",
            "type": MsgType.Req,
            "data": {"accountId": 12345678},
        }

        result = self.bridge.parse_liqi(liqi_message)

        self.assertEqual(self.bridge.accountId, 12345678)
        self.assertEqual(result, [])

    def test_auth_game_response_returns_start_game_4p(self):
        """测试 authGame 响应返回正确的 start_game 事件（四人麻）"""
        # 先设置 accountId（模拟之前收到的 Request）
        self.bridge.accountId = 12345678

        liqi_message = {
            "method": ".lq.FastTest.authGame",
            "type": MsgType.Res,
            "data": {
                "seatList": [11111111, 12345678, 22222222, 33333333],
                "gameConfig": {"meta": {"modeId": 1}},
            },
        }

        result = self.bridge.parse_liqi(liqi_message)

        self.assertFalse(self.bridge.is_3p)
        self.assertEqual(self.bridge.seat, 1)  # 玩家在第二个位置
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["type"], "start_game")
        self.assertEqual(result[0]["id"], 1)

    def test_auth_game_response_returns_start_game_3p(self):
        """测试 authGame 响应返回正确的 start_game 事件（三人麻）"""
        self.bridge.accountId = 12345678

        liqi_message = {
            "method": ".lq.FastTest.authGame",
            "type": MsgType.Res,
            "data": {
                "seatList": [11111111, 12345678, 22222222],  # 只有 3 人
                "gameConfig": {"meta": {"modeId": 2}},
            },
        }

        result = self.bridge.parse_liqi(liqi_message)

        self.assertTrue(self.bridge.is_3p)
        self.assertEqual(self.bridge.seat, 1)
        self.assertEqual(result[0]["type"], "start_game")

    # ========== start_kyoku 相关测试 ==========

    def test_action_new_round_returns_start_kyoku(self):
        """测试 ActionNewRound 返回正确的 start_kyoku 事件"""
        self.bridge.seat = 0

        liqi_message = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionNewRound",
                "data": {
                    "chang": 0,  # 东场
                    "doras": ["1m"],
                    "ben": 0,
                    "ju": 0,  # 东1
                    "liqibang": 0,
                    "scores": [25000, 25000, 25000, 25000],
                    "tiles": [
                        "1m",
                        "2m",
                        "3m",
                        "4p",
                        "5p",
                        "6p",
                        "7s",
                        "8s",
                        "9s",
                        "1z",
                        "2z",
                        "3z",
                        "4z",
                    ],
                },
            },
        }

        result = self.bridge.parse_liqi(liqi_message)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["type"], "start_kyoku")
        self.assertEqual(result[0]["bakaze"], "E")
        self.assertEqual(result[0]["kyoku"], 1)
        self.assertEqual(result[0]["honba"], 0)
        self.assertEqual(result[0]["oya"], 0)
        self.assertEqual(result[0]["dora_marker"], "1m")
        self.assertEqual(result[0]["scores"], [25000, 25000, 25000, 25000])

    def test_action_new_round_with_14_tiles_includes_tsumo(self):
        """测试庄家开局 14 张牌时包含自摸事件"""
        self.bridge.seat = 0

        liqi_message = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionNewRound",
                "data": {
                    "chang": 0,
                    "doras": ["1m"],
                    "ben": 0,
                    "ju": 0,
                    "liqibang": 0,
                    "scores": [25000, 25000, 25000, 25000],
                    "tiles": [
                        "1m",
                        "2m",
                        "3m",
                        "4p",
                        "5p",
                        "6p",
                        "7s",
                        "8s",
                        "9s",
                        "1z",
                        "2z",
                        "3z",
                        "4z",
                        "5z",  # 第 14 张，庄家自摸
                    ],
                },
            },
        }

        result = self.bridge.parse_liqi(liqi_message)

        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["type"], "start_kyoku")
        self.assertEqual(result[1]["type"], "tsumo")
        self.assertEqual(result[1]["actor"], 0)

    # ========== tsumo/dahai 相关测试 ==========

    def test_action_deal_tile_returns_tsumo(self):
        """测试 ActionDealTile 返回正确的 tsumo 事件"""
        self.bridge.seat = 1

        liqi_message = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionDealTile",
                "data": {
                    "seat": 1,
                    "tile": "5m",
                    "leftTileCount": 60,
                },
            },
        }

        result = self.bridge.parse_liqi(liqi_message)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["type"], "tsumo")
        self.assertEqual(result[0]["actor"], 1)
        self.assertEqual(result[0]["pai"], "5m")

    def test_action_discard_tile_returns_dahai(self):
        """测试 ActionDiscardTile 返回正确的 dahai 事件"""
        self.bridge.seat = 0

        liqi_message = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionDiscardTile",
                "data": {
                    "seat": 2,
                    "tile": "9p",
                    "isLiqi": False,
                    "moqie": False,
                },
            },
        }

        result = self.bridge.parse_liqi(liqi_message)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["type"], "dahai")
        self.assertEqual(result[0]["actor"], 2)
        self.assertEqual(result[0]["pai"], "9p")
        self.assertFalse(result[0]["tsumogiri"])

    def test_action_discard_tile_with_riichi(self):
        """测试立直时的切牌事件"""
        self.bridge.seat = 0

        liqi_message = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionDiscardTile",
                "data": {
                    "seat": 0,
                    "tile": "3s",
                    "isLiqi": True,
                    "moqie": True,
                },
            },
        }

        result = self.bridge.parse_liqi(liqi_message)

        # 应该有 reach 和 dahai 两个事件
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["type"], "reach")
        self.assertEqual(result[0]["actor"], 0)
        self.assertEqual(result[1]["type"], "dahai")
        self.assertTrue(result[1]["tsumogiri"])

    # ========== 副露相关测试 ==========

    def test_action_chi_peng_gang_chi(self):
        """测试吃牌事件"""
        self.bridge.seat = 0

        liqi_message = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionChiPengGang",
                "data": {
                    "seat": 1,
                    "type": 0,  # Chi
                    "tiles": ["4m", "5m", "6m"],
                    "froms": [0, 1, 1],  # 第一张来自座位 0
                },
            },
        }

        result = self.bridge.parse_liqi(liqi_message)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["type"], "chi")
        self.assertEqual(result[0]["actor"], 1)
        self.assertEqual(result[0]["target"], 0)
        self.assertEqual(result[0]["pai"], "4m")  # MJAI 格式

    def test_action_chi_peng_gang_pon(self):
        """测试碰牌事件"""
        self.bridge.seat = 0

        liqi_message = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionChiPengGang",
                "data": {
                    "seat": 2,
                    "type": 1,  # Pon
                    "tiles": ["7z", "7z", "7z"],
                    "froms": [0, 2, 2],  # 第一张来自座位 0
                },
            },
        }

        result = self.bridge.parse_liqi(liqi_message)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["type"], "pon")
        self.assertEqual(result[0]["actor"], 2)
        self.assertEqual(result[0]["target"], 0)
        # 7z 在 MJAI 格式中是 "C"（中）
        self.assertEqual(result[0]["pai"], "C")

    def test_action_angang_addgang_ankan(self):
        """测试暗杠事件"""
        self.bridge.seat = 0

        liqi_message = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionAnGangAddGang",
                "data": {
                    "seat": 0,
                    "type": 3,  # AnKan
                    "tiles": "5s",
                },
            },
        }

        result = self.bridge.parse_liqi(liqi_message)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["type"], "ankan")
        self.assertEqual(result[0]["actor"], 0)

    def test_action_angang_addgang_kakan(self):
        """测试加杠事件"""
        self.bridge.seat = 0

        liqi_message = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionAnGangAddGang",
                "data": {
                    "seat": 1,
                    "type": 2,  # AddGang
                    "tiles": "3p",
                },
            },
        }

        result = self.bridge.parse_liqi(liqi_message)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["type"], "kakan")
        self.assertEqual(result[0]["actor"], 1)
        self.assertEqual(result[0]["pai"], "3p")

    # ========== 和牌/流局相关测试 ==========

    def test_action_hule_returns_end_kyoku(self):
        """测试和牌事件返回 end_kyoku（实际实现简化了处理）"""
        self.bridge.seat = 0

        liqi_message = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionHule",
                "data": {
                    "hules": [{"seat": 0, "zimo": True}],
                    "scores": [35000, 20000, 20000, 25000],
                },
            },
        }

        result = self.bridge.parse_liqi(liqi_message)

        # 实际实现返回 end_kyoku
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["type"], "end_kyoku")

    def test_action_liuju_returns_end_kyoku(self):
        """测试流局事件返回 end_kyoku"""
        self.bridge.seat = 0

        liqi_message = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionLiuJu",
                "data": {
                    "type": 0,  # 普通流局
                },
            },
        }

        result = self.bridge.parse_liqi(liqi_message)

        # 实际实现返回 end_kyoku
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["type"], "end_kyoku")

    def test_action_notile_returns_end_kyoku(self):
        """测试荒牌流局返回 end_kyoku"""
        self.bridge.seat = 0

        liqi_message = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionNoTile",
                "data": {},
            },
        }

        result = self.bridge.parse_liqi(liqi_message)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["type"], "end_kyoku")

    # ========== 拔北测试 ==========

    def test_action_babei_returns_nukidora(self):
        """测试拔北事件"""
        self.bridge.seat = 0
        self.bridge.is_3p = True

        liqi_message = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionBaBei",
                "data": {
                    "seat": 1,
                },
            },
        }

        result = self.bridge.parse_liqi(liqi_message)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["type"], "nukidora")
        self.assertEqual(result[0]["actor"], 1)
        self.assertEqual(result[0]["pai"], "N")

    # ========== 游戏结束测试 ==========

    def test_notify_game_end_result(self):
        """测试游戏结束通知"""
        self.bridge.seat = 1

        liqi_message = {
            "method": ".lq.NotifyGameEndResult",
            "type": MsgType.Notify,
            "data": {
                "result": {
                    "players": [
                        {"seat": 2, "partPoint1": 35000},
                        {"seat": 1, "partPoint1": 28000},  # 自己
                        {"seat": 0, "partPoint1": 22000},
                        {"seat": 3, "partPoint1": 15000},
                    ]
                }
            },
        }

        result = self.bridge.parse_liqi(liqi_message)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["type"], "end_game")
        self.assertTrue(self.bridge.game_ended)
        self.assertEqual(self.bridge.rank, 2)  # 第二名
        self.assertEqual(self.bridge.score, 28000)

    # ========== 无效消息处理测试 ==========

    def test_parse_liqi_returns_none_for_empty_message(self):
        """测试空消息返回 None"""
        result = self.bridge.parse_liqi({})
        self.assertIsNone(result)

    def test_parse_liqi_returns_none_for_none_message(self):
        """测试 None 消息返回 None"""
        result = self.bridge.parse_liqi(None)
        self.assertIsNone(result)

    def test_dispatch_message_unhandled_method(self):
        # Create a mock liqi message with an unhandled method
        msg = {"method": "non_existent_method", "type": 1, "data": {}}
        res = self.bridge.parse_liqi(msg)
        self.assertEqual(res, [])

    def test_parse_liqi_unhandled_wrapper(self):
        # Invalid wrapper (missing data)
        msg = {"method": "authGame", "type": 1}  # missing data
        self.assertEqual(self.bridge.parse_liqi(msg), [])

    def test_parse_liqi_returns_empty_for_unknown_method(self):
        """测试未知方法返回空列表"""
        liqi_message = {
            "method": ".lq.SomeUnknownMethod",
            "type": MsgType.Notify,
            "data": {},
        }

        result = self.bridge.parse_liqi(liqi_message)
        self.assertEqual(result, [])


class TestMajsoulBridgeTileMapping(unittest.TestCase):
    """测试牌面映射功能"""

    def test_ms_tile_to_mjai_mapping(self):
        """测试雀魂牌面到 MJAI 牌面的映射"""
        # 万子
        self.assertEqual(MS_TILE_2_MJAI_TILE["1m"], "1m")
        self.assertEqual(MS_TILE_2_MJAI_TILE["0m"], "5mr")  # 赤宝牌

        # 筒子
        self.assertEqual(MS_TILE_2_MJAI_TILE["5p"], "5p")
        self.assertEqual(MS_TILE_2_MJAI_TILE["0p"], "5pr")

        # 索子
        self.assertEqual(MS_TILE_2_MJAI_TILE["9s"], "9s")
        self.assertEqual(MS_TILE_2_MJAI_TILE["0s"], "5sr")

        # 字牌
        self.assertEqual(MS_TILE_2_MJAI_TILE["1z"], "E")  # 东
        self.assertEqual(MS_TILE_2_MJAI_TILE["2z"], "S")  # 南
        self.assertEqual(MS_TILE_2_MJAI_TILE["3z"], "W")  # 西
        self.assertEqual(MS_TILE_2_MJAI_TILE["4z"], "N")  # 北
        self.assertEqual(MS_TILE_2_MJAI_TILE["5z"], "P")  # 白
        self.assertEqual(MS_TILE_2_MJAI_TILE["6z"], "F")  # 发
        self.assertEqual(MS_TILE_2_MJAI_TILE["7z"], "C")  # 中


if __name__ == "__main__":
    unittest.main()
