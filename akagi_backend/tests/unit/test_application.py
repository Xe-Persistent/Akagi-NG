import threading
from unittest.mock import MagicMock, patch

import pytest

from akagi_ng.application import AkagiApp
from akagi_ng.core import AppContext


@pytest.fixture
def app():
    return AkagiApp()


def test_app_initialization(app) -> None:
    """测试应用初始化流程。"""
    with (
        patch("akagi_ng.application.configure_logging"),
        patch("akagi_ng.application.DataServer") as mock_ds_class,
        patch("akagi_ng.application.MitmClient"),
        patch("akagi_ng.mjai_bot.Controller"),
        patch("akagi_ng.mjai_bot.StateTrackerBot"),
        patch("akagi_ng.electron_client.create_electron_client"),
        patch("akagi_ng.application.set_app_context") as mock_set_ctx,
    ):
        app.initialize()

        assert app.ds is not None
        mock_ds_class.assert_called_once()
        mock_set_ctx.assert_called_once()


def test_app_start_stop(app) -> None:
    """测试应用的启动和停止信号。"""
    app.ds = MagicMock()

    mock_ctx = MagicMock()
    # 手动构建嵌套 Mock 结构避免 AttributeError
    mock_ctx.settings.mitm.enabled = True
    mock_ctx.mitm_client = MagicMock()
    mock_ctx.electron_client = MagicMock()

    with (
        patch("akagi_ng.application.get_app_context", return_value=mock_ctx),
        patch("akagi_ng.application.signal.signal"),
    ):
        app.start()

        assert app.ds.start.called
        assert mock_ctx.mitm_client.start.called
        assert mock_ctx.electron_client.start.called

        app.stop()
        assert app.get_stop_event().is_set()


def test_app_main_loop_flow(app) -> None:
    """测试主循环的消息处理流程。"""
    app.ds = MagicMock()
    app._stop_event = threading.Event()

    mock_ctx = MagicMock(spec=AppContext)
    mock_ctx.bot = MagicMock()
    mock_ctx.controller = MagicMock()

    msg = {"type": "tsumo", "actor": 0}

    # 模拟获取一条消息后停止
    def side_effect(*args, **kwargs):
        app.stop()
        return msg

    with (
        patch("akagi_ng.application.get_app_context", return_value=mock_ctx),
        patch.object(app, "_get_next_message", side_effect=side_effect),
        patch.object(app, "_emit_outputs") as mock_emit,
        patch.object(app, "cleanup"),
    ):
        app.run()

        # 验证是否采集了输出
        mock_emit.assert_called_once()


def test_app_cleanup(app) -> None:
    """测试清理逻辑。"""
    app.ds = MagicMock()
    mock_ctx = MagicMock(spec=AppContext)
    mock_ctx.mitm_client = MagicMock()
    mock_ctx.electron_client = MagicMock()

    with patch("akagi_ng.application.get_app_context", return_value=mock_ctx):
        app.cleanup()

        assert mock_ctx.mitm_client.stop.called
        assert mock_ctx.electron_client.stop.called
        assert app.ds.stop.called


def test_process_message_batch_error_handling(app) -> None:
    """测试消息处理中的异常捕获。"""
    mock_bot = MagicMock()
    mock_ctrl = MagicMock()

    # 模拟 Controller 抛出异常
    mock_ctrl.react.side_effect = ValueError("Test Error")

    msgs = [{"type": "dahai"}]
    responses, notifications = app._process_message_batch(msgs, mock_bot, mock_ctrl)

    # 不应导致崩溃，且返回为空
    assert responses == []
    assert notifications == []


def test_emit_outputs_standard(app) -> None:
    """测试标准输出发射路径。"""
    app.ds = MagicMock()
    result = {
        "mjai_responses": [{"action": "dahai", "meta": {}}],
        "batch_notifications": [{"code": "TEST"}],
        "is_sync": False,
    }
    mock_bot = MagicMock()

    with patch("akagi_ng.application.build_dataserver_payload", return_value={"rec": True}):
        app._emit_outputs(result, mock_bot)

        # 应该发送通知和推荐
        assert app.ds.send_notifications.called
        assert app.ds.send_recommendations.called


def test_emit_outputs_sync_masking(app) -> None:
    """测试同步期间屏蔽推荐。"""
    app.ds = MagicMock()
    result = {
        "mjai_responses": [{"action": "sync", "meta": {}}],
        "batch_notifications": [{"code": "SYNCING"}],
        "is_sync": True,
    }
    mock_bot = MagicMock()

    with patch("akagi_ng.application.build_dataserver_payload", return_value={"rec": True}):
        app._emit_outputs(result, mock_bot)

        # 应该发送通知，但不发送推荐
        assert app.ds.send_notifications.called
        assert not app.ds.send_recommendations.called


# 为测试添加辅助方法
def get_stop_event(self):
    return self._stop_event


AkagiApp.get_stop_event = get_stop_event
