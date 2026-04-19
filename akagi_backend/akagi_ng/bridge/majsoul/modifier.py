import copy
import json
import random
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import TypedDict

import requests

from akagi_ng.bridge.logger import logger
from akagi_ng.bridge.majsoul.catalog_proto import config_pb2, sheets_pb2
from akagi_ng.bridge.majsoul.liqi import LiqiProto, MsgType
from akagi_ng.core.paths import ensure_dir, get_settings_dir

CONFIG_DIR = ensure_dir(get_settings_dir())
MOD_RESOURCE_DIR = ensure_dir(CONFIG_DIR / "majsoul_mod")
LEGACY_MOD_SETTINGS_PATH = MOD_RESOURCE_DIR / "settings.json"
MOD_SETTINGS_PATH = CONFIG_DIR / "settings.mod.json"
RESOURCE_PATH = MOD_RESOURCE_DIR / "lqc.lqbin"
DEFAULT_CHARACTER_ID = 200001
DEFAULT_SKIN_ID = 400101
ANNOUNCEMENT_ID = 666666

type JsonScalar = None | bool | int | float | str
type JsonValue = JsonScalar | JsonDict | JsonList
type JsonDict = dict[str, JsonValue]
type JsonList = list[JsonValue]


class RandomCharacterEntry(TypedDict):
    character_id: int
    skin_id: int


class RandomCharacterConfig(TypedDict):
    enabled: bool
    pool: list[RandomCharacterEntry]


class SavedView(TypedDict, total=False):
    slot: int
    item_id: int
    itemId: int
    type: int
    item_id_list: list[int]
    itemIdList: list[int]


class ResolvedView(TypedDict, total=False):
    slot: int
    item_id: int
    type: int


class ModConfig(TypedDict):
    character: int
    characters: dict[str, int]
    nickname: str
    star_chars: list[int]
    bianjietishi: bool
    title: int
    loading_image: list[int]
    emoji: bool
    views: dict[str, list[SavedView]]
    views_index: int
    show_server: bool
    verified: int
    anti_replace_nickname: bool
    random_character: RandomCharacterConfig
    safe_mode: bool


class ModResource(TypedDict):
    auto_update: bool
    lqc_lqbin_version: str


class ModSettings(TypedDict):
    enabled: bool
    config: ModConfig
    resource: ModResource


class CharacterPayload(TypedDict, total=False):
    charid: int
    charId: int
    exp: int
    is_upgraded: bool
    isUpgraded: bool
    level: int
    rewarded_level: list[int]
    rewardedLevel: list[int]
    skin: int
    extra_emoji: list[int]
    extraEmoji: list[int]
    views: list[ResolvedView]


class PlayerPayload(TypedDict, total=False):
    account_id: int
    accountId: int
    avatar_id: int
    avatarId: int
    avatar_frame: int
    avatarFrame: int
    nickname: str
    title: int
    verified: int
    character: CharacterPayload
    views: list[ResolvedView]


class RoomState(TypedDict):
    owner_id: int
    robot_count: int
    persons: list[PlayerPayload]
    robots: list[PlayerPayload]
    positions: JsonList
    seq: int


@dataclass(slots=True)
class PacketMutation:
    content: bytes | None = None
    drop: bool = False
    injected_messages: list[bytes] = field(default_factory=list)


@dataclass(slots=True)
class ModCatalog:
    characters: list[int] = field(default_factory=list)
    skins: list[int] = field(default_factory=list)
    titles: list[int] = field(default_factory=list)
    items: list[int] = field(default_factory=list)
    views: list[int] = field(default_factory=list)
    loading_images: list[int] = field(default_factory=list)
    emoji: dict[int, list[int]] = field(default_factory=dict)
    endings: list[int] = field(default_factory=list)


@dataclass(slots=True)
class ModifierState:
    contract: str = ""
    account_id: int | None = None
    nickname: str = ""
    title: int = 0
    loading_image: list[int] = field(default_factory=list)
    main_character_id: int = DEFAULT_CHARACTER_ID
    characters: list[CharacterPayload] = field(default_factory=list)
    room_state: RoomState | None = None

    def __getitem__(self, key: str) -> object:
        return getattr(self, key)

    def __setitem__(self, key: str, value: object) -> None:
        setattr(self, key, value)

    def get(self, key: str, default: object = None) -> object:
        return getattr(self, key, default)


def get_default_mod_settings_dict() -> ModSettings:
    return {
        "enabled": True,
        "config": {
            "character": DEFAULT_CHARACTER_ID,
            "characters": {},
            "nickname": "",
            "star_chars": [],
            "bianjietishi": True,
            "title": 0,
            "loading_image": [],
            "emoji": False,
            "views": {str(i): [] for i in range(10)},
            "views_index": 0,
            "show_server": True,
            "verified": 0,
            "anti_replace_nickname": True,
            "random_character": {"enabled": False, "pool": []},
            "safe_mode": False,
        },
        "resource": {"auto_update": True, "lqc_lqbin_version": ""},
    }


def _deep_merge(base: JsonDict, update: JsonDict) -> JsonDict:
    for key, value in update.items():
        nested_base = value_to_dict(base.get(key))
        nested_update = value_to_dict(value)
        if nested_base is not None and nested_update is not None:
            _deep_merge(nested_base, nested_update)
        else:
            base[key] = value
    return base


def value_to_dict(value: object) -> JsonDict | None:
    return value if isinstance(value, dict) else None


