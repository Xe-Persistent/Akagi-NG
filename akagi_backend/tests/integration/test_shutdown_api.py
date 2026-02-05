"""
测试 shutdown API 的单元测试
"""

import pytest
from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase

from akagi_ng.core import AppContext, set_app_context
from akagi_ng.dataserver.api import setup_routes


class TestShutdownAPI(AioHTTPTestCase):
    """测试 shutdown API 端点"""

    async def get_application(self):
        """创建测试应用"""
        app = web.Application()
        setup_routes(app)
        return app

    async def test_shutdown_no_message_queue(self):
        """测试当消息队列不可用时的响应"""
        # 设置一个没有 electron_client 的 app context
        from unittest.mock import Mock

        mock_settings = Mock()
        app_context = AppContext(
            settings=mock_settings,
            controller=None,
            bot=None,
            mitm_client=None,
            electron_client=None,
        )
        set_app_context(app_context)

        resp = await self.client.post("/api/shutdown")
        assert resp.status == 503
        data = await resp.json()
        assert data["ok"] is False
        assert "Message queue not available" in data["error"]

    async def test_shutdown_with_message_queue(self):
        """测试当消息队列可用时的响应"""
        from queue import Queue
        from unittest.mock import Mock

        mock_queue = Queue()
        mock_settings = Mock()
        app_context = AppContext(
            settings=mock_settings,
            controller=None,
            bot=None,
            mitm_client=None,
            electron_client=Mock(),
            shared_queue=mock_queue,
        )
        set_app_context(app_context)

        resp = await self.client.post("/api/shutdown")
        assert resp.status == 200
        data = await resp.json()
        assert data["ok"] is True
        assert data["message"] == "Shutdown initiated"

        # 验证消息已被放入队列
        assert not mock_queue.empty()
        shutdown_msg = mock_queue.get()
        assert shutdown_msg["type"] == "system_shutdown"
        assert shutdown_msg["source"] == "api"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
