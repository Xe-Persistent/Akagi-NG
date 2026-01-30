"""
core/notification_handler.py 单元测试

测试通知处理器的正确性。
"""

import sys
import unittest
from pathlib import Path

# 添加项目根目录到 sys.path
sys.path.append(str(Path(__file__).parent.parent))

from akagi_ng.core.notification_codes import NotificationCode
from akagi_ng.core.notification_handler import NotificationHandler, _make_notification


class TestMakeNotification(unittest.TestCase):
    """测试 _make_notification 函数"""

    def test_basic_notification(self):
        """测试基本通知结构"""
        result = _make_notification("test_code")
        self.assertEqual(result["code"], "test_code")
        self.assertNotIn("msg", result)
        self.assertNotIn("level", result)


class TestNotificationHandlerFromMessage(unittest.TestCase):
    """测试 NotificationHandler.from_message 方法"""

    def test_start_game_message(self):
        """测试 start_game 消息返回通知"""
        msg = {"type": "start_game", "id": 0}
        result = NotificationHandler.from_message(msg)

        self.assertIsNotNone(result)
        self.assertEqual(result["code"], NotificationCode.GAME_CONNECTED)

    def test_unknown_message_type(self):
        """测试未知消息类型返回 None"""
        msg = {"type": "dahai", "actor": 0, "pai": "1m"}
        result = NotificationHandler.from_message(msg)

        self.assertIsNone(result)

    def test_system_event_message(self):
        """测试 system_event 类型消息"""
        msg = {"type": "system_event", "code": "custom_code", "level": "warning"}
        result = NotificationHandler.from_message(msg)

        self.assertIsNotNone(result)
        self.assertEqual(result["code"], "custom_code")

    def test_system_event_default_level(self):
        """测试 system_event 默认级别为 error"""
        msg = {"type": "system_event", "code": "some_error"}
        result = NotificationHandler.from_message(msg)

        self.assertIsNotNone(result)
        self.assertEqual(result["code"], "some_error")

    def test_empty_message(self):
        """测试空消息"""
        msg = {}
        result = NotificationHandler.from_message(msg)

        self.assertIsNone(result)


class TestNotificationHandlerFromFlags(unittest.TestCase):
    """测试 NotificationHandler.from_flags 方法"""

    def test_fallback_used_flag(self):
        """测试 fallback_used 标志"""
        flags = {"fallback_used": True}
        result = NotificationHandler.from_flags(flags)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["code"], NotificationCode.FALLBACK_USED)

    def test_circuit_open_flag(self):
        """测试 circuit_open 标志"""
        flags = {"circuit_open": True}
        result = NotificationHandler.from_flags(flags)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["code"], NotificationCode.RECONNECTING)

    def test_circuit_restored_flag(self):
        """测试 circuit_restored 标志"""
        flags = {"circuit_restored": True}
        result = NotificationHandler.from_flags(flags)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["code"], NotificationCode.SERVICE_RESTORED)

    def test_multiple_flags(self):
        """测试多个标志同时激活"""
        flags = {
            "fallback_used": True,
            "circuit_open": True,
        }
        result = NotificationHandler.from_flags(flags)

        self.assertEqual(len(result), 2)

    def test_false_flags(self):
        """测试 False 标志不产生通知"""
        flags = {
            "fallback_used": False,
            "circuit_open": False,
        }
        result = NotificationHandler.from_flags(flags)

        self.assertEqual(len(result), 0)

    def test_empty_flags(self):
        """测试空标志字典"""
        flags = {}
        result = NotificationHandler.from_flags(flags)

        self.assertEqual(len(result), 0)

    def test_unknown_flags_ignored(self):
        """测试未知标志被忽略"""
        flags = {"unknown_flag": True}
        result = NotificationHandler.from_flags(flags)

        self.assertEqual(len(result), 0)


class TestNotificationHandlerFromErrorResponse(unittest.TestCase):
    """测试 NotificationHandler.from_error_response 方法"""

    def test_parse_error(self):
        """测试 parse_error 响应"""
        response = {"type": "none", "error": "parse_error"}
        result = NotificationHandler.from_error_response(response)

        self.assertIsNotNone(result)
        self.assertEqual(result["code"], NotificationCode.PARSE_ERROR)

    def test_unknown_error_code(self):
        """测试未映射的错误代码直接使用"""
        response = {"type": "none", "error": "custom_error"}
        result = NotificationHandler.from_error_response(response)

        self.assertIsNotNone(result)
        self.assertEqual(result["code"], "custom_error")

    def test_no_error_field(self):
        """测试无 error 字段返回 None"""
        response = {"type": "dahai", "pai": "1m"}
        result = NotificationHandler.from_error_response(response)

        self.assertIsNone(result)

    def test_empty_error_field(self):
        """测试空 error 字段返回 None"""
        response = {"type": "none", "error": ""}
        result = NotificationHandler.from_error_response(response)

        self.assertIsNone(result)

    def test_none_response(self):
        """测试空响应"""
        response = {}
        result = NotificationHandler.from_error_response(response)

        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
