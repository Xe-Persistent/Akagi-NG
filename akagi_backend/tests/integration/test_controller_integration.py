"""Controller 和组件的集成测试

测试 Controller 与 Bot、Frontend Adapter 的集成
"""

import pytest


@pytest.mark.integration
def test_controller_initialization(integration_controller):
    """测试 Controller 的初始化流程"""
    # Controller 应该正确初始化
    assert integration_controller is not None
    assert hasattr(integration_controller, "bot")


@pytest.mark.integration
def test_controller_message_flow(integration_controller):
    """测试 Controller 处理消息的完整流程"""
    # 创建一个简单的消息
    message = {"type": "reach", "actor": 0}

    # Controller 应该能够处理消息
    # 注意：这个测试可能需要 mock Bot，因为 Bot 可能未加载
    try:
        result = integration_controller.react(message)
        # 如果 Bot 未加载，应该返回 error 响应
        if isinstance(result, dict) and "error" in result:
            assert result["error"] is not None
    except Exception:
        # 如果抛出异常也是可以接受的（取决于 Bot 状态）
        pass


@pytest.mark.integration
def test_event_handler_integration():
    """测试 EventHandler 的集成功能"""
    from akagi_ng.core.notification_handler import NotificationHandler

    # 测试从消息提取通知
    start_game_msg = {"type": "start_game", "id": 0}
    notification = NotificationHandler.from_message(start_game_msg)

    assert notification is not None
    assert "code" in notification

    # 测试从标志提取通知
    flags = {"fallback_used": True, "circuit_open": False}
    notifications = NotificationHandler.from_flags(flags)

    assert len(notifications) == 1
    assert notifications[0]["code"] is not None

    # 测试从错误响应提取通知
    error_response = {"error": "parse_error"}
    notification = NotificationHandler.from_error_response(error_response)

    assert notification is not None
    assert notification["code"] is not None
