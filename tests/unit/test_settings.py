"""
Settings 模块单元测试

测试 Settings 类的加载、保存、验证和更新功能。
"""

import sys
import unittest
from pathlib import Path

# 添加项目根目录到 sys.path
sys.path.append(str(Path(__file__).parent.parent))

from akagi_ng.settings.settings import (
    BrowserConfig,
    MITMConfig,
    ModelConfig,
    OTConfig,
    ServerConfig,
    Settings,
    detect_system_locale,
    get_default_settings_dict,
    verify_settings,
)


class TestSettingsDataclasses(unittest.TestCase):
    """测试 Settings 相关 dataclass 的基本功能"""

    def test_ot_config_defaults(self):
        """测试 OTConfig 默认值"""
        config = OTConfig(online=False)
        self.assertFalse(config.online)
        self.assertEqual(config.server, "")
        self.assertEqual(config.api_key, "")

    def test_browser_config_creation(self):
        """测试 BrowserConfig 创建"""
        config = BrowserConfig(enabled=True, window_size="1280x720")
        self.assertTrue(config.enabled)
        self.assertEqual(config.window_size, "1280x720")

    def test_mitm_config_creation(self):
        """测试 MITMConfig 创建"""
        config = MITMConfig(enabled=True, host="127.0.0.1", port=6789, upstream="")
        self.assertTrue(config.enabled)
        self.assertEqual(config.host, "127.0.0.1")
        self.assertEqual(config.port, 6789)

    def test_server_config_creation(self):
        """测试 ServerConfig 创建"""
        config = ServerConfig(host="0.0.0.0", port=8080)
        self.assertEqual(config.host, "0.0.0.0")
        self.assertEqual(config.port, 8080)

    def test_model_config_creation(self):
        """测试 ModelConfig 创建"""
        config = ModelConfig(
            device="cuda",
            temperature=0.7,
            enable_amp=True,
            enable_quick_eval=False,
            rule_based_agari_guard=True,
        )
        self.assertEqual(config.device, "cuda")


class TestSettingsClass(unittest.TestCase):
    """测试 Settings 类"""

    def setUp(self):
        """创建测试用 Settings 实例"""
        self.settings = Settings(
            log_level="INFO",
            locale="zh-CN",
            browser=BrowserConfig(
                enabled=True,
                window_size="1280x720",
                platform="majsoul",
                url="https://game.maj-soul.com/1/",
            ),
            mitm=MITMConfig(enabled=False, host="127.0.0.1", port=6789, upstream=""),
            server=ServerConfig(host="127.0.0.1", port=8765),
            ot=OTConfig(online=False),
            model_config=ModelConfig(
                device="cpu",
                temperature=1.0,
                enable_amp=False,
                enable_quick_eval=True,
                rule_based_agari_guard=True,
            ),
        )

    def test_settings_creation(self):
        """测试 Settings 对象创建"""
        self.assertEqual(self.settings.log_level, "INFO")
        self.assertEqual(self.settings.locale, "zh-CN")
        self.assertTrue(self.settings.browser.enabled)
        self.assertFalse(self.settings.mitm.enabled)

    def test_settings_ensure_consistency_browser_enabled(self):
        """测试互斥性：当 browser 启用时，mitm 应被禁用"""
        self.settings.browser.enabled = True
        self.settings.mitm.enabled = True

        self.settings.ensure_consistency()

        self.assertTrue(self.settings.browser.enabled)
        self.assertFalse(self.settings.mitm.enabled)

    def test_settings_ensure_consistency_mitm_enabled(self):
        """测试互斥性：当 browser 禁用时，mitm 设置不变"""
        self.settings.browser.enabled = False
        self.settings.mitm.enabled = True

        self.settings.ensure_consistency()

        self.assertFalse(self.settings.browser.enabled)
        self.assertTrue(self.settings.mitm.enabled)

    def test_settings_direct_attribute_update(self):
        """测试直接更新 Settings 属性"""
        self.settings.log_level = "DEBUG"
        self.settings.locale = "en-US"

        self.assertEqual(self.settings.log_level, "DEBUG")
        self.assertEqual(self.settings.locale, "en-US")
        # 其他字段应保持不变
        self.assertTrue(self.settings.browser.enabled)



    def test_settings_from_dict(self):
        """测试从字典创建 Settings"""
        data = {
            "log_level": "TRACE",
            "locale": "ja-JP",
            "browser": {
                "enabled": False,
                "platform": "majsoul",
                "url": "https://game.maj-soul.com/1/",
                "window_size": "1920x1080",
            },
            "mitm": {"enabled": True, "platform": "majsoul", "host": "0.0.0.0", "port": 7890, "upstream": ""},
            "server": {"host": "localhost", "port": 9000},
            "model_config": {
                "device": "cuda",
                "temperature": 0.5,
                "enable_amp": True,
                "enable_quick_eval": False,
                "rule_based_agari_guard": False,
                "ot": {"online": True, "server": "https://api.test.com", "api_key": "abc123"},
            },
        }

        settings = Settings.from_dict(data)

        self.assertEqual(settings.log_level, "TRACE")
        self.assertEqual(settings.locale, "ja-JP")
        self.assertFalse(settings.browser.enabled)
        self.assertTrue(settings.mitm.enabled)
        self.assertEqual(settings.server.port, 9000)
        self.assertTrue(settings.ot.online)


class TestSettingsFunctions(unittest.TestCase):
    """测试 Settings 相关函数"""

    def test_get_default_settings_dict(self):
        """测试获取默认设置字典"""
        defaults = get_default_settings_dict()

        self.assertIn("log_level", defaults)
        self.assertIn("locale", defaults)
        self.assertIn("browser", defaults)
        self.assertIn("mitm", defaults)
        self.assertIn("server", defaults)
        self.assertIn("model_config", defaults)

        # 验证默认值
        self.assertEqual(defaults["log_level"], "INFO")
        self.assertTrue(defaults["browser"]["enabled"])

    def test_verify_settings_valid(self):
        """测试验证有效设置"""
        valid_data = get_default_settings_dict()

        # 应该不抛出异常
        is_valid = verify_settings(valid_data)
        self.assertTrue(is_valid)

    def test_verify_settings_invalid_log_level(self):
        """测试验证无效的 log_level"""
        invalid_data = get_default_settings_dict()
        invalid_data["log_level"] = "INVALID_LEVEL"

        is_valid = verify_settings(invalid_data)
        self.assertFalse(is_valid)

    def test_verify_settings_missing_required(self):
        """测试验证缺少必填字段"""
        invalid_data = {"log_level": "INFO"}  # 缺少其他必填字段

        is_valid = verify_settings(invalid_data)
        self.assertFalse(is_valid)


class TestDetectSystemLocale(unittest.TestCase):
    """测试系统语言检测"""

    def test_detect_system_locale_returns_valid_locale(self):
        """测试系统语言检测返回有效的语言代码"""
        result = detect_system_locale()
        # 返回值应该是支持的语言之一
        self.assertIn(result, ["zh-CN", "zh-TW", "ja-JP", "en-US"])

    def test_detect_system_locale_returns_string(self):
        """测试系统语言检测返回字符串"""
        result = detect_system_locale()
        self.assertIsInstance(result, str)
        self.assertTrue(len(result) > 0)


if __name__ == "__main__":
    unittest.main()
