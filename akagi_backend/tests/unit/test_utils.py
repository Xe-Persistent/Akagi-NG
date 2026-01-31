"""
mjai_bot/utils.py 单元测试

测试工具函数的正确性。
"""

import sys
import unittest
from pathlib import Path

# 添加项目根目录到 sys.path
sys.path.append(str(Path(__file__).parent.parent))

from akagi_ng.mjai_bot.utils import (
    make_error_response,
    mask_unicode_3p,
    mask_unicode_4p,
    meta_to_recommend,
)


class TestMakeErrorResponse(unittest.TestCase):
    """测试 make_error_response 函数"""

    def test_basic_error_response(self):
        """测试基本错误响应结构"""
        result = make_error_response("test_error")
        self.assertEqual(result["type"], "none")
        self.assertEqual(result["error"], "test_error")

    def test_json_decode_error(self):
        """测试 JSON 解码错误响应"""
        result = make_error_response("json_decode_error")
        self.assertEqual(result["type"], "none")
        self.assertEqual(result["error"], "json_decode_error")

    def test_no_bot_loaded_error(self):
        """测试无 Bot 加载错误响应"""
        result = make_error_response("no_bot_loaded")
        self.assertEqual(result["type"], "none")
        self.assertEqual(result["error"], "no_bot_loaded")


class TestMaskUnicode(unittest.TestCase):
    """测试掩码 Unicode 列表"""

    def test_4p_mask_length(self):
        """测试四麻掩码列表长度"""
        # 四麻：34 种牌 + 3 种赤牌 + 特殊操作
        self.assertEqual(len(mask_unicode_4p), 46)

    def test_3p_mask_length(self):
        """测试三麻掩码列表长度"""
        # 三麻：34 种牌 + 3 种赤牌 + 特殊操作（含 nukidora）
        self.assertEqual(len(mask_unicode_3p), 44)

    def test_4p_contains_chi(self):
        """测试四麻掩码包含吃操作"""
        self.assertIn("chi_low", mask_unicode_4p)
        self.assertIn("chi_mid", mask_unicode_4p)
        self.assertIn("chi_high", mask_unicode_4p)

    def test_3p_contains_nukidora(self):
        """测试三麻掩码包含拔北操作"""
        self.assertIn("nukidora", mask_unicode_3p)

    def test_3p_no_chi(self):
        """测试三麻掩码不包含吃操作"""
        self.assertNotIn("chi", mask_unicode_3p)


class TestMetaToRecommend(unittest.TestCase):
    """测试 meta_to_recommend 函数"""

    def test_basic_conversion(self):
        """测试基本的 meta 转推荐列表"""
        meta = {
            "q_values": [1.0, 0.5],
            "mask_bits": 0b11,  # 前两位为 1
        }
        result = meta_to_recommend(meta, is_3p=False, temperature=1.0)

        self.assertEqual(len(result), 2)
        # 结果应按置信度降序排列
        self.assertGreaterEqual(result[0][1], result[1][1])

    def test_single_action(self):
        """测试单一动作"""
        meta = {
            "q_values": [1.0],
            "mask_bits": 0b1,  # 只有第一位为 1
        }
        result = meta_to_recommend(meta, is_3p=False, temperature=1.0)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0][0], "1m")  # 第一个动作是 1m
        self.assertAlmostEqual(result[0][1], 1.0, places=5)

    def test_temperature_effect(self):
        """测试温度参数对置信度分布的影响"""
        meta = {
            "q_values": [2.0, 1.0, 0.0],
            "mask_bits": 0b111,
        }

        # 低温度：分布更尖锐
        low_temp_result = meta_to_recommend(meta, is_3p=False, temperature=0.5)
        # 高温度：分布更平缓
        high_temp_result = meta_to_recommend(meta, is_3p=False, temperature=2.0)

        # 低温度时最高置信度应该更高
        self.assertGreater(low_temp_result[0][1], high_temp_result[0][1])

    def test_3p_mode(self):
        """测试三麻模式"""
        # 三麻模式使用不同的掩码列表
        meta = {
            "q_values": [1.0],
            "mask_bits": 0b1,
        }
        result = meta_to_recommend(meta, is_3p=True, temperature=1.0)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0][0], "1m")

    def test_sorted_by_confidence(self):
        """测试结果按置信度排序"""
        meta = {
            "q_values": [0.1, 0.5, 0.9],
            "mask_bits": 0b111,
        }
        result = meta_to_recommend(meta, is_3p=False, temperature=1.0)

        # 验证降序排列
        for i in range(len(result) - 1):
            self.assertGreaterEqual(result[i][1], result[i + 1][1])

    def test_reach_action_index(self):
        """测试立直动作的位置"""
        # 构造一个掩码，使得 reach 是唯一可用的动作
        reach_index = mask_unicode_4p.index("reach")
        mask_bits = 1 << reach_index

        meta = {
            "q_values": [1.0],
            "mask_bits": mask_bits,
        }
        result = meta_to_recommend(meta, is_3p=False, temperature=1.0)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0][0], "reach")


class TestMetaToRecommendEdgeCases(unittest.TestCase):
    """测试 meta_to_recommend 边界条件"""

    def test_empty_q_values(self):
        """测试空 q_values"""
        meta = {
            "q_values": [],
            "mask_bits": 0,
        }
        result = meta_to_recommend(meta, is_3p=False, temperature=1.0)
        self.assertEqual(len(result), 0)

    def test_all_negative_q_values(self):
        """测试全负 q_values"""
        meta = {
            "q_values": [-1.0, -2.0, -3.0],
            "mask_bits": 0b111,
        }
        result = meta_to_recommend(meta, is_3p=False, temperature=1.0)

        self.assertEqual(len(result), 3)
        # 即使全负，也应该正确排序
        self.assertGreaterEqual(result[0][1], result[1][1])

    def test_very_low_temperature(self):
        """测试极低温度（接近 argmax）"""
        meta = {
            "q_values": [1.0, 0.9, 0.8],
            "mask_bits": 0b111,
        }
        result = meta_to_recommend(meta, is_3p=False, temperature=0.01)

        # 极低温度下，最高值应该接近 1.0
        self.assertGreater(result[0][1], 0.9)


if __name__ == "__main__":
    unittest.main()
