import ctypes
import json
import locale
import os
from dataclasses import asdict, dataclass
from pathlib import Path

import jsonschema
from jsonschema.exceptions import ValidationError

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
    headless: bool
    channel: str
    window_size: str  # e.g. "1920,1080" or empty


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
    server: ServerConfig
    model_config: ModelConfig

    def update(self, data: dict) -> None:
        """
        Update settings from a dictionary

        Args:
            data (dict): Dictionary with settings to update
        """
        _update_settings(self, data)

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
        return cls(
            log_level=data.get("log_level", "INFO"),
            locale=data.get("locale", "zh-CN"),
            majsoul_url=data["majsoul_url"],
            model=data["model"],
            browser=BrowserConfig(
                headless=data["browser"]["headless"],
                channel=data["browser"]["channel"],
                window_size=data["browser"].get("window_size", ""),
            ),
            server=ServerConfig(host=data["server"]["host"], port=data["server"]["port"]),
            model_config=ModelConfig(
                device=data["model_config"]["device"],
                enable_amp=data["model_config"]["enable_amp"],
                enable_quick_eval=data["model_config"].get("enable_quick_eval", False),
                rule_based_agari_guard=data["model_config"]["rule_based_agari_guard"],
                ot=OTConfig(
                    online=data["model_config"]["ot"]["online"],
                    server=data["model_config"]["ot"].get("server", ""),
                    api_key=data["model_config"]["ot"].get("api_key", ""),
                ),
            ),
        )


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


def get_default_settings_dict() -> dict:
    return {
        "log_level": "INFO",
        "locale": detect_system_locale(),
        "majsoul_url": "https://game.maj-soul.com/1/",
        "model": "mortal",
        "browser": {"headless": False, "channel": "chrome", "window_size": ""},
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

    settings.browser.headless = data["browser"]["headless"]
    settings.browser.channel = data["browser"]["channel"]
    settings.browser.window_size = data["browser"].get("window_size", "")

    settings.server.host = data["server"]["host"]
    settings.server.port = data["server"]["port"]

    settings.model_config.device = data["model_config"]["device"]
    settings.model_config.enable_amp = data["model_config"]["enable_amp"]
    settings.model_config.enable_quick_eval = data["model_config"].get("enable_quick_eval", False)
    settings.model_config.rule_based_agari_guard = data["model_config"]["rule_based_agari_guard"]

    ot_data = data["model_config"]["ot"]
    settings.model_config.ot.online = ot_data["online"]
    if ot_data["online"]:
        settings.model_config.ot.server = ot_data["server"]
        settings.model_config.ot.api_key = ot_data["api_key"]
    else:
        # Maybe clear them or keep them? Keeping them is fine, or set to empty if missing.
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
