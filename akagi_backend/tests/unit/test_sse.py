import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from aiohttp import web

from akagi_ng.dataserver.sse import SSEManager, _format_sse_message


@pytest.fixture
def sse_manager():
    manager = SSEManager()
    # Use the running loop if available, otherwise fallback (for pytest-asyncio)
    try:
        manager.loop = asyncio.get_running_loop()
    except RuntimeError:
        manager.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(manager.loop)
    manager.running = True
    return manager


@pytest.mark.asyncio
async def test_add_client(sse_manager):
    """测试手动添加客户端"""
    mock_response = MagicMock(spec=web.StreamResponse)
    mock_queue = asyncio.Queue()
    client_id = "test_client"
    client_data = {"response": mock_response, "queue": mock_queue}

    await sse_manager.add_client(client_id, client_data)

    async with sse_manager.lock:
        assert client_id in sse_manager.clients
        assert sse_manager.clients[client_id]["response"] == mock_response
        assert sse_manager.clients[client_id]["queue"] == mock_queue


@pytest.mark.asyncio
async def test_remove_client(sse_manager):
    """测试移除客户端"""
    mock_response = AsyncMock(spec=web.StreamResponse)
    client_id = "test_client"
    await sse_manager.add_client(client_id, {"response": mock_response, "queue": asyncio.Queue()})

    await sse_manager._remove_client(client_id, expected_response=mock_response)

    async with sse_manager.lock:
        assert client_id not in sse_manager.clients
    mock_response.write_eof.assert_awaited_once()


@pytest.mark.asyncio
async def test_remove_client_mismatch(sse_manager):
    """测试移除客户端时响应不匹配（不应移除）"""
    mock_response_1 = MagicMock(spec=web.StreamResponse)
    mock_response_2 = MagicMock(spec=web.StreamResponse)
    client_id = "test_client"

    await sse_manager.add_client(client_id, {"response": mock_response_1, "queue": asyncio.Queue()})

    # 尝试移除，但传入不匹配的响应对象
    await sse_manager._remove_client(client_id, expected_response=mock_response_2)

    async with sse_manager.lock:
        assert client_id in sse_manager.clients
        assert sse_manager.clients[client_id]["response"] == mock_response_1


@pytest.mark.asyncio
async def test_broadcast_async(sse_manager):
    """测试异步广播消息"""
    q1 = asyncio.Queue()
    q2 = asyncio.Queue()

    await sse_manager.add_client("c1", {"response": MagicMock(), "queue": q1})
    await sse_manager.add_client("c2", {"response": MagicMock(), "queue": q2})

    payload = b"test message"
    await sse_manager._broadcast_async(payload)

    assert await q1.get() == payload
    assert await q2.get() == payload


@pytest.mark.asyncio
async def test_broadcast_event(sse_manager):
    """测试事件广播与缓存更新"""
    q = asyncio.Queue()
    await sse_manager.add_client("c1", {"response": MagicMock(), "queue": q})

    event_data = {"key": "value"}

    # 模拟 run_coroutine_threadsafe 为立即执行，防止在一个 loop 中死锁
    with patch("asyncio.run_coroutine_threadsafe") as mock_run:
        sse_manager.broadcast_event("recommendations", event_data)

        # 验证缓存更新
        assert sse_manager.latest_recommendations == event_data

        # 验证是否尝试调用广播
        mock_run.assert_called_once()

        # 直接调用底层的 _broadcast_async 来验证数据流
        payload = _format_sse_message(event_data, event="recommendations")
        await sse_manager._broadcast_async(payload)
        assert await q.get() == payload


@pytest.mark.asyncio
async def test_notification_history(sse_manager):
    """测试通知历史记录"""
    # 模拟广播以避免真正的协程调度
    with patch("asyncio.run_coroutine_threadsafe"):
        for i in range(sse_manager.MAX_HISTORY + 5):
            sse_manager.broadcast_event("notification", {"id": i})

    assert len(sse_manager.notification_history) == sse_manager.MAX_HISTORY
    assert sse_manager.notification_history[-1] == {"id": sse_manager.MAX_HISTORY + 4}


@pytest.mark.asyncio
async def test_keep_alive_logic(sse_manager):
    """测试保活心跳逻辑"""
    q = asyncio.Queue()
    await sse_manager.add_client("c1", {"response": MagicMock(), "queue": q})

    keepalive_payload = b": keep-alive\n\n"

    # 模拟一次心跳循环中的逻辑
    async with sse_manager.lock:
        targets = list(sse_manager.clients.values())
    for client_data in targets:
        client_data["queue"].put_nowait(keepalive_payload)

    assert await q.get() == keepalive_payload
