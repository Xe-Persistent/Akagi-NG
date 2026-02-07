import unittest
from unittest.mock import mock_open, patch

from akagi_ng.settings.settings import (
    SETTINGS_JSON_PATH,
    MITMConfig,
    ModelConfig,
    OTConfig,
    Platform,
    ServerConfig,
    Settings,
    _backup_and_reset_settings,
    _detect_locale_python,
    _detect_locale_windows,
    _get_schema,
    _load_settings,
    detect_system_locale,
    get_default_settings_dict,
    verify_settings,
)


class TestSettingsDataclasses(unittest.TestCase):
    """测试 Settings 相关 dataclass 的基本功能"""

    def test_ot_config_defaults(self):
        config = OTConfig(online=False)
        self.assertFalse(config.online)
        self.assertEqual(config.server, "")
        self.assertEqual(config.api_key, "")

    def test_mitm_config_creation(self):
        config = MITMConfig(enabled=True, host="127.0.0.1", port=6789, upstream="")
        self.assertTrue(config.enabled)
        self.assertEqual(config.host, "127.0.0.1")
        self.assertEqual(config.port, 6789)

    def test_server_config_creation(self):
        config = ServerConfig(host="0.0.0.0", port=8080)
        self.assertEqual(config.host, "0.0.0.0")
        self.assertEqual(config.port, 8080)

    def test_model_config_creation(self):
        config = ModelConfig(
            temperature=0.7,
            rule_based_agari_guard=True,
        )
        self.assertEqual(config.temperature, 0.7)


class TestSettingsClass(unittest.TestCase):
    """测试 Settings 类方法"""

    def setUp(self):
        self.settings = Settings(
            log_level="INFO",
            locale="zh-CN",
            game_url="https://game.maj-soul.com/1/",
            platform=Platform.MAJSOUL,
            mitm=MITMConfig(enabled=False, host="127.0.0.1", port=6789, upstream=""),
            server=ServerConfig(host="127.0.0.1", port=8765),
            ot=OTConfig(online=False),
            model_config=ModelConfig(
                temperature=1.0,
                rule_based_agari_guard=True,
            ),
        )

    def test_settings_creation(self):
        self.assertEqual(self.settings.log_level, "INFO")
        self.assertEqual(self.settings.locale, "zh-CN")

    def test_settings_direct_attribute_update(self):
        self.settings.log_level = "DEBUG"
        self.settings.locale = "en-US"
        self.assertEqual(self.settings.log_level, "DEBUG")
        self.assertEqual(self.settings.locale, "en-US")

    def test_settings_from_dict(self):
        data = {
            "log_level": "TRACE",
            "locale": "ja-JP",
            "game_url": "https://game.maj-soul.com/1/",
            "platform": "majsoul",
            "mitm": {"enabled": True, "host": "0.0.0.0", "port": 7890, "upstream": ""},
            "server": {"host": "localhost", "port": 9000},
            "ot": {"online": True, "server": "https://api.test.com", "api_key": "abc123"},
            "model_config": {
                "temperature": 0.5,
                "rule_based_agari_guard": False,
                "model_4p": "mortal.pth",
                "model_3p": "mortal3p.pth",
            },
        }
        settings = Settings.from_dict(data)
        self.assertEqual(settings.log_level, "TRACE")
        self.assertEqual(settings.locale, "ja-JP")
        self.assertTrue(settings.mitm.enabled)

    def test_settings_game_url_validation(self):
        # Tenhou platform with Majsoul URL should be corrected
        s = Settings.from_dict({"platform": "tenhou", "game_url": "https://maj-soul.com"})
        self.assertIn("tenhou.net", s.game_url)
        # Majsoul platform with Tenhou URL should be corrected
        s = Settings.from_dict({"platform": "majsoul", "game_url": "https://tenhou.net"})
        self.assertIn("maj-soul.com", s.game_url)

    def test_settings_update(self):
        s = Settings.from_dict({})
        s.update({"log_level": "DEBUG", "mitm": {"enabled": True}})
        self.assertEqual(s.log_level, "DEBUG")
        self.assertTrue(s.mitm.enabled)


class TestSettingsLifecycle(unittest.TestCase):
    """测试 Settings 文件的生命周期（加载、验证、备份、错误处理）"""

    def test_get_default_settings_dict(self):
        defaults = get_default_settings_dict()
        self.assertIn("log_level", defaults)
        self.assertEqual(defaults["log_level"], "INFO")

    def test_verify_settings_valid(self):
        valid_data = get_default_settings_dict()
        self.assertTrue(verify_settings(valid_data))

    def test_verify_settings_invalid(self):
        invalid_data = get_default_settings_dict()
        invalid_data["log_level"] = "INVALID_LEVEL"
        self.assertFalse(verify_settings(invalid_data))

    def test_get_schema_file_not_found(self):
        with patch("akagi_ng.settings.settings.SCHEMA_PATH") as mock_path:
            mock_path.exists.return_value = False
            with self.assertRaises(FileNotFoundError):
                _get_schema()

    def test_backup_and_reset_settings(self):
        with (
            patch("akagi_ng.settings.settings.SETTINGS_JSON_PATH") as mock_path,
            patch("os.replace") as mock_replace,
            patch("builtins.open", mock_open()),
        ):
            mock_path.exists.return_value = True
            mock_path.with_suffix.return_value = SETTINGS_JSON_PATH.with_suffix(".json.bak")

            res = _backup_and_reset_settings("test reason")
            self.assertIn("locale", res)
            mock_replace.assert_called()

    def test_load_settings_corruption_path(self):
        with (
            patch("akagi_ng.settings.settings._get_schema", return_value={}),
            patch("akagi_ng.settings.settings.SETTINGS_JSON_PATH") as mock_path,
            patch("builtins.open", mock_open(read_data="invalid json")),
            patch("akagi_ng.settings.settings._backup_and_reset_settings") as mock_backup,
        ):
            mock_path.exists.return_value = True
            mock_backup.return_value = get_default_settings_dict()
            _load_settings()
            mock_backup.assert_called()


class TestLocaleDetectionDetailed(unittest.TestCase):
    """详细测试系统区域语言检测逻辑"""

    def test_detect_locale_windows(self):
        with patch("ctypes.windll.kernel32") as mock_windll:
            # 简体中文
            mock_windll.GetUserDefaultUILanguage.return_value = 2052
            self.assertEqual(_detect_locale_windows(), "zh-CN")
            # 繁体中文
            mock_windll.GetUserDefaultUILanguage.return_value = 1028
            self.assertEqual(_detect_locale_windows(), "zh-TW")
            # 日文
            mock_windll.GetUserDefaultUILanguage.return_value = 1041
            self.assertEqual(_detect_locale_windows(), "ja-JP")

    def test_detect_locale_python(self):
        with patch("locale.getlocale") as mock_getlocale:
            mock_getlocale.return_value = ("zh_CN", "UTF-8")
            self.assertEqual(_detect_locale_python(), "zh-CN")
            mock_getlocale.return_value = ("ja_JP", "UTF-8")
            self.assertEqual(_detect_locale_python(), "ja-JP")

    def test_detect_system_locale_fallback(self):
        with patch("os.name", "posix"), patch("akagi_ng.settings.settings._detect_locale_python", return_value=None):
            self.assertEqual(detect_system_locale(), "en-US")
