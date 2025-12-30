import json
import os
import shutil
from dataclasses import dataclass
from pathlib import Path

import jsonschema
from jsonschema.exceptions import ValidationError

from core.context import ensure_dir, get_settings_dir
from .logger import logger

# Runtime-writable config directory (project_root/config)
CONFIG_DIR: Path = ensure_dir(get_settings_dir())
SETTINGS_JSON_PATH: Path = CONFIG_DIR / "settings.json"
SETTINGS_EXAMPLE_PATH: Path = CONFIG_DIR / "settings.example.json"

# Schema stays with the code (akagi_ng/settings/settings.schema.json)
SCHEMA_PATH: Path = Path(__file__).resolve().parent / "settings.schema.json"


@dataclass
class OTConfig:
    server: str
    online: bool
    api_key: str


@dataclass
class Settings:
    majsoul_url: str
    model: str
    ot: OTConfig

    def update(self, settings: dict) -> None:
        """
        Update settings from a dictionary

        Args:
            settings (dict): Dictionary with settings to update
        """
        self.majsoul_url = settings["majsoul_url"]
        self.model = settings["model"]
        self.ot.server = settings["ot_server"]["server"]
        self.ot.online = settings["ot_server"]["online"]
        self.ot.api_key = settings["ot_server"]["api_key"]

    def save(self) -> None:
        """
        Save the settings to the settings.json file (project_root/config/settings.json)
        """
        with open(SETTINGS_JSON_PATH, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "majsoul_url": self.majsoul_url,
                    "model": self.model,
                    "ot_server": {
                        "server": self.ot.server,
                        "online": self.ot.online,
                        "api_key": self.ot.api_key,
                    },
                },
                f,
                indent=4,
                ensure_ascii=False,
            )
        logger.info(f"Saved settings to {SETTINGS_JSON_PATH}")


def _default_settings_dict() -> dict:
    return {
        "majsoul_url": "https://game.maj-soul.com/1/",
        "model": "mortal",
        "ot_server": {
            "server": "http://127.0.0.1:5000",
            "online": False,
            "api_key": "<YOUR_API_KEY>",
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
    - Only checks that schema file exists (SCHEMA_PATH).
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

    jsonschema.validate(loaded_settings, schema)

    return Settings(
        majsoul_url=loaded_settings["majsoul_url"],
        model=loaded_settings["model"],
        ot=OTConfig(
            server=loaded_settings["ot_server"]["server"],
            online=loaded_settings["ot_server"]["online"],
            api_key=loaded_settings["ot_server"]["api_key"],
        ),
    )


def get_settings() -> dict:
    """
    Read settings.json from project_root/config/settings.json
    """
    with open(SETTINGS_JSON_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def save_settings(settings: dict) -> None:
    """
    Save settings.json to project_root/config/settings.json
    """
    with open(SETTINGS_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(settings, f, indent=4, ensure_ascii=False)


def verify_settings(settings: dict) -> bool:
    """
    Verify a settings payload against schema (schema is loaded from SCHEMA_PATH)
    """
    try:
        jsonschema.validate(settings, get_schema())
        return True
    except ValidationError as e:
        logger.error(f"Settings validation error: {e.message}")
        return False


settings: Settings = load_settings()
