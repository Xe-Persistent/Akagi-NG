import ctypes
import json
import locale
import os
from dataclasses import asdict, dataclass
from pathlib import Path

import jsonschema
from jsonschema.exceptions import ValidationError

from akagi_ng.core.paths import ensure_dir, get_assets_dir, get_settings_dir
from akagi_ng.settings.logger import logger

CONFIG_DIR: Path = ensure_dir(get_settings_dir())
SETTINGS_JSON_PATH: Path = CONFIG_DIR / "settings.json"

SCHEMA_PATH: Path = get_assets_dir() / "settings.schema.json"


@dataclass
class OTConfig:
    online: bool
    server: str = ""
    api_key: str = ""


@dataclass
class BrowserConfig:
    enabled: bool
    headless: bool
    window_size: str  # 例如 "1920,1080" 或留空


@dataclass
class MITMConfig:
    enabled: bool
    host: str
    port: int
    upstream: str


@dataclass
class ServerConfig:
    host: str
    port: int


@dataclass
class ModelConfig:
    device: str
    temperature: float
    enable_amp: bool
    enable_quick_eval: bool
    rule_based_agari_guard: bool
    ot: OTConfig


@dataclass
class Settings:
    log_level: str
    locale: str
    majsoul_url: str
    browser: BrowserConfig
    mitm: MITMConfig
    server: ServerConfig
    model_config: ModelConfig

    def update(self, data: dict) -> None:
        """从字典更新设置"""
        _update_settings(self, data)
        self.ensure_consistency()

    def ensure_consistency(self) -> None:
        """确保设置一致性（如互斥性）"""
        # 互斥性：只能启用一种模式，默认使用浏览器模式
        if self.browser.enabled and self.mitm.enabled:
            logger.warning("Both Browser and MITM modes enabled. Prioritizing Browser mode.")
            self.mitm.enabled = False
        elif not self.browser.enabled and not self.mitm.enabled:
            logger.warning("Neither Browser nor MITM mode enabled. Defaulting to Browser mode.")
            self.browser.enabled = True

    def save(self) -> None:
        """保存设置到 settings.json 文件"""
        _save_settings(asdict(self))
        logger.info(f"Saved settings to {SETTINGS_JSON_PATH}")

    @classmethod
    def from_dict(cls, data: dict) -> "Settings":
        """从字典创建 Settings 对象"""
        browser_data = data.get("browser", {})
        mitm_data = data.get("mitm", {})
        server_data = data.get("server", {})
        model_config_data = data.get("model_config", {})
        ot_data = model_config_data.get("ot", {})

        settings = cls(
            log_level=data.get("log_level", "INFO"),
            locale=data.get("locale", "zh-CN"),
            majsoul_url=data.get("majsoul_url", "https://game.maj-soul.com/1/"),
            browser=BrowserConfig(
                enabled=browser_data.get("enabled", True),
                headless=browser_data.get("headless", False),
                window_size=browser_data.get("window_size", ""),
            ),
            mitm=MITMConfig(
                enabled=mitm_data.get("enabled", False),
                host=mitm_data.get("host", "127.0.0.1"),
                port=mitm_data.get("port", 6789),
                upstream=mitm_data.get("upstream", ""),
            ),
            server=ServerConfig(
                host=server_data.get("host", "0.0.0.0"),
                port=server_data.get("port", 8765),
            ),
            model_config=ModelConfig(
                device=model_config_data.get("device", "auto"),
                temperature=model_config_data.get("temperature", 0.3),
                enable_amp=model_config_data.get("enable_amp", False),
                enable_quick_eval=model_config_data.get("enable_quick_eval", False),
                rule_based_agari_guard=model_config_data.get("rule_based_agari_guard", True),
                ot=OTConfig(
                    online=ot_data.get("online", False),
                    server=ot_data.get("server", ""),
                    api_key=ot_data.get("api_key", ""),
                ),
            ),
        )
        settings.ensure_consistency()
        return settings


def detect_system_locale() -> str:
    """
    检测系统语言环境，返回支持的语言之一：
    zh-CN, zh-TW, ja-JP, en-US。
    检测失败或不支持的语言默认返回 en-US。
    """
    detected_locale = "en-US"

    if os.name == "nt":
        try:
            windll = ctypes.windll.kernel32
            lcid = windll.GetUserDefaultUILanguage()
            if lcid == 2052:  # zh-CN (0x0804)
                return "zh-CN"
            elif lcid in (1028, 3076, 5124):  # zh-TW, zh-HK, zh-MO
                return "zh-TW"
            elif lcid == 1041:  # ja-JP (0x0411)
                return "ja-JP"
        except Exception as e:
            logger.debug(f"Failed to detect locale via Windows API: {e}")

    try:
        sys_locale = locale.getlocale()[0]
        if sys_locale:
            if sys_locale.startswith("zh_CN"):  # Linux/Mac 通常使用下划线
                return "zh-CN"
            elif sys_locale.startswith("zh_TW") or sys_locale.startswith("zh_HK"):
                return "zh-TW"
            elif sys_locale.startswith("ja"):
                return "ja-JP"
    except Exception as e:
        logger.debug(f"Failed to detect locale via python locale: {e}")

    return detected_locale


