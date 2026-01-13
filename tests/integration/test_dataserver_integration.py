"""DataServer 集成测试

测试 API 和 SSE 的完整交互流程
"""

import asyncio

import pytest


@pytest.mark.integration
def test_settings_lifecycle():
    """测试 Settings 的完整生命周期"""
    from dataclasses import asdict

    from akagi_ng.settings import Settings, get_default_settings_dict

    # 1. 从默认设置创建 Settings 对象
    default_dict = get_default_settings_dict()
    settings = Settings.from_dict(default_dict)

    # 验证创建成功
    assert settings.log_level == "INFO"
    assert settings.browser.enabled is True
    assert settings.mitm.enabled is False
    assert settings.model_config.device == "auto"

    # 2. 测试部分更新 - 更新日志级别和服务器端口
    update_data = {
        "log_level": "DEBUG",
        "locale": "en-US",
        "majsoul_url": "https://game.maj-soul.com/1/",
        "browser": {"enabled": True, "headless": True, "window_size": "1920,1080"},
        "mitm": {"enabled": False, "host": "127.0.0.1", "port": 6789, "upstream": ""},
        "server": {"host": "127.0.0.1", "port": 9999},
        "model_config": {
            "device": "cuda",
            "temperature": 0.5,
            "enable_amp": True,
            "enable_quick_eval": True,
            "rule_based_agari_guard": False,
            "ot": {"online": False, "server": "", "api_key": ""},
        },
    }
    settings.update(update_data)

    # 验证更新成功
    assert settings.log_level == "DEBUG"
    assert settings.locale == "en-US"
    assert settings.server.port == 9999
    assert settings.server.host == "127.0.0.1"
    assert settings.browser.headless is True
    assert settings.browser.window_size == "1920,1080"
    assert settings.model_config.device == "cuda"
    assert settings.model_config.temperature == 0.5
    assert settings.model_config.enable_amp is True
    assert settings.model_config.rule_based_agari_guard is False

    # 3. 测试一致性检查 - 同时启用两种模式时应该优先浏览器模式
    conflict_data = {
        "log_level": "DEBUG",
        "locale": "en-US",
        "majsoul_url": "https://game.maj-soul.com/1/",
        "browser": {"enabled": True, "headless": False, "window_size": ""},
        "mitm": {"enabled": True, "host": "127.0.0.1", "port": 6789, "upstream": ""},  # 同时启用
        "server": {"host": "0.0.0.0", "port": 8765},
        "model_config": {
            "device": "auto",
            "temperature": 0.3,
            "enable_amp": False,
            "enable_quick_eval": False,
            "rule_based_agari_guard": True,
            "ot": {"online": False, "server": "", "api_key": ""},
        },
    }
    settings.update(conflict_data)

    # 验证一致性：浏览器模式应该保持启用，MITM 应该被禁用
    assert settings.browser.enabled is True
    assert settings.mitm.enabled is False

    # 4. 测试都禁用时应该默认启用浏览器模式
    both_disabled_data = {
        "log_level": "INFO",
        "locale": "zh-CN",
        "majsoul_url": "https://game.maj-soul.com/1/",
        "browser": {"enabled": False, "headless": False, "window_size": ""},
        "mitm": {"enabled": False, "host": "127.0.0.1", "port": 6789, "upstream": ""},
        "server": {"host": "0.0.0.0", "port": 8765},
        "model_config": {
            "device": "auto",
            "temperature": 0.3,
            "enable_amp": False,
            "enable_quick_eval": False,
            "rule_based_agari_guard": True,
            "ot": {"online": False, "server": "", "api_key": ""},
        },
    }
    settings.update(both_disabled_data)

    # 验证一致性：浏览器模式应该被自动启用
    assert settings.browser.enabled is True
    assert settings.mitm.enabled is False

    # 5. 测试转换回字典
    settings_dict = asdict(settings)
    assert isinstance(settings_dict, dict)
    assert settings_dict["log_level"] == "INFO"
    assert settings_dict["browser"]["enabled"] is True


@pytest.mark.integration
def test_settings_validation_flow():
    """测试设置验证的完整流程"""
    from akagi_ng.settings import get_default_settings_dict, verify_settings

    # 有效设置 - 使用默认设置
    valid_settings = get_default_settings_dict()
    assert verify_settings(valid_settings) is True

    # 无效设置 - 空字典
    invalid_settings = {}
    assert verify_settings(invalid_settings) is False


@pytest.mark.integration
@pytest.mark.asyncio
async def test_sse_manager_lifecycle():
    """测试 SSE Manager 的完整生命周期"""
    from akagi_ng.dataserver.sse import SSEManager

    sse_manager = SSEManager()

    # 设置事件循环
    loop = asyncio.get_event_loop()
    sse_manager.set_loop(loop)

    # 启动
    sse_manager.start()
    assert sse_manager.running is True
    assert sse_manager.keep_alive_task is not None

    # 测试广播功能（无客户端连接）
    sse_manager.broadcast_event("notification", {"level": "info", "code": "test"})
    assert sse_manager.latest_notification == {"level": "info", "code": "test"}

    sse_manager.broadcast_event("recommendations", {"actions": []})
    assert sse_manager.latest_recommendations == {"actions": []}

    # 停止
    sse_manager.stop()
    assert sse_manager.running is False
