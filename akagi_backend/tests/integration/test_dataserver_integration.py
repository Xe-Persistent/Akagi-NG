"""DataServer 集成测试

测试 API 和 SSE 的完整交互流程
"""

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
    # browser 字段已移除，改为 platform 和 game_url
    assert settings.mitm.enabled is False

    # 2. 测试部分更新 - 更新日志级别和服务器端口
    update_data = {
        "log_level": "DEBUG",
        "locale": "en-US",
        "game_url": "https://game.maj-soul.com/1/",
        "mitm": {"enabled": False, "platform": "majsoul", "host": "127.0.0.1", "port": 6789, "upstream": ""},
        "server": {"host": "127.0.0.1", "port": 9999},
        "ot": {"online": False, "server": "", "api_key": ""},
        "model_config": {
            "temperature": 0.5,
            "rule_based_agari_guard": False,
        },
    }
    settings.update(update_data)

    # 验证更新成功
    assert settings.log_level == "DEBUG"
    assert settings.locale == "en-US"
    assert settings.server.port == 9999
    assert settings.server.host == "127.0.0.1"
    assert settings.game_url == "https://game.maj-soul.com/1/"
    assert settings.model_config.temperature == 0.5
    assert settings.model_config.rule_based_agari_guard is False

    # 3. 测试转换回字典
    settings_dict = asdict(settings)
    assert isinstance(settings_dict, dict)
    assert settings_dict["log_level"] == "DEBUG"


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
