import ctypes
import json
import locale
import os
from dataclasses import asdict, dataclass
from pathlib import Path

import jsonschema
from jsonschema.exceptions import ValidationError

if os.name == "nt":
    import winreg
else:
    winreg = None

from akagi_ng.core.context import ensure_dir, get_assets_dir, get_settings_dir
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
    window_size: str  # e.g. "1920,1080" or empty
    user_agent: str = ""


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
    enable_amp: bool
    enable_quick_eval: bool
    rule_based_agari_guard: bool
    ot: OTConfig


@dataclass
class Settings:
    log_level: str
    locale: str
    majsoul_url: str
    model: str
    browser: BrowserConfig
    mitm: MITMConfig
    server: ServerConfig
    model_config: ModelConfig

    def update(self, data: dict) -> None:
        """
        Update settings from a dictionary

        Args:
            data (dict): Dictionary with settings to update
        """
        _update_settings(self, data)
        self.ensure_consistency()

    def ensure_consistency(self) -> None:
        """
        Ensure settings consistency (e.g. mutual exclusivity)
        """
        # Mutual exclusivity: Only one mode enabled. Default to Browser if undefined or conflict.
        if self.browser.enabled and self.mitm.enabled:
            logger.warning("Both Browser and MITM modes enabled. Prioritizing Browser mode.")
            self.mitm.enabled = False
        elif not self.browser.enabled and not self.mitm.enabled:
            logger.warning("Neither Browser nor MITM mode enabled. Defaulting to Browser mode.")
            self.browser.enabled = True

    def save(self) -> None:
        """
        Save the settings to the settings.json file (project_root/config/settings.json)
        """
        _save_settings(asdict(self))
        logger.info(f"Saved settings to {SETTINGS_JSON_PATH}")

    @classmethod
    def from_dict(cls, data: dict) -> "Settings":
        """
        Create a Settings object from a dictionary
        """
        browser_data = data.get("browser", {})
        mitm_data = data.get("mitm", {})
        server_data = data.get("server", {})
        model_config_data = data.get("model_config", {})
        ot_data = model_config_data.get("ot", {})

        settings = cls(
            log_level=data.get("log_level", "INFO"),
            locale=data.get("locale", "zh-CN"),
            majsoul_url=data.get("majsoul_url", "https://game.maj-soul.com/1/"),
            model=data.get("model", "mortal"),
            browser=BrowserConfig(
                enabled=browser_data.get("enabled", True),
                headless=browser_data.get("headless", False),
                window_size=browser_data.get("window_size", ""),
                user_agent=browser_data.get("user_agent", ""),
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
    Detect system locale and return one of the supported locales:
    zh-CN, zh-TW, ja-JP, en-US.
    Defaults to en-US if detection fails or locale is not supported.
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
        sys_locale = locale.getdefaultlocale()[0]
        if sys_locale:
            if sys_locale.startswith("zh_CN"):  # Linux/Mac usually use underscore
                return "zh-CN"
            elif sys_locale.startswith("zh_TW") or sys_locale.startswith("zh_HK"):
                return "zh-TW"
            elif sys_locale.startswith("ja"):
                return "ja-JP"
    except Exception as e:
        logger.debug(f"Failed to detect locale via python locale: {e}")

    return detected_locale


def detect_system_chrome_ua() -> str:
    """
    Attempt to detect the installed Chrome version on Windows and return a User-Agent string.
    Returns an empty string if detection fails.
    """
    if os.name != "nt":
        return ""

    paths = [
        r"Software\Google\Chrome\BLBeacon",
        r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Google Chrome",
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Google Chrome",
    ]

    version = None
    for path in paths:
        for root in [winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE]:
            try:
                key = winreg.OpenKey(root, path)
                try:
                    version, _ = winreg.QueryValueEx(key, "version")
                    if version:
                        break
                except FileNotFoundError:
                    pass
                try:
                    version, _ = winreg.QueryValueEx(key, "DisplayVersion")
                    if version:
                        break
                except FileNotFoundError:
                    pass
            except OSError:
                continue
        if version:
            break

    if version:
        # Construct a standard Chrome UA string based on the detected version
        # Assuming Windows 10/11 64-bit for simplicity
        return f"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{version} Safari/537.36"

    return ""


def get_default_settings_dict() -> dict:
    return {
        "log_level": "INFO",
        "locale": detect_system_locale(),
        "majsoul_url": "https://game.maj-soul.com/1/",
        "model": "mortal",
        "browser": {"enabled": True, "headless": False, "window_size": "", "user_agent": detect_system_chrome_ua()},
        "mitm": {"enabled": False, "host": "127.0.0.1", "port": 6789, "upstream": ""},
        "server": {"host": "0.0.0.0", "port": 8765},
        "model_config": {
            "device": "auto",
            "enable_amp": False,
            "enable_quick_eval": False,
            "rule_based_agari_guard": True,
            "ot": {"online": False, "server": "http://127.0.0.1:5000", "api_key": "<YOUR_API_KEY>"},
        },
    }


def get_settings_dict() -> dict:
    """
    Read settings.json from project_root/config/settings.json
    """
    with open(SETTINGS_JSON_PATH, encoding="utf-8") as f:
        return json.load(f)


def verify_settings(data: dict) -> bool:
    """
    Verify a settings payload against schema (schema is loaded from SCHEMA_PATH)
    """
    try:
        jsonschema.validate(data, _get_schema())
        return True
    except ValidationError as e:
        logger.error(f"Settings validation error: {e.message}")
        return False


def _load_settings() -> Settings:
    """
    Load settings from project_root/config/settings.json and validate them against
    akagi_ng/settings/settings.schema.json

    Runtime behavior:
    - Only checks if schema file exists (SCHEMA_PATH).
    - Reads settings.json from CONFIG_DIR.
    - If settings.json is corrupted, backs it up and recreates a default one under CONFIG_DIR.

    Raises:
        FileNotFoundError: schema not found
        jsonschema.exceptions.ValidationError: settings.json does not match schema
    """
    # Only validate schema file existence (and load it)
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
    """
    Get the schema for settings.json (from akagi_ng/settings/settings.schema.json)

    Returns:
        dict: Schema for settings.json
    """
    if not SCHEMA_PATH.exists():
        raise FileNotFoundError(f"settings.schema.json not found at {SCHEMA_PATH}")
    with open(SCHEMA_PATH, encoding="utf-8") as f:
        return json.load(f)


def _update_settings(settings: Settings, data: dict) -> None:
    """
    Update settings object from a dictionary

    Args:
        settings (Settings): Settings object to update
        data (dict): Dictionary with settings to update
    """
    settings.log_level = data.get("log_level", "INFO")
    settings.locale = data.get("locale", "zh-CN")
    settings.majsoul_url = data["majsoul_url"]
    settings.model = data["model"]

    browser_data = data.get("browser", {})
    settings.browser.enabled = browser_data.get("enabled", True)
    settings.browser.headless = browser_data.get("headless", False)
    settings.browser.window_size = browser_data.get("window_size", "")
    settings.browser.user_agent = browser_data.get("user_agent", "")

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
    """
    Save settings.json to project_root/config/settings.json
    """
    with open(SETTINGS_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)


def _backup_and_reset_settings(reason: str) -> dict:
    """
    Backup the current settings file and recreate it with default values.

    Args:
        reason (str): The reason for resetting settings (e.g. corruption error message)

    Returns:
        dict: The new default settings dictionary
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
