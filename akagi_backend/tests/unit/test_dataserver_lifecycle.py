import asyncio
from unittest.mock import MagicMock, patch

import pytest

from akagi_ng.dataserver.dataserver import DataServer


@pytest.fixture
def ds():
    return DataServer(host="127.0.0.1", external_port=8000)


async def test_dataserver_lifecycle_basic(ds) -> None:
    # 直接设置运行状态，无需调用 start
    ds.running = True
    ds.loop = MagicMock()
    ds.loop.is_running.return_value = True

    # 验证停止逻辑
    ds.stop()

    # Verify loop stop was scheduled
    assert ds.loop.stop.called or ds.loop.call_soon_threadsafe.called


def test_dataserver_proxy_methods(ds):
    """测试 DataServer 转发给 SSEManager 的方法"""
    ds.sse_manager = MagicMock()

    # broadcast_event
    ds.broadcast_event("test_type", {"data": 1})
    ds.sse_manager.broadcast_event.assert_called()

    # send_recommendations
    ds.send_recommendations({"recommendations": ["discard"], "action": "discard"})
    assert ds.sse_manager.broadcast_event.called

    # update_system_error
    ds.update_system_error(404, "not found")
    ds.sse_manager.broadcast_event.assert_called()

    # send_notifications
    ds.send_notifications([{"code": 1001, "msg": "msg"}])
    ds.sse_manager.broadcast_event.assert_called()


def test_dataserver_run_logic(ds):
    """测试 run 方法的启动、运行和清理逻辑"""
    with patch("asyncio.new_event_loop") as mock_new_loop:
        mock_loop = MagicMock(spec=asyncio.AbstractEventLoop)
        mock_new_loop.return_value = mock_loop

        # Mock run_forever to stop immediately
        mock_loop.run_forever.return_value = None

        # 1. 启动异常收集
        with patch("aiohttp.web.Application", side_effect=RuntimeError("startup fail")):
            ds.run()
            # 应该调用了 loop.close()
            mock_loop.close.assert_called()

        mock_loop.reset_mock()

        # 2. 正常运行流程拦截
        with (
            patch("aiohttp.web.Application"),
            patch("akagi_ng.dataserver.dataserver.SSEManager"),
            patch("aiohttp.web.AppRunner") as mock_runner_class,
            patch("aiohttp.web.TCPSite"),
        ):
            mock_runner = mock_runner_class.return_value
            # 让 run_until_complete 立即结束以模拟 stop_event
            mock_loop.run_until_complete.return_value = None

            ds.run()

            # 验证清理工作
            mock_runner.cleanup.assert_called()
            mock_loop.close.assert_called()


def test_dataserver_stop_signal(ds):
    """验证 stop 方法会正确停止事件循环"""
    ds.loop = MagicMock(spec=asyncio.AbstractEventLoop)
    # Ensure is_running returns True to trigger stop logic
    ds.loop.is_running.return_value = True
    ds.running = True

    ds.stop()

    assert ds.running is False
    ds.loop.call_soon_threadsafe.assert_called()