def get_default_settings_dict() -> dict:
    return {
        "log_level": "INFO",
        "locale": detect_system_locale(),
        "majsoul_url": "https://game.maj-soul.com/1/",
        "browser": {"enabled": True, "headless": False, "window_size": ""},
        "mitm": {"enabled": False, "host": "127.0.0.1", "port": 6789, "upstream": ""},
        "server": {"host": "0.0.0.0", "port": 8765},
        "model_config": {
            "device": "auto",
            "temperature": 0.3,
            "enable_amp": False,
            "enable_quick_eval": False,
            "rule_based_agari_guard": True,
            "ot": {"online": False, "server": "http://127.0.0.1:5000", "api_key": "<YOUR_API_KEY>"},
        },
    }


def get_settings_dict() -> dict:
    """从 settings.json 读取设置"""
    with open(SETTINGS_JSON_PATH, encoding="utf-8") as f:
        return json.load(f)


def verify_settings(data: dict) -> bool:
    """根据 schema 验证设置"""
    try:
        jsonschema.validate(data, _get_schema())
        return True
    except ValidationError as e:
        logger.error(f"Settings validation error: {e.message}")
        return False


def _load_settings() -> Settings:
    """
    加载并验证设置。
    - 检查 schema 文件是否存在
    - 从 CONFIG_DIR 读取 settings.json
    - 如果 settings.json 损坏，备份并重建默认设置

    Raises:
        FileNotFoundError: schema 不存在
    """
    # 验证 schema 文件存在
    schema = _get_schema()

    if not SETTINGS_JSON_PATH.exists():
        logger.warning(f"{SETTINGS_JSON_PATH} not found. Creating a default {SETTINGS_JSON_PATH}.")
        with open(SETTINGS_JSON_PATH, "w", encoding="utf-8") as f:
            json.dump(get_default_settings_dict(), f, indent=4, ensure_ascii=False)

    try:
        with open(SETTINGS_JSON_PATH, encoding="utf-8") as f:
            loaded_settings = json.load(f)
        jsonschema.validate(loaded_settings, schema)
    except json.JSONDecodeError as e:
        loaded_settings = _backup_and_reset_settings(f"settings.json corrupted: {e}")
    except ValidationError as e:
        loaded_settings = _backup_and_reset_settings(f"settings.json validation failed: {e.message}")

    return Settings.from_dict(loaded_settings)


def _get_schema() -> dict:
    """获取 settings.json 的 schema"""
    if not SCHEMA_PATH.exists():
        raise FileNotFoundError(f"settings.schema.json not found at {SCHEMA_PATH}")
    with open(SCHEMA_PATH, encoding="utf-8") as f:
        return json.load(f)


def _update_settings(settings: Settings, data: dict) -> None:
    """从字典更新 Settings 对象"""
    settings.log_level = data.get("log_level", "INFO")
    settings.locale = data.get("locale", "zh-CN")
    settings.majsoul_url = data["majsoul_url"]

    browser_data = data.get("browser", {})
    settings.browser.enabled = browser_data.get("enabled", True)
    settings.browser.headless = browser_data.get("headless", False)
    settings.browser.window_size = browser_data.get("window_size", "")

    mitm_data = data.get("mitm", {})
    settings.mitm.enabled = mitm_data.get("enabled", False)
    settings.mitm.host = mitm_data.get("host", "127.0.0.1")
    settings.mitm.port = mitm_data.get("port", 6789)
    settings.mitm.upstream = mitm_data.get("upstream", "")

    server_data = data.get("server", {})
    settings.server.host = server_data.get("host", "0.0.0.0")
    settings.server.port = server_data.get("port", 8765)

    model_config_data = data.get("model_config", {})
    settings.model_config.device = model_config_data.get("device", "auto")
    settings.model_config.temperature = model_config_data.get("temperature", 0.3)
    settings.model_config.enable_amp = model_config_data.get("enable_amp", False)
    settings.model_config.enable_quick_eval = model_config_data.get("enable_quick_eval", False)
    settings.model_config.rule_based_agari_guard = model_config_data.get("rule_based_agari_guard", True)

    ot_data = model_config_data.get("ot", {})
    settings.model_config.ot.online = ot_data.get("online", False)
    if settings.model_config.ot.online:
        settings.model_config.ot.server = ot_data.get("server", "")
        settings.model_config.ot.api_key = ot_data.get("api_key", "")
    else:
        settings.model_config.ot.server = ot_data.get("server", "")
        settings.model_config.ot.api_key = ot_data.get("api_key", "")


def _save_settings(data: dict) -> None:
    """保存 settings.json"""
    with open(SETTINGS_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)


def _backup_and_reset_settings(reason: str) -> dict:
    """
    备份当前设置文件并重建默认值。
    返回新的默认设置字典。
    """
    logger.error(reason)
    bak_path = SETTINGS_JSON_PATH.with_suffix(".json.bak")
    logger.warning(f"Backup settings.json to {bak_path}")

    if SETTINGS_JSON_PATH.exists():
        os.replace(SETTINGS_JSON_PATH, bak_path)

    logger.warning("Creating new settings.json with default values")
    default_settings = get_default_settings_dict()
    with open(SETTINGS_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(default_settings, f, indent=4, ensure_ascii=False)

    return default_settings


local_settings: Settings = _load_settings()
