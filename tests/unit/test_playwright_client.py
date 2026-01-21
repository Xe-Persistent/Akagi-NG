"""
Playwright Client 单元测试

测试 Playwright Controller 的核心功能
"""

import queue
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

# 添加项目根目录到 sys.path
sys.path.append(str(Path(__file__).parent.parent.parent))

from akagi_ng.bridge import MajsoulBridge, TenhouBridge
from akagi_ng.playwright_client.majsoul import MajsoulController
from akagi_ng.playwright_client.tenhou import TenhouController


class TestMajsoulController(unittest.TestCase):
    """测试 MajsoulController"""

    def setUp(self):
        """每个测试前初始化"""
        self.url = "https://game.example.com"
        self.frontend_url = "http://localhost:8765"
        # 不实际启动 Playwright,只测试初始化
        self.controller = MajsoulController(self.url, self.frontend_url)

    def test_initialization(self):
        """测试控制器初始化"""
        self.assertEqual(self.controller.url, self.url)
        self.assertEqual(self.controller.frontend_url, self.frontend_url)
        self.assertIsInstance(self.controller.majsoul_bridges, dict)
        self.assertIsInstance(self.controller.mjai_messages, queue.Queue)
        self.assertFalse(self.controller.running)

    def test_create_bridge(self):
        """测试创建 Bridge 实例"""
        bridge = self.controller.create_bridge()
        self.assertIsInstance(bridge, MajsoulBridge)

    def test_get_bridges_dict(self):
        """测试获取 Bridge 字典引用"""
        bridges_dict = self.controller.get_bridges_dict()
        self.assertIs(bridges_dict, self.controller.majsoul_bridges)

    def test_preprocess_payload_bytes(self):
        """测试 payload 预处理 - bytes 输入"""
        payload = b"test data"
        result = self.controller.preprocess_payload(payload)
        self.assertEqual(result, payload)
        self.assertIsInstance(result, bytes)

    def test_preprocess_payload_string(self):
        """测试 payload 预处理 - string 输入"""
        payload = "test data"
        result = self.controller.preprocess_payload(payload)
        self.assertEqual(result, b"test data")
        self.assertIsInstance(result, bytes)

    @patch("akagi_ng.playwright_client.base.sync_playwright")
    def test_on_frame_from_client(self, mock_playwright):
        """测试 WebSocket 消息处理 - 来自客户端"""
        # 创建 mock WebSocket
        mock_ws = MagicMock()

        # 添加 bridge 到字典
        bridge = MajsoulBridge()
        self.controller.get_bridges_dict()[mock_ws] = bridge

        # 模拟收到客户端消息
        payload = b'{"type":"test"}'
        self.controller._on_frame(mock_ws, payload, from_client=True)

        # 验证消息被处理(from_client=True 不解析)

    @patch("akagi_ng.playwright_client.base.sync_playwright")
    def test_on_frame_from_server(self, mock_playwright):
        """测试 WebSocket 消息处理 - 来自服务器"""
        # 创建 mock WebSocket
        mock_ws = MagicMock()

        # 添加 bridge 到字典
        bridge = MajsoulBridge()
        with patch.object(bridge, "parse") as mock_parse:
            mock_parse.return_value = [{"type": "start_game", "id": 0}]
            self.controller.get_bridges_dict()[mock_ws] = bridge

            # 模拟收到服务器消息
            payload = b'{"type":"test"}'
            self.controller._on_frame(mock_ws, payload, from_client=False)

            # 验证 bridge.parse 被调用
            mock_parse.assert_called_once()

            # 验证消息被放入队列
            self.assertFalse(self.controller.mjai_messages.empty())
            msg = self.controller.mjai_messages.get_nowait()
            self.assertEqual(msg["type"], "start_game")

    def test_on_socket_close(self):
        """测试 WebSocket 关闭处理"""
        # 创建 mock WebSocket
        mock_ws = MagicMock()

        # 添加 bridge 到字典
        bridge = MajsoulBridge()
        bridge.game_ended = False  # 模拟游戏未结束
        self.controller.get_bridges_dict()[mock_ws] = bridge

        # 调用关闭处理
        self.controller._on_socket_close(mock_ws)

        # 验证 bridge 被移除
        self.assertNotIn(mock_ws, self.controller.get_bridges_dict())

        # 验证系统消息被放入队列
        self.assertFalse(self.controller.mjai_messages.empty())
        msg = self.controller.mjai_messages.get_nowait()
        self.assertEqual(msg["type"], "system_event")
        self.assertEqual(msg["code"], "game_disconnected")

    def test_on_socket_close_game_ended(self):
        """测试 WebSocket 关闭处理 - 游戏正常结束"""
        mock_ws = MagicMock()

        bridge = MajsoulBridge()
        bridge.game_ended = True  # 模拟游戏正常结束
        self.controller.get_bridges_dict()[mock_ws] = bridge

        self.controller._on_socket_close(mock_ws)

        # 验证返回大厅消息
        msg = self.controller.mjai_messages.get_nowait()
        self.assertEqual(msg["code"], "return_lobby")

    def test_stop(self):
        """测试停止控制器"""
        # 设置 running=True 模拟控制器正在运行
        self.controller.running = True
        self.controller.stop()

        # 验证停止命令被放入队列
        self.assertFalse(self.controller.command_queue.empty())
        cmd = self.controller.command_queue.get_nowait()
        self.assertEqual(cmd["command"], "stop")


class TestTenhouController(unittest.TestCase):
    """测试 TenhouController"""

    def setUp(self):
        """每个测试前初始化"""
        self.url = "https://tenhou.net/3/"
        self.frontend_url = "http://localhost:8765"
        self.controller = TenhouController(self.url, self.frontend_url)

    def test_initialization(self):
        """测试控制器初始化"""
        self.assertEqual(self.controller.url, self.url)
        self.assertIsInstance(self.controller.tenhou_bridges, dict)
        self.assertIsInstance(self.controller.mjai_messages, queue.Queue)

    def test_create_bridge(self):
        """测试创建天凤 Bridge 实例"""
        bridge = self.controller.create_bridge()
        self.assertIsInstance(bridge, TenhouBridge)

    def test_get_bridges_dict(self):
        """测试获取 Bridge 字典引用"""
        bridges_dict = self.controller.get_bridges_dict()
        self.assertIs(bridges_dict, self.controller.tenhou_bridges)

    def test_preprocess_payload_bytes(self):
        """测试 payload 预处理 - bytes 输入"""
        payload = b"test data"
        result = self.controller.preprocess_payload(payload)
        self.assertEqual(result, payload)
        self.assertIsInstance(result, bytes)

    def test_preprocess_payload_string(self):
        """测试 payload 预处理 - string 输入"""
        payload = "test data"
        result = self.controller.preprocess_payload(payload)
        self.assertEqual(result, b"test data")
        self.assertIsInstance(result, bytes)


class TestBasePlaywrightController(unittest.TestCase):
    """测试 BasePlaywrightController 的通用功能"""

    def test_handle_command_stop(self):
        """测试停止命令处理"""
        controller = MajsoulController("https://example.com", "http://localhost:8765")

        # 处理停止命令
        should_stop = controller._handle_command("stop")

        self.assertTrue(should_stop)

    def test_handle_command_unknown(self):
        """测试未知命令处理"""
        controller = MajsoulController("https://example.com", "http://localhost:8765")

        # 处理未知命令
        should_stop = controller._handle_command("unknown_command")

        self.assertFalse(should_stop)


if __name__ == "__main__":
    unittest.main()
