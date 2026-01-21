import queue

from playwright.sync_api import WebSocket

from akagi_ng.bridge import BaseBridge, MajsoulBridge
from akagi_ng.playwright_client.base import BasePlaywrightController


class MajsoulController(BasePlaywrightController):
    """
    Playwright 浏览器实例控制器 - 雀魂平台。
    """

    def __init__(self, url: str, frontend_url: str):
        """初始化控制器"""
        # 创建实例级别的状态管理
        self.majsoul_bridges: dict[WebSocket, MajsoulBridge] = {}
        self.mjai_messages: queue.Queue[dict] = queue.Queue()

        super().__init__(url, frontend_url, self.mjai_messages)

    def create_bridge(self) -> BaseBridge:
        """创建雀魂 Bridge 实例"""
        return MajsoulBridge()

    def get_bridges_dict(self) -> dict[WebSocket, BaseBridge]:
        """获取 Bridge 字典的引用"""
        return self.majsoul_bridges

    def preprocess_payload(self, payload: str | bytes) -> bytes:
        """雀魂不需要特殊处理，直接返回"""
        if isinstance(payload, bytes):
            return payload
        return payload.encode("utf-8")
