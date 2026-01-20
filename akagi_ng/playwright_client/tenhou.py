import queue

from playwright.sync_api import WebSocket

from akagi_ng.bridge import TenhouBridge
from akagi_ng.bridge.base import BaseBridge
from akagi_ng.playwright_client.base import BasePlaywrightController


class TenhouController(BasePlaywrightController):
    """
    Playwright 浏览器实例控制器 - 天凤平台 (https://tenhou.net/3/).
    """

    def __init__(self, url: str, frontend_url: str):
        # 创建实例级别的状态管理
        self.tenhou_bridges: dict[WebSocket, TenhouBridge] = {}
        self.mjai_messages: queue.Queue[dict] = queue.Queue()

        super().__init__(url, frontend_url, self.mjai_messages)

    def create_bridge(self) -> BaseBridge:
        """创建天凤 Bridge 实例"""
        return TenhouBridge()

    def get_bridges_dict(self) -> dict[WebSocket, BaseBridge]:
        """获取 Bridge 字典的引用"""
        return self.tenhou_bridges

    def preprocess_payload(self, payload: str | bytes) -> bytes:
        """确保 payload 为 bytes 类型（天凤需要）"""
        if isinstance(payload, str):
            return payload.encode("utf-8")
        return payload