def value_to_list(value: object) -> JsonList | None:
    return value if isinstance(value, list) else None


def iter_dict_items(value: object) -> Iterator[JsonDict]:
    items = value_to_list(value)
    if items is None:
        return
    for item in items:
        item_dict = value_to_dict(item)
        if item_dict is not None:
            yield item_dict


def _resolve_mod_settings_source_path() -> Path | None:
    if MOD_SETTINGS_PATH.exists():
        return MOD_SETTINGS_PATH
    if LEGACY_MOD_SETTINGS_PATH.exists():
        return LEGACY_MOD_SETTINGS_PATH
    return None


def load_mod_settings_dict() -> ModSettings:
    defaults = get_default_mod_settings_dict()
    source_path = _resolve_mod_settings_source_path()
    if source_path is not None:
        try:
            loaded = json.loads(source_path.read_text(encoding="utf-8"))
            loaded_dict = value_to_dict(loaded)
            if loaded_dict is not None:
                _deep_merge(defaults, loaded_dict)
                if source_path == LEGACY_MOD_SETTINGS_PATH and not MOD_SETTINGS_PATH.exists():
                    save_mod_settings_dict(defaults)
        except Exception as exc:
            logger.warning(f"[MajsoulMod] Failed to load {source_path.name}: {exc}")
    return defaults


