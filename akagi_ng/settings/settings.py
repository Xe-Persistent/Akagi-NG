import json
import os
import shutil
from dataclasses import dataclass
from pathlib import Path

import jsonschema
from jsonschema.exceptions import ValidationError

from core.context import ensure_dir, get_settings_dir, get_assets_dir
from .logger import logger

CONFIG_DIR: Path = ensure_dir(get_settings_dir())
SETTINGS_JSON_PATH: Path = CONFIG_DIR / "settings.json"
SETTINGS_EXAMPLE_PATH: Path = CONFIG_DIR / "settings.example.json"

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
    rule_based_agari_guard: bool
    ot: OTConfig


@dataclass
class Settings:
    log_level: str
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
        self.log_level = data.get("log_level", "INFO")
        self.majsoul_url = data["majsoul_url"]
        self.model = data["model"]

        self.browser.headless = data["browser"]["headless"]
        self.browser.channel = data["browser"]["channel"]
        self.browser.window_size = data["browser"].get("window_size", "")

        self.server.host = data["server"]["host"]
        self.server.port = data["server"]["port"]

        self.model_config.device = data["model_config"]["device"]
        self.model_config.enable_amp = data["model_config"]["enable_amp"]
        self.model_config.rule_based_agari_guard = data["model_config"]["rule_based_agari_guard"]

        ot_data = data["model_config"]["ot"]
        self.model_config.ot.online = ot_data["online"]
        if ot_data["online"]:
            self.model_config.ot.server = ot_data["server"]
            self.model_config.ot.api_key = ot_data["api_key"]
        else:
            # Maybe clear them or keep them? Keeping them is fine, or set to empty if missing.
            self.model_config.ot.server = ot_data.get("server", "")
            self.model_config.ot.api_key = ot_data.get("api_key", "")

    def save(self) -> None:
        """
        Save the settings to the settings.json file (project_root/config/settings.json)
        """
        with open(SETTINGS_JSON_PATH, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "majsoul_url": self.majsoul_url,
                    "model": self.model,
                    "browser": {
                        "headless": self.browser.headless,
                        "channel": self.browser.channel,
                        "window_size": self.browser.window_size
                    },
                    "server": {
                        "host": self.server.host,
                        "port": self.server.port
                    },
                    "model_config": {
                        "device": self.model_config.device,
                        "enable_amp": self.model_config.enable_amp,
                        "rule_based_agari_guard": self.model_config.rule_based_agari_guard,
                        "ot": {
                            "online": self.model_config.ot.online,
                            "server": self.model_config.ot.server,
                            "api_key": self.model_config.ot.api_key,
                        }
                    },
                },
                f,
                indent=4,
                ensure_ascii=False,
            )
        logger.info(f"Saved settings to {SETTINGS_JSON_PATH}")


def _default_settings_dict() -> dict:
    return {
        "log_level": "INFO",
        "majsoul_url": "https://game.maj-soul.com/1/",
        "model": "mortal",
        "browser": {
            "headless": False,
            "channel": "chrome",
            "window_size": ""
        },
        "server": {
            "host": "0.0.0.0",
            "port": 8765
        },
        "model_config": {
            "device": "auto",
            "enable_amp": False,
            "rule_based_agari_guard": True,
            "ot": {
                "online": False,
                "server": "http://127.0.0.1:5000",
                "api_key": "<YOUR_API_KEY>"
            }
        },
    }


def get_schema() -> dict:
    """
    Get the schema for settings.json (from akagi_ng/settings/settings.schema.json)

    Returns:
        dict: Schema for settings.json
    """
    if not SCHEMA_PATH.exists():
        raise FileNotFoundError(f"settings.schema.json not found at {SCHEMA_PATH}")
    with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def load_settings() -> Settings:
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
    schema = get_schema()

    if not SETTINGS_JSON_PATH.exists():
        if SETTINGS_EXAMPLE_PATH.exists():
            logger.warning(f"{SETTINGS_JSON_PATH} not found. Creating from {SETTINGS_EXAMPLE_PATH}.")
            shutil.copy2(SETTINGS_EXAMPLE_PATH, SETTINGS_JSON_PATH)
        else:
            logger.warning(
                f"{SETTINGS_JSON_PATH} not found and {SETTINGS_EXAMPLE_PATH} is missing. "
                f"Creating a default {SETTINGS_JSON_PATH}."
            )
            with open(SETTINGS_JSON_PATH, "w", encoding="utf-8") as f:
                json.dump(_default_settings_dict(), f, indent=4, ensure_ascii=False)

    try:
        with open(SETTINGS_JSON_PATH, "r", encoding="utf-8") as f:
            loaded_settings = json.load(f)
    except json.JSONDecodeError as e:
        logger.error(f"settings.json corrupted: {e}")
        bak_path = SETTINGS_JSON_PATH.with_suffix(".json.bak")
        logger.warning(f"Backup settings.json to {bak_path}")
        os.replace(SETTINGS_JSON_PATH, bak_path)

        logger.warning("Creating new settings.json with default values")
        with open(SETTINGS_JSON_PATH, "w", encoding="utf-8") as f:
            json.dump(_default_settings_dict(), f, indent=4, ensure_ascii=False)

        with open(SETTINGS_JSON_PATH, "r", encoding="utf-8") as f:
            loaded_settings = json.load(f)

    try:
        jsonschema.validate(loaded_settings, schema)
    except ValidationError as e:
        logger.error(f"settings.json validation failed: {e.message}")
        bak_path = SETTINGS_JSON_PATH.with_suffix(".json.bak")
        logger.warning(f"Backup settings.json to {bak_path}")
        os.replace(SETTINGS_JSON_PATH, bak_path)

        logger.warning("Creating new settings.json with default values")
        with open(SETTINGS_JSON_PATH, "w", encoding="utf-8") as f:
            json.dump(_default_settings_dict(), f, indent=4, ensure_ascii=False)

        with open(SETTINGS_JSON_PATH, "r", encoding="utf-8") as f:
            loaded_settings = json.load(f)

    return Settings(
        log_level=loaded_settings.get("log_level", "INFO"),
        majsoul_url=loaded_settings["majsoul_url"],
        model=loaded_settings["model"],
        browser=BrowserConfig(
            headless=loaded_settings["browser"]["headless"],
            channel=loaded_settings["browser"]["channel"],
            window_size=loaded_settings["browser"].get("window_size", "")
        ),
        server=ServerConfig(
            host=loaded_settings["server"]["host"],
            port=loaded_settings["server"]["port"]
        ),
        model_config=ModelConfig(
            device=loaded_settings["model_config"]["device"],
            enable_amp=loaded_settings["model_config"]["enable_amp"],
            rule_based_agari_guard=loaded_settings["model_config"]["rule_based_agari_guard"],
            ot=OTConfig(
                online=loaded_settings["model_config"]["ot"]["online"],
                server=loaded_settings["model_config"]["ot"].get("server", ""),
                api_key=loaded_settings["model_config"]["ot"].get("api_key", "")
            )
        ),
    )


def get_settings_dict() -> dict:
    """
    Read settings.json from project_root/config/settings.json
    """
    with open(SETTINGS_JSON_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def save_settings(data: dict) -> None:
    """
    Save settings.json to project_root/config/settings.json
    """
    with open(SETTINGS_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)


def verify_settings(data: dict) -> bool:
    """
    Verify a settings payload against schema (schema is loaded from SCHEMA_PATH)
    """
    try:
        jsonschema.validate(data, get_schema())
        return True
    except ValidationError as e:
        logger.error(f"Settings validation error: {e.message}")
        return False


local_settings: Settings = load_settings()