def save_mod_settings_dict(settings: ModSettings) -> None:
    ensure_dir(MOD_SETTINGS_PATH.parent)
    MOD_SETTINGS_PATH.write_text(
        json.dumps(settings, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def verify_mod_settings_dict(data: object) -> bool:
    if not isinstance(data, dict):
        return False
    if "enabled" in data and not isinstance(data["enabled"], bool):
        return False
    if "config" in data and not isinstance(data["config"], dict):
        return False
    return "resource" not in data or isinstance(data["resource"], dict)


class MajsoulModifier:
    def __init__(self) -> None:
        self.safe = ModifierState()
        self.settings = self._load_settings()
        self.catalog = ModCatalog()
        self.catalog_loaded = False
        self._logged_catalog_status = False
        self._logged_methods: set[str] = set()

    def _pick_key(self, data: JsonDict, snake: str, camel: str) -> str:
        if camel in data and snake not in data:
            return camel
        return snake

    def _pick_related_key(self, data: JsonDict, snake: str, camel: str, *, prefer_camel_if: str | None = None) -> str:
        if camel in data and snake not in data:
            return camel
        if prefer_camel_if and prefer_camel_if in data and snake not in data:
            return camel
        return snake

    def _get_value(self, data: JsonDict, snake: str, camel: str, default: object = None) -> object:
        if snake in data:
            return data[snake]
        if camel in data:
            return data[camel]
        return default

    def _get_dict(self, data: JsonDict, snake: str, camel: str) -> JsonDict | None:
        value = self._get_value(data, snake, camel)
        return value_to_dict(value)

    def _get_list(self, data: JsonDict, snake: str, camel: str) -> JsonList:
        value = self._get_value(data, snake, camel, [])
        return value_to_list(value) or []

    def _get_int(self, data: JsonDict, snake: str, camel: str, default: int = 0) -> int:
        value = self._get_value(data, snake, camel, default)
        return int(value) if isinstance(value, int | str) else default

    def _get_config(self) -> ModConfig:
        return self.settings["config"]

    def is_enabled(self) -> bool:
        return bool(self.settings["enabled"])

    def process(
        self, liqi_message: dict, *, from_client: bool, raw_content: bytes, liqi_proto: LiqiProto
    ) -> PacketMutation:
        if not self.is_enabled() or not liqi_message:
            return PacketMutation()
        if not self.catalog_loaded:
            self._refresh_catalog()
            self.catalog_loaded = True

        msg_type = liqi_message.get("type")
        method = liqi_message.get("method")
        data = liqi_message.get("data")
        msg_id = liqi_message.get("id", -1)

        if not isinstance(method, str) or not isinstance(data, dict):
            return PacketMutation()

        if (
            not from_client
            and msg_type == MsgType.Res
            and (method.startswith(".lq.Lobby.") or method.startswith(".lq.FastTest."))
            and method not in self._logged_methods
        ):
            self._logged_methods.add(method)
            logger.info(f"[MajsoulMod] Observed response method: {method}")

        if msg_type == MsgType.Notify:
            return self._handle_notify(method, data, liqi_proto)
        if msg_type == MsgType.Req and from_client:
            return self._handle_request(method, data, msg_id, liqi_proto)
        if msg_type == MsgType.Res and not from_client:
            return self._handle_response(method, data, msg_id, liqi_proto)
        return PacketMutation()

    def _load_settings(self) -> ModSettings:
        defaults = load_mod_settings_dict()
        self._save_settings(defaults)
        return defaults

    def _save_settings(self, settings: ModSettings | None = None) -> None:
        save_mod_settings_dict(settings or self.settings)

    def _refresh_catalog(self) -> None:
        try:
            if RESOURCE_PATH.exists():
                self.catalog = self._load_catalog(RESOURCE_PATH.read_bytes())
                self._ensure_character_skin_mapping(self.catalog.characters)
                self._save_settings()
                self._log_catalog_status("local")
                return

            if self.settings["resource"]["auto_update"]:
                self._update_resource()
                if RESOURCE_PATH.exists():
                    self.catalog = self._load_catalog(RESOURCE_PATH.read_bytes())
                    self._ensure_character_skin_mapping(self.catalog.characters)
                    self._save_settings()
                    self._log_catalog_status("downloaded")
        except Exception as exc:
            logger.warning(f"[MajsoulMod] Failed to refresh lqc catalog: {exc}")

    def _log_catalog_status(self, source: str) -> None:
        if self._logged_catalog_status:
            return
        self._logged_catalog_status = True
        logger.info(
            f"[MajsoulMod] Catalog loaded from {source}: "
            f"characters={len(self.catalog.characters)} "
            f"skins={len(self.catalog.skins)} "
            f"views={len(self.catalog.views)} "
            f"titles={len(self.catalog.titles)} "
            f"endings={len(self.catalog.endings)}"
        )

    def _update_resource(self) -> None:
        version_resp = requests.get("https://game.maj-soul.com/1/version.json", timeout=10)
        version_resp.raise_for_status()
        version = version_resp.json()["version"]

        resversion_resp = requests.get(f"https://game.maj-soul.com/1/resversion{version}.json", timeout=10)
        resversion_resp.raise_for_status()
        prefix = resversion_resp.json()["res"]["res/config/lqc.lqbin"]["prefix"]

        if RESOURCE_PATH.exists() and self.settings["resource"]["lqc_lqbin_version"] == prefix:
            return

        resource_resp = requests.get(f"https://game.maj-soul.com/1/{prefix}/res/config/lqc.lqbin", timeout=20)
        resource_resp.raise_for_status()
        RESOURCE_PATH.write_bytes(resource_resp.content)
        self.settings["resource"]["lqc_lqbin_version"] = prefix

    def _load_catalog(self, content: bytes) -> ModCatalog:
        tables = config_pb2.ConfigTables()
        tables.ParseFromString(content)
        catalog = ModCatalog()

        for sheet in tables.datas:
            class_name = "".join(part.capitalize() for part in f"{sheet.table}_{sheet.sheet}".split("_"))
            pb_cls = getattr(sheets_pb2, class_name, None)
            if pb_cls is None:
                continue

            for item in sheet.data:
                message = pb_cls()
                try:
                    message.ParseFromString(item)
                except Exception:
                    continue

                match class_name:
                    case "ItemDefinitionCharacter":
                        catalog.characters.append(message.id)
                    case "ItemDefinitionSkin":
                        catalog.skins.append(message.id)
                    case "ItemDefinitionTitle":
                        catalog.titles.append(message.id)
                    case "ItemDefinitionItem":
                        if message.category == 5:
                            catalog.items.append(message.id)
                        elif message.category == 8 and message.id not in catalog.loading_images:
                            catalog.loading_images.append(message.id)
                    case "ItemDefinitionView":
                        catalog.views.append(message.id)
                    case "ItemDefinitionLoadingImage":
                        if message.id not in catalog.loading_images:
                            catalog.loading_images.append(message.id)
                    case "CharacterEmoji":
                        catalog.emoji.setdefault(message.charid, []).append(message.sub_id)
                    case "SpotRewards":
                        catalog.endings.append(message.id)

        return catalog

    def _handle_notify(self, method: str, data: JsonDict, liqi_proto: LiqiProto) -> PacketMutation:
        match method:
            case ".lq.NotifyAccountUpdate":
                update = data.get("update", {})
                character_update = self._get_value(update, "character", "character")
                if isinstance(character_update, dict):
                    self._patch_character_update(character_update)
                    main_character = self._get_value(update, "main_character", "mainCharacter", {})
                    if main_character:
                        character_key = self._pick_key(main_character, "character_id", "characterId")
                        main_character[character_key] = self.settings["config"]["character"]
                        main_character[self._pick_key(main_character, "skin_id", "skinId")] = self._get_character_skin(
                            self.settings["config"]["character"]
                        )
                    return self._rebuild_notify(method, data, liqi_proto)
            case ".lq.NotifyRoomPlayerUpdate":
                for player in data.get("player_list", []):
                    self._apply_player_mods(
                        player,
                        own_account=self._get_int(player, "account_id", "accountId") == self.safe.account_id,
                    )
                for robot in data.get("robots", []):
                    self._upgrade_character(self._get_value(robot, "character", "character", {}))
                    if self.settings["config"]["safe_mode"]:
                        self._force_safe_mode(robot)
                self._cache_room_state_from_update(data)
                return self._rebuild_notify(method, data, liqi_proto)
            case ".lq.NotifyGameFinishRewardV2":
                main_character = data.get("main_character", {})
                main_character["add"] = 0
                main_character["exp"] = 0
                main_character["level"] = 5
                return self._rebuild_notify(method, data, liqi_proto)
            case ".lq.NotifyCustomContestSystemMsg":
                if self.settings["config"]["show_server"]:
                    for player in data.get("game_start", {}).get("players", []):
                        self._prefix_server(player)
                    return self._rebuild_notify(method, data, liqi_proto)
        return PacketMutation()

    def _handle_request(self, method: str, data: JsonDict, msg_id: int, liqi_proto: LiqiProto) -> PacketMutation:
        config = self.settings["config"]
        fake = False
        injects: list[bytes] = []
        drop = False

        match method:
            case ".lq.Lobby.changeMainCharacter":
                char_id = int(self._get_value(data, "character_id", "characterId"))
                config["character"] = char_id
                fake = True
                injects.append(
                    self._build_character_update_notify(char_id, self._get_character_skin(char_id), liqi_proto)
                )
            case ".lq.Lobby.changeCharacterSkin":
                char_id = int(self._get_value(data, "character_id", "characterId"))
                skin_id = int(self._get_value(data, "skin", "skin"))
                config["characters"][str(char_id)] = skin_id
                fake = True
                injects.append(self._build_character_update_notify(char_id, skin_id, liqi_proto))
            case ".lq.Lobby.addFinishedEnding":
                drop = True
            case ".lq.Lobby.updateCharacterSort":
                config["star_chars"] = [int(v) for v in data.get("sort", [])]
                fake = True
            case ".lq.Lobby.useTitle":
                config["title"] = int(data["title"])
                fake = True
            case ".lq.Lobby.setLoadingImage":
                config["loading_image"] = [int(v) for v in data.get("images", [])]
                fake = True
            case ".lq.Lobby.saveCommonViews":
                for view in data.get("views", []):
                    if view.get("type") == 0:
                        view.pop("item_id_list", None)
                        view.pop("itemIdList", None)
                    elif view.get("type") == 1:
                        view.pop("item_id", None)
                        view.pop("itemId", None)
                save_index = str(data.get("save_index", 0))
                config["views"][save_index] = data.get("views", [])
                if data.get("is_use"):
                    config["views_index"] = int(data.get("save_index", 0))
                fake = True
            case ".lq.Lobby.useCommonView":
                config["views_index"] = int(data.get("index", 0))
                fake = True
            case ".lq.Lobby.loginBeat":
                self.safe.contract = str(data.get("contract", ""))
            case ".lq.FastTest.authGame":
                self.safe.account_id = self._get_int(data, "account_id", "accountId", 0)
            case ".lq.Lobby.readAnnouncement":
                if int(data.get("announcement_id", 0)) == ANNOUNCEMENT_ID:
                    fake = True
            case ".lq.Lobby.receiveCharacterRewards":
                fake = True
            case ".lq.Lobby.setRandomCharacter":
                config["random_character"] = {
                    "enabled": bool(data.get("enabled", False)),
                    "pool": data.get("pool", []),
                }
                fake = True

        if drop:
            self._save_settings()
            liqi_proto.drop_pending_response(msg_id)
            return PacketMutation(drop=True)

        if fake:
            self._save_settings()
            room_update = self._build_room_player_update_notify(liqi_proto)
            if room_update is not None:
                injects.append(room_update)
            liqi_proto.set_pending_response(msg_id, ".lq.Lobby.loginBeat")
            payload = liqi_proto.build_packet(
                MsgType.Req,
                ".lq.Lobby.loginBeat",
                {"contract": self.safe.contract},
                msg_id=msg_id,
            )
            return PacketMutation(content=payload, injected_messages=injects)

        self._save_settings()
        return PacketMutation()

    def _handle_response(self, method: str, data: JsonDict, msg_id: int, liqi_proto: LiqiProto) -> PacketMutation:
        modify = False

        match method:
            case ".lq.Lobby.fetchCharacterInfo":
                self._patch_character_info(data)
                logger.info("[MajsoulMod] Patched .lq.Lobby.fetchCharacterInfo")
                modify = True
            case ".lq.Lobby.fetchAccountCharacterInfo":
                data["unlock_list"] = list(self.catalog.characters)
                logger.info(
                    f"[MajsoulMod] Patched .lq.Lobby.fetchAccountCharacterInfo unlock_list={len(data['unlock_list'])}"
                )
                modify = True
            case ".lq.Lobby.login" | ".lq.Lobby.oauth2Login":
                self._capture_login_state(data)
                self._patch_login_account(data.get("account", {}))
                modify = True
            case ".lq.Lobby.loginSuccess":
                if self._patch_composite_account_payload(data):
                    logger.info(f"[MajsoulMod] Patched .lq.Lobby.loginSuccess keys={sorted(data.keys())}")
                    modify = True
            case ".lq.Lobby.createRoom":
                self._patch_room_players(data.get("room", {}))
                modify = True
            case ".lq.Lobby.joinRoom":
                self._patch_room_players(data.get("room", {}))
                modify = True
            case ".lq.FastTest.authGame":
                if self.settings["config"]["bianjietishi"]:
                    game_config = data.get("game_config", {})
                    detail_rule = game_config.setdefault("mode", {}).setdefault("detail_rule", {})
                    detail_rule["bianjietishi"] = True
                    mode_id = game_config.get("meta", {}).get("mode_id")
                    game_config.get("meta", {})["mode_id"] = {15: 11, 16: 12, 25: 23, 26: 24}.get(mode_id, mode_id)
                for player in data.get("players", []):
                    self._apply_player_mods(
                        player,
                        own_account=self._get_int(player, "account_id", "accountId") == self.safe.account_id,
                        allow_random=True,
                    )
                for robot in data.get("robots", []):
                    self._upgrade_character(self._get_value(robot, "character", "character", {}))
                    if self.settings["config"]["safe_mode"]:
                        self._force_safe_mode(robot)
                logger.info(
                    f"[MajsoulMod] Patched .lq.FastTest.authGame players={len(data.get('players', []))} "
                    f"account_id={self.safe.account_id}"
                )
                modify = True
            case ".lq.FastTest.enterGame" | ".lq.FastTest.syncGame":
                if self._patch_game_restore(data):
                    logger.info(f"[MajsoulMod] Patched {method} game_restore")
                    modify = True
            case ".lq.Lobby.fetchAccountInfo":
                account = data.get("account", {})
                if self._get_int(account, "account_id", "accountId") == self.safe.account_id:
                    self._patch_login_account(account)
                    modify = True
            case ".lq.Lobby.fetchTitleList":
                data["title_list"] = list(self.catalog.titles)
                modify = True
            case ".lq.Lobby.fetchRoom":
                self._patch_room_players(data.get("room", {}))
                modify = True
            case ".lq.Lobby.fetchBagInfo":
                self._patch_bag(data.get("bag", {}))
                modify = True
            case ".lq.Lobby.fetchAllCommonViews":
                data["use"] = self._views_index()
                data["views"] = [
                    {"index": int(index), "values": values}
                    for index, values in self.settings["config"]["views"].items()
                ]
                modify = True
            case ".lq.Lobby.fetchAnnouncement":
                self._inject_announcement(data)
                modify = True
            case ".lq.Lobby.fetchInfo":
                if self._patch_composite_account_payload(data):
                    logger.info(f"[MajsoulMod] Patched .lq.Lobby.fetchInfo keys={sorted(data.keys())}")
                    modify = True
            case ".lq.Lobby.fetchAccountInfoExtra":
                if self._patch_composite_account_payload(data):
                    logger.info(f"[MajsoulMod] Patched .lq.Lobby.fetchAccountInfoExtra keys={sorted(data.keys())}")
                    modify = True
            case ".lq.Lobby.fetchServerSettings":
                if self.settings["config"]["anti_replace_nickname"]:
                    nickname_setting = data.get("settings", {}).setdefault("nickname_setting", {})
                    nickname_setting["enable"] = 0
                    nickname_setting["nicknames"] = []
                    modify = True
            case ".lq.Lobby.fetchGameRecord":
                for account in data.get("head", {}).get("accounts", []):
                    self._apply_player_mods(
                        account,
                        own_account=self._get_int(account, "account_id", "accountId") == self.safe.account_id,
                        allow_random=True,
                        character_field="character",
                        view_field="views",
                    )
                modify = True
            case ".lq.Lobby.fetchRandomCharacter":
                data.clear()
                data.update(self.settings["config"]["random_character"])
                modify = True

        if modify:
            self._save_settings()
            payload = liqi_proto.build_packet(MsgType.Res, method, data, msg_id=msg_id)
            return PacketMutation(content=payload)
        return PacketMutation()

    def _capture_login_state(self, data: JsonDict) -> None:
        self.safe.account_id = self._get_int(data, "account_id", "accountId", 0)
        account = value_to_dict(data.get("account")) or {}
        self.safe.nickname = str(account.get("nickname", ""))
        self.safe.title = int(account.get("title", 0))
        self.safe.loading_image = [int(image) for image in self._get_list(account, "loading_image", "loadingImage")]

    def _patch_character_info(self, character_info: JsonDict) -> None:
        main_character_key = self._pick_key(character_info, "main_character_id", "mainCharacterId")
        character_sort_key = self._pick_key(character_info, "character_sort", "characterSort")
        hidden_characters_key = self._pick_key(character_info, "hidden_characters", "hiddenCharacters")
        finished_endings_key = self._pick_key(character_info, "finished_endings", "finishedEndings")
        rewarded_endings_key = self._pick_key(character_info, "rewarded_endings", "rewardedEndings")

        self.safe.main_character_id = self._get_int(
            character_info, "main_character_id", "mainCharacterId", self.settings["config"]["character"]
        )
        self.safe.characters = self._extract_character_payloads(character_info.get("characters"))

        characters: list[CharacterPayload] = []
        for char_id in self.catalog.characters:
            skin_id = self._get_character_skin(char_id)
            character = {
                "charid": char_id,
                "exp": 0,
                "is_upgraded": True,
                "level": 5,
                "rewarded_level": [1, 2, 3, 4, 5],
                "skin": skin_id,
            }
            if self.settings["config"]["emoji"]:
                character["extra_emoji"] = self.catalog.emoji.get(char_id, [])
            characters.append(character)

        character_info["characters"] = characters
        character_info["skins"] = list(self.catalog.skins)
        character_info[main_character_key] = self.settings["config"]["character"]
        character_info[character_sort_key] = list(self.settings["config"]["star_chars"] or self.catalog.characters)
        character_info[hidden_characters_key] = []
        character_info[finished_endings_key] = list(self.catalog.endings)
        character_info[rewarded_endings_key] = list(self.catalog.endings)

    def _patch_composite_account_payload(self, data: JsonDict) -> bool:
        modified = False

        account = data.get("account")
        if isinstance(account, dict):
            self._patch_login_account(account)
            modified = True

        character_info = self._get_value(data, "character_info", "characterInfo")
        if isinstance(character_info, dict):
            self._patch_character_info(character_info)
            modified = True

        bag_info = self._get_value(data, "bag_info", "bagInfo")
        if isinstance(bag_info, dict):
            bag = bag_info.get("bag")
            if isinstance(bag, dict):
                self._patch_bag(bag)
                modified = True

        all_common_views_key = self._pick_key(data, "all_common_views", "allCommonViews")
        if all_common_views_key in data:
            data[all_common_views_key] = {
                "use": self._views_index(),
                "views": [
                    {"index": int(index), "values": values}
                    for index, values in self.settings["config"]["views"].items()
                ],
            }
            modified = True

        title_list_key = self._pick_key(data, "title_list", "titleList")
        if title_list_key in data:
            data[title_list_key] = {"title_list": list(self.catalog.titles)}
            modified = True

        random_character_key = self._pick_key(data, "random_character", "randomCharacter")
        if random_character_key in data:
            data[random_character_key] = self.settings["config"]["random_character"]
            modified = True

        unlock_list_key = self._pick_key(data, "unlock_list", "unlockList")
        if unlock_list_key in data:
            data[unlock_list_key] = list(self.catalog.characters)
            modified = True

        return modified

    def _patch_room_players(self, room: JsonDict) -> bool:
        if not isinstance(room, dict):
            return False

        modified = False
        for player in iter_dict_items(room.get("persons", [])):
            self._apply_player_mods(
                player,
                own_account=self._get_int(player, "account_id", "accountId") == self.safe.account_id,
            )
            modified = True

        for robot in iter_dict_items(room.get("robots", [])):
            character = self._get_dict(robot, "character", "character")
            if character is not None:
                self._upgrade_character(character)
            if self.settings["config"]["safe_mode"]:
                self._force_safe_mode(robot)
            modified = True

        self._cache_room_state_from_room(room)
        return modified

    def _patch_game_restore(self, data: JsonDict) -> bool:
        game_restore = data.get("game_restore")
        if not isinstance(game_restore, dict):
            return False

        snapshot = game_restore.get("snapshot")
        if not isinstance(snapshot, dict):
            return False

        modified = False
        for player in iter_dict_items(snapshot.get("account_views", [])):
            self._apply_player_mods(
                player,
                own_account=self._get_int(player, "account_id", "accountId") == self.safe.account_id,
                allow_random=True,
            )
            modified = True

        for robot in iter_dict_items(snapshot.get("robot_views", [])):
            character = self._get_dict(robot, "character", "character")
            if character is not None:
                self._upgrade_character(character)
            if self.settings["config"]["safe_mode"]:
                self._force_safe_mode(robot)
            modified = True

        return modified

    def _cache_room_state_from_room(self, room: JsonDict) -> None:
        if isinstance(room, dict):
            self.safe.room_state = self._clone_room_state(room)

    def _cache_room_state_from_update(self, update: JsonDict) -> None:
        if isinstance(update, dict):
            self.safe.room_state = {
                "owner_id": int(update.get("owner_id", 0)),
                "robot_count": int(update.get("robot_count", 0)),
                "persons": self._extract_player_payloads(update.get("player_list", [])),
                "robots": self._extract_player_payloads(update.get("robots", [])),
                "positions": copy.deepcopy(value_to_list(update.get("positions", [])) or []),
                "seq": int(update.get("seq", 0)),
            }

    def _build_room_player_update_notify(self, liqi_proto: LiqiProto) -> bytes | None:
        room_state = self.safe.room_state
        if room_state is None:
            return None

        room = copy.deepcopy(room_state)
        for player in room.get("persons", []):
            self._apply_player_mods(
                player,
                own_account=self._get_int(player, "account_id", "accountId") == self.safe.account_id,
            )
        for robot in room.get("robots", []):
            self._upgrade_character(self._get_value(robot, "character", "character", {}))
            if self.settings["config"]["safe_mode"]:
                self._force_safe_mode(robot)

        data = {
            "owner_id": room.get("owner_id", 0),
            "robot_count": room.get("robot_count", len(room.get("robots", []))),
            "player_list": room.get("persons", []),
            "seq": int(room.get("seq", 0)) + 1,
            "robots": room.get("robots", []),
            "positions": room.get("positions", []),
        }
        room["seq"] = data["seq"]
        self.safe.room_state = room
        return liqi_proto.build_packet(MsgType.Notify, ".lq.NotifyRoomPlayerUpdate", data)

    def _patch_login_account(self, account: JsonDict) -> None:
        config = self.settings["config"]
        account["avatar_id"] = self._get_character_skin(config["character"])
        frame = self._current_avatar_frame()
        if frame:
            account[self._pick_key(account, "avatar_frame", "avatarFrame")] = frame
        if config["nickname"]:
            account["nickname"] = config["nickname"]
        account["title"] = config["title"]
        account[self._pick_key(account, "loading_image", "loadingImage")] = list(config["loading_image"])
        account["verified"] = config["verified"]

    def _patch_character_update(self, character_update: JsonDict) -> None:
        character_info = {
            "characters": character_update.get("characters", []),
            "skins": character_update.get("skins", []),
            "main_character_id": self.settings["config"]["character"],
            "finished_endings": self._get_value(character_update, "finished_endings", "finishedEndings", []),
            "rewarded_endings": self._get_value(character_update, "rewarded_endings", "rewardedEndings", []),
            "character_sort": list(self.settings["config"]["star_chars"] or self.catalog.characters),
            "hidden_characters": [],
            "other_character_sort": [],
        }
        self._patch_character_info(character_info)
        character_update["characters"] = character_info["characters"]
        character_update["skins"] = character_info["skins"]
        character_update[self._pick_key(character_update, "finished_endings", "finishedEndings")] = character_info[
            "finished_endings"
        ]
        character_update[self._pick_key(character_update, "rewarded_endings", "rewardedEndings")] = character_info[
            "rewarded_endings"
        ]

    def _patch_bag(self, bag: JsonDict) -> None:
        existing_items = bag.get("items", [])
        unlocked_ids = set(self.catalog.items) | set(self.catalog.views) | set(self.catalog.loading_images)
        preserved = [item for item in existing_items if int(item.get("item_id", 0)) not in unlocked_ids]
        bag["items"] = preserved
        bag["items"].extend({"item_id": item_id, "stack": 1} for item_id in self.catalog.items)
        bag["items"].extend({"item_id": item_id, "stack": 1} for item_id in self.catalog.views)
        bag["items"].extend({"item_id": item_id, "stack": 1} for item_id in self.catalog.loading_images)

    def _inject_announcement(self, data: JsonDict) -> None:
        announcement = {
            "title": "Majsoul Mod Loaded",
            "id": ANNOUNCEMENT_ID,
            "headerImage": "internal://2.jpg",
            "content": (
                "<color=#f9963b>MajsoulMax mod behavior has been ported into Akagi-NG.</color>\n"
                "<b>This packet modifier is for research and learning use only.</b>\n"
                "<b>Use at your own risk.</b>"
            ),
        }
        announcements = data.setdefault("announcements", [])
        if not any(int(item.get("id", 0)) == ANNOUNCEMENT_ID for item in announcements):
            announcements.insert(0, announcement)

    def _apply_player_mods(
        self,
        player: JsonDict,
        *,
        own_account: bool,
        allow_random: bool = False,
        character_field: str = "character",
        view_field: str = "views",
    ) -> None:
        character_field = self._pick_key(player, character_field, "character")
        view_field = self._pick_key(player, view_field, "views")
        character = player.setdefault(character_field, {})
        self._upgrade_character(character)

        if own_account:
            char_id, skin_id = self._choose_character(allow_random=allow_random)
            character[self._pick_key(character, "charid", "charId")] = char_id
            character["skin"] = skin_id
            player[self._pick_key(player, "avatar_id", "avatarId")] = skin_id

            if self.settings["config"]["nickname"]:
                player["nickname"] = self.settings["config"]["nickname"]
            player["title"] = self.settings["config"]["title"]
            player["verified"] = self.settings["config"]["verified"]

            views = self._resolved_views()
            player[view_field] = copy.deepcopy(views)
            character[self._pick_key(character, "views", "views")] = copy.deepcopy(views)

            frame = self._current_avatar_frame(views)
            if frame:
                frame_key = self._pick_related_key(player, "avatar_frame", "avatarFrame", prefer_camel_if="avatarId")
                player[frame_key] = frame
        elif self.settings["config"]["safe_mode"]:
            self._force_safe_mode(player)

        if self.settings["config"]["show_server"]:
            self._prefix_server(player)

    def _upgrade_character(self, character: JsonDict) -> None:
        character["exp"] = 0
        character["level"] = 5
        character[self._pick_key(character, "is_upgraded", "isUpgraded")] = True
        character[self._pick_key(character, "rewarded_level", "rewardedLevel")] = [1, 2, 3, 4, 5]
        char_id = self._get_value(character, "charid", "charId")
        if self.settings["config"]["emoji"] and char_id is not None:
            character[self._pick_key(character, "extra_emoji", "extraEmoji")] = self.catalog.emoji.get(int(char_id), [])

    def _force_safe_mode(self, player: JsonDict) -> None:
        character_key = self._pick_key(player, "character", "character")
        character = player.setdefault(character_key, {})
        character[self._pick_key(character, "charid", "charId")] = DEFAULT_CHARACTER_ID
        character["skin"] = DEFAULT_SKIN_ID
        player[self._pick_key(player, "avatar_id", "avatarId")] = DEFAULT_SKIN_ID

    def _prefix_server(self, player: JsonDict) -> None:
        account_id = int(self._get_value(player, "account_id", "accountId", 0))
        nickname = player.get("nickname", "")
        prefix = self._get_zone_prefix(account_id)
        if nickname and not nickname.startswith(prefix):
            player["nickname"] = prefix + nickname

    def _build_character_update_notify(self, char_id: int, skin_id: int, liqi_proto: LiqiProto) -> bytes:
        data = {
            "update": {
                "character": {
                    "characters": [
                        {
                            "charid": char_id,
                            "skin": skin_id,
                            "exp": 0,
                            "is_upgraded": True,
                            "level": 5,
                            "rewarded_level": [1, 2, 3, 4, 5],
                            "extra_emoji": (
                                self.catalog.emoji.get(char_id, []) if self.settings["config"]["emoji"] else []
                            ),
                        }
                    ]
                }
            }
        }
        return liqi_proto.build_packet(MsgType.Notify, ".lq.NotifyAccountUpdate", data)

    def _rebuild_notify(self, method: str, data: JsonDict, liqi_proto: LiqiProto) -> PacketMutation:
        return PacketMutation(content=liqi_proto.build_packet(MsgType.Notify, method, data))

    def _ensure_character_skin_mapping(self, char_ids: list[int]) -> None:
        characters = self.settings["config"]["characters"]
        for char_id in char_ids:
            key = str(char_id)
            if key not in characters:
                characters[key] = self._default_skin_id(char_id)

    def _clone_room_state(self, room: JsonDict) -> RoomState:
        return {
            "owner_id": int(room.get("owner_id", 0)),
            "robot_count": int(room.get("robot_count", 0)),
            "persons": self._extract_player_payloads(room.get("persons", [])),
            "robots": self._extract_player_payloads(room.get("robots", [])),
            "positions": copy.deepcopy(value_to_list(room.get("positions", [])) or []),
            "seq": int(room.get("seq", 0)),
        }

    def _extract_character_payloads(self, value: object) -> list[CharacterPayload]:
        characters: list[CharacterPayload] = []
        for item in iter_dict_items(value):
            character = self._to_character_payload(item)
            if character is not None:
                characters.append(character)
        return characters

    def _extract_player_payloads(self, value: object) -> list[PlayerPayload]:
        players: list[PlayerPayload] = []
        for item in iter_dict_items(value):
            player = self._to_player_payload(item)
            if player is not None:
                players.append(player)
        return players

    def _to_character_payload(self, value: JsonDict) -> CharacterPayload | None:
        char_id = self._get_value(value, "charid", "charId")
        skin = value.get("skin")
        if not isinstance(char_id, int | str) or not isinstance(skin, int | str):
            return None

        payload: CharacterPayload = {
            "charid": int(char_id),
            "skin": int(skin),
            "exp": int(value.get("exp", 0)),
            "level": int(value.get("level", 0)),
            "is_upgraded": bool(self._get_value(value, "is_upgraded", "isUpgraded", False)),
            "rewarded_level": [int(level) for level in self._get_list(value, "rewarded_level", "rewardedLevel")],
        }
        extra_emoji = self._get_list(value, "extra_emoji", "extraEmoji")
        if extra_emoji:
            payload["extra_emoji"] = [int(item) for item in extra_emoji if isinstance(item, int | str)]
        views = self._extract_resolved_views(value.get("views", []))
        if views:
            payload["views"] = views
        return payload

    def _to_player_payload(self, value: JsonDict) -> PlayerPayload | None:
        account_id = self._get_value(value, "account_id", "accountId")
        if not isinstance(account_id, int | str):
            return None

        payload: PlayerPayload = {"account_id": int(account_id)}
        avatar_id = self._get_value(value, "avatar_id", "avatarId")
        if isinstance(avatar_id, int | str):
            payload["avatar_id"] = int(avatar_id)
        avatar_frame = self._get_value(value, "avatar_frame", "avatarFrame")
        if isinstance(avatar_frame, int | str):
            payload["avatar_frame"] = int(avatar_frame)
        nickname = value.get("nickname")
        if isinstance(nickname, str):
            payload["nickname"] = nickname
        title = value.get("title")
        if isinstance(title, int | str):
            payload["title"] = int(title)
        verified = value.get("verified")
        if isinstance(verified, int | str):
            payload["verified"] = int(verified)

        character = value_to_dict(value.get("character"))
        if character is not None:
            payload_character = self._to_character_payload(character)
            if payload_character is not None:
                payload["character"] = payload_character

        views = self._extract_resolved_views(value.get("views", []))
        if views:
            payload["views"] = views
        return payload

    def _extract_resolved_views(self, value: object) -> list[ResolvedView]:
        resolved_views: list[ResolvedView] = []
        for item in iter_dict_items(value):
            item_id = self._get_value(item, "item_id", "itemId")
            slot = item.get("slot")
            if not isinstance(item_id, int | str) or not isinstance(slot, int | str):
                continue
            payload: ResolvedView = {
                "slot": int(slot),
                "item_id": int(item_id),
            }
            item_type = item.get("type")
            if isinstance(item_type, int | str):
                payload["type"] = int(item_type)
            resolved_views.append(payload)
        return resolved_views

    def _get_character_skin(self, char_id: int) -> int:
        self._ensure_character_skin_mapping([char_id])
        return int(self.settings["config"]["characters"][str(char_id)])

    def _default_skin_id(self, char_id: int) -> int:
        return int(f"40{str(char_id)[4:]}01")

    def _views_index(self) -> int:
        return int(self.settings["config"]["views_index"])

    def _current_views(self) -> list[SavedView]:
        return self.settings["config"]["views"].get(str(self._views_index()), [])

    def _resolved_views(self) -> list[ResolvedView]:
        resolved: list[ResolvedView] = []
        for view in self._current_views():
            item_id = self._get_value(view, "item_id", "itemId")
            if view.get("type") == 1:
                item_ids = self._get_value(view, "item_id_list", "itemIdList", [])
                if item_ids:
                    item_id = random.choice(item_ids)
            payload = {"slot": view.get("slot", 0), "item_id": item_id}
            if view.get("type") == 1:
                payload["type"] = 1
            resolved.append(payload)
        return resolved

    def _current_avatar_frame(self, views: list[SavedView | ResolvedView] | None = None) -> int | None:
        for view in views or self._current_views():
            if int(view.get("slot", -1)) == 5:
                item_id = self._get_value(view, "item_id", "itemId")
                if item_id:
                    return int(item_id)
        return None

    def _choose_character(self, *, allow_random: bool) -> tuple[int, int]:
        random_cfg = self.settings["config"]["random_character"]
        if allow_random and random_cfg.get("enabled") and random_cfg.get("pool"):
            item = random.choice(random_cfg["pool"])
            return int(item["character_id"]), int(item["skin_id"])
        char_id = int(self.settings["config"]["character"])
        return char_id, self._get_character_skin(char_id)

    def _get_zone_prefix(self, account_id: int) -> str:
        zone = account_id >> 23
        if 0 <= zone <= 6:
            return "[CN]"
        if 7 <= zone <= 12:
            return "[JP]"
        if 13 <= zone <= 15:
            return "[EN]"
        return "[??]"
