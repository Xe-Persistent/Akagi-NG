import json
from enum import Enum
from typing import Self

from akagi_ng.bridge.amatsuki.consts import (
    BAKAZE_TO_MJAI_PAI,
    ID_TO_MJAI_PAI,
    AmatsukiAction,
    AmatsukiTopic,
)
from akagi_ng.bridge.base import BaseBridge
from akagi_ng.bridge.logger import logger


class STOMPFrame(Enum):
    CONNECT = "CONNECT"
    CONNECTED = "CONNECTED"
    SEND = "SEND"
    SUBSCRIBE = "SUBSCRIBE"
    UNSUBSCRIBE = "UNSUBSCRIBE"
    MESSAGE = "MESSAGE"


class STOMP:
    def __init__(self) -> None:
        self.frame: STOMPFrame | None = None
        self.destination: str | None = None
        self.content_length: int = 0
        self.content_type: str | None = None
        self.subscription: str | None = None
        self.message_id: str | None = None
        self.content: str | None = None

    def parse(self, content: bytes) -> Self:
        """解析内容并返回 STOMP 对象。

        Args:
            content (bytes): 待解析的内容。

        Returns:
            STOMP: STOMP 对象。
        """
        # 将字节转换为字符串
        content_str = content.decode("utf-8")
        logger.debug(f"{content_str}")
        # 按换行符分割
        content_lines = content_str.split("\n")
        # 解析帧
        self.frame = STOMPFrame(content_lines[0])
        # 解析头
        headers = content_lines[1:-1]
        for header in headers:
            if ":" not in header:
                continue
            key, value = header.split(":", 1)
            if key == "destination":
                self.destination = value
            elif key == "content-length":
                self.content_length = int(value)
            elif key == "content-type":
                self.content_type = value
            elif key == "subscription":
                self.subscription = value
            elif key == "message-id":
                self.message_id = value
            else:
                logger.debug(f"Unknown header: {key}")

        # 解析内容
        self.content = content_lines[-1] if content_lines else ""
        # 如果末尾是空字符则去除
        if self.content.endswith("\x00"):
            self.content = self.content[:-1]
        return self

    def content_dict(self) -> dict | None:
        """以字典形式返回内容。

        如果内容是 JSON，将转换为字典。
        否则返回 None。

        Returns:
            dict: 内容字典。
        """
        try:
            if self.content:
                self.content.strip()
                return json.loads(self.content)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse JSON: {self.content}, Error: {e}")
            return None
        return None


class AmatsukiBridge(BaseBridge):
    def __init__(self) -> None:
        super().__init__()
        # 流程是否有效
        # 当此流程为四人日麻游戏流程时为 True
        self.valid_flow: bool = False
        # 桌号
        self.desk_id: str | None = None
        # 游戏是否开始
        # 决定是否发送 "start_game" MJAI 指令
        self.game_started: bool = False
        # 座位号
        # 首局：东: 0, 南: 1, 西: 2, 北: 3
        self.seat: int | None = None
        # 临时开局指令
        # 因为宝牌指示牌在开局消息之后收到
        # 用于在收到宝牌指示牌之前临时存储 temp_start_round 指令
        self.temp_start_round: dict | None = None
        # 临时立直接受指令
        # 确认无人吃碰后生成立直接受指令
        self.temp_reach_accepted: dict | None = None
        # 当前宝牌数量
        # 收到宝牌指示牌时增加
        self.current_dora_count: int = 1
        # 最后打出的牌
        # 有人吃碰杠时使用
        self.last_discard_actor: int | None = None
        self.last_discard: str | None = None
        # 是否三人麻将
        # 用于检查游戏是否为三人麻将
        self.is_3p: bool = False

        self.handlers = {
            AmatsukiTopic.JOIN_DESK_CALLBACK: self._handle_join_desk_callback,
        }
        self.prefix_handlers = [
            (AmatsukiTopic.ROUND_START_PREFIX, self._handle_round_start),
            (AmatsukiTopic.SYNC_DORA_PREFIX, self._handle_sync_dora),
            (AmatsukiTopic.DRAW_PREFIX, self._handle_draw),
            (AmatsukiTopic.TEHAI_ACTION_PREFIX, self._handle_tehai_action),
            (AmatsukiTopic.RIVER_ACTION_PREFIX, self._handle_river_action),
            (AmatsukiTopic.RON_ACTION_PREFIX, self._handle_ron_action),
            (AmatsukiTopic.RYUKYOKU_ACTION_PREFIX, self._handle_ryukyoku_action),
            (AmatsukiTopic.GAME_END_PREFIX, self._handle_game_end),
        ]

    def parse(self, content: bytes) -> None | list[dict]:
        """解析内容并返回 MJAI 指令。

        Args:
            content (bytes): 待解析的内容。

        Returns:
            None | list[dict]: MJAI 指令。
        """
        try:
            stomp = STOMP().parse(content)
            if stomp.frame == STOMPFrame.MESSAGE:
                logger.debug(f"Destination: {stomp.destination}")

                if handler := self.handlers.get(stomp.destination):
                    return handler(stomp)

                for prefix, handler in self.prefix_handlers:
                    if stomp.destination.startswith(prefix):
                        return handler(stomp)

            return None
        except Exception as e:
            logger.error(f"Failed to parse: {e} at {e.__traceback__.tb_lineno}")
            return None

    def _handle_join_desk_callback(self, stomp: STOMP) -> None:  # noqa: PLR0911
        content_dict = stomp.content_dict()
        if not self._validate_content(content_dict, stomp):
            return
        if any(
                key not in content_dict
                for key in [
                    "status",
                    "errorCode",
                    "gameType",
                    "gameMode",
                    "roomType",
                    "currentPlayerCount",
                    "maxCount",
                ]
        ):
            logger.error(f"Invalid content: {stomp.content}")
            return
        if content_dict["status"] != 0:
            logger.warning(f"status: {content_dict['status']}")
            return
        if content_dict["errorCode"] != 0:
            logger.warning(f"errorCode: {content_dict['errorCode']}")
            return
        if content_dict["gameType"] != 0:  # 0: Japanese Mahjong
            logger.warning(f"Unsupported gameType: {content_dict['gameType']}")
            return
        if content_dict["gameMode"] == 0:  # 0: 4P, 1: 3P
            self.is_3p = False
        elif content_dict["gameMode"] == 1:  # 0: 4P, 1: 3P
            self.is_3p = True
        else:
            logger.warning(f"Unsupported gameMode: {content_dict['gameMode']}")
            return
        self.valid_flow = True
        self.desk_id = content_dict["deskId"]
        return

    def _parse_tehais(self, player_tiles: list[dict]) -> list[list[str]]:
        tehais = []
        for idx, player_tile in enumerate(player_tiles):
            tehai: list[str] = []
            if any(key not in player_tile for key in ["haiRiver", "tehai"]):
                logger.error("Invalid content: missing keys in player_tile")
                return []
            if any(key not in player_tile["tehai"] for key in ["hand", "kitaArea", "lockArea"]):
                logger.error("Invalid content: missing keys in player_tile['tehai']")
                return []
            if player_tile["tehai"]["hand"][0]["id"] == -1:
                tehai = ["?"] * 13
                tehais.append(tehai)
                continue
            self.seat = idx
            for tile in player_tile["tehai"]["hand"]:
                tehai.append(ID_TO_MJAI_PAI[tile["id"]])
            tehais.append(tehai)
        return tehais

    def _validate_round_start(self, stomp: STOMP) -> dict | None:
        if not self.valid_flow:
            return None
        content_dict = stomp.content_dict()
        if not self._validate_content(content_dict, stomp):
            return None
        if any(
                key not in content_dict for key in
                ["bakaze", "honba", "isAllLast", "oya", "playerPoints", "playerTiles"]
        ):
            logger.error(f"Invalid content: {stomp.content}")
            return None
        return content_dict

    def _handle_round_start(self, stomp: STOMP) -> list[dict] | None:
        if not (content_dict := self._validate_round_start(stomp)):
            return None

        bakaze: int = content_dict["bakaze"]
        honba: int = content_dict["honba"]
        oya: int = content_dict["oya"]
        player_points: list[int] = content_dict["playerPoints"]
        if self.is_3p:
            player_points.append(0)

        tehais = self._parse_tehais(content_dict["playerTiles"])
        if not tehais:
            return None

        if self.is_3p:
            tehais.append(["?"] * 13)
        if self.seat is None:
            logger.error("Seat not found")
            return None

        self.current_dora_count = 1
        self.last_discard_actor = None
        self.last_discard = None

        command = {
            "type": "start_kyoku",
            "bakaze": BAKAZE_TO_MJAI_PAI[bakaze],
            "dora_marker": None,
            "kyoku": oya + 1,
            "honba": honba,
            "kyotaku": None,
            "oya": oya,
            "scores": player_points,
            "tehais": tehais,
        }
        self.temp_start_round = command
        if not self.game_started:
            self.game_started = True
            return [{"type": "start_game", "id": self.seat}]
        return None

    def _handle_sync_dora(self, stomp: STOMP) -> list[dict] | None:
        if not self.valid_flow:
            return None
        content_dict = stomp.content_dict()
        if not self._validate_content(content_dict, stomp):
            return None
        if any(key not in content_dict for key in ["dora", "honba", "reachCount"]):
            logger.error(f"Invalid content: {stomp.content}")
            return None

        if self.temp_start_round:
            temp_start_round = self.temp_start_round
            self.temp_start_round = None
            dora_hai = ID_TO_MJAI_PAI[content_dict["dora"][0]["id"]]
            temp_start_round["dora_marker"] = dora_hai
            temp_start_round["kyotaku"] = content_dict["reachCount"]
            return [temp_start_round]

        if len(content_dict["dora"]) > self.current_dora_count:
            dora_hai = ID_TO_MJAI_PAI[content_dict["dora"][-1]["id"]]
            self.current_dora_count = len(content_dict["dora"])
            return [{"type": "dora", "dora_marker": dora_hai}]
        return None

    def _handle_draw(self, stomp: STOMP) -> list[dict] | None:
        if not self.valid_flow:
            return None
        content_dict = stomp.content_dict()
        if not self._validate_content(content_dict, stomp):
            return None
        if any(key not in content_dict for key in ["hai", "position"]):
            logger.error(f"Invalid content: {stomp.content}")
            return None

        actor: int = content_dict["position"]
        pai: str = "?"
        if content_dict["position"] == self.seat:
            pai = ID_TO_MJAI_PAI[content_dict["hai"]["id"]]

        ret = []
        if self.temp_reach_accepted:
            ret.append(self.temp_reach_accepted)
            self.temp_reach_accepted = None
        ret.append({"type": "tsumo", "actor": actor, "pai": pai})
        return ret

    def _build_dahai(self, content_dict: dict, actor: int) -> list[dict]:
        pai = ID_TO_MJAI_PAI[content_dict["haiList"][0]["id"]]
        tsumogiri = content_dict["isKiri"]
        self.last_discard_actor = actor
        self.last_discard = pai
        return [{"type": "dahai", "actor": actor, "pai": pai, "tsumogiri": tsumogiri}]

    def _build_ankan(self, content_dict: dict, actor: int) -> list[dict]:
        consumed = [ID_TO_MJAI_PAI[tile["id"]] for tile in content_dict["haiList"]]
        return [{"type": "ankan", "actor": actor, "consumed": consumed}]

    def _build_kakan(self, content_dict: dict, actor: int) -> list[dict]:
        pai = ID_TO_MJAI_PAI[content_dict["haiList"][0]["id"]]
        consumed = []
        if pai in ["5m", "5p", "5s"]:
            consumed = [pai] * 3
            consumed[0] += "r"
        elif pai in ["5mr", "5pr", "5sr"]:
            consumed = [pai[:-1]] * 3
        else:
            consumed = [pai] * 3
        return [{"type": "kakan", "actor": actor, "pai": pai, "consumed": consumed}]

    def _build_reach(self, content_dict: dict, actor: int) -> list[dict]:
        pai = ID_TO_MJAI_PAI[content_dict["haiList"][0]["id"]]
        tsumogiri = content_dict["isKiri"]
        self.temp_reach_accepted = {"type": "reach_accepted", "actor": actor}
        self.last_discard_actor = actor
        return [
            {"type": "reach", "actor": actor},
            {"type": "dahai", "actor": actor, "pai": pai, "tsumogiri": tsumogiri},
        ]

    def _build_wreach(self, content_dict: dict, actor: int) -> list[dict]:
        pai = ID_TO_MJAI_PAI[content_dict["haiList"][0]["id"]]
        self.temp_reach_accepted = {"type": "reach_accepted", "actor": actor}
        self.last_discard_actor = actor
        return [
            {"type": "reach", "actor": actor},
            {"type": "dahai", "actor": actor, "pai": pai, "tsumogiri": True},
        ]

    def _build_kita(self, content_dict: dict, actor: int) -> list[dict]:
        assert self.is_3p, "nukidora is only available in 3P"
        pai = ID_TO_MJAI_PAI[content_dict["haiList"][0]["id"]]
        return [{"type": "nukidora", "actor": actor, "pai": pai}]

    def _handle_tehai_action(self, stomp: STOMP) -> list[dict] | None:
        if not self.valid_flow:
            return None
        content_dict = stomp.content_dict()
        if not self._validate_content(content_dict, stomp):
            return None
        if any(key not in content_dict for key in ["action", "haiList", "isKiri", "isReachDisplay", "position"]):
            logger.error(f"Invalid content: {stomp.content}")
            return None

        action = content_dict["action"]
        actor: int = content_dict["position"]

        handlers = {
            AmatsukiAction.KIRI: self._build_dahai,
            AmatsukiAction.ANKAN: self._build_ankan,
            AmatsukiAction.KAKAN: self._build_kakan,
            AmatsukiAction.REACH: self._build_reach,
            AmatsukiAction.WREACH: self._build_wreach,
            AmatsukiAction.KITA: self._build_kita,
        }

        if handler := handlers.get(action):
            return handler(content_dict, actor)

        return None

    def _handle_river_action(self, stomp: STOMP) -> list[dict] | None:
        if not self.valid_flow:
            return None
        content_dict = stomp.content_dict()
        if not self._validate_content(content_dict, stomp):
            return None
        if any(key not in content_dict for key in ["action", "menzu", "position"]):
            logger.error(f"Invalid content: {stomp.content}")
            return None

        action = content_dict["action"]
        actor: int = content_dict["position"]
        target: int = self.last_discard_actor
        pai: str = self.last_discard

        # Helper to extract consumed tiles
        consumed: list[str] = []
        skip_pai = True
        for tile in content_dict["menzu"]["menzuList"]:
            tile_pai = ID_TO_MJAI_PAI[tile["id"]]
            if skip_pai and tile_pai == self.last_discard:
                skip_pai = False
                continue
            consumed.append(tile_pai)

        ret = []
        if self.temp_reach_accepted:
            ret.append(self.temp_reach_accepted)
            self.temp_reach_accepted = None

        type_map = {
            AmatsukiAction.CHII: "chi",
            AmatsukiAction.PON: "pon",
            AmatsukiAction.MINKAN: "daiminkan",
        }

        if type_str := type_map.get(action):
            ret.append(
                {
                    "type": type_str,
                    "actor": actor,
                    "target": target,
                    "pai": pai,
                    "consumed": consumed,
                }
            )
            return ret

        return None

    def _handle_ron_action(self, stomp: STOMP) -> list[dict] | None:
        if not self.valid_flow:
            return None
        content_dict = stomp.content_dict()
        if not self._validate_content(content_dict, stomp):
            return None
        if any(key not in content_dict for key in ["agariInfo", "increaseAndDecrease", "isTsumo"]):
            logger.error(f"Invalid content: {stomp.content}")
            return None
        if self.temp_reach_accepted:
            self.temp_reach_accepted = None
        return [{"type": "end_kyoku"}]

    def _handle_ryukyoku_action(self, stomp: STOMP) -> list[dict] | None:
        if not self.valid_flow:
            return None
        content_dict = stomp.content_dict()
        if not self._validate_content(content_dict, stomp):
            return None
        if self.temp_reach_accepted:
            self.temp_reach_accepted = None
        return [{"type": "end_kyoku"}]

    def _handle_game_end(self, stomp: STOMP) -> list[dict] | None:
        if not self.valid_flow:
            return None
        content_dict = stomp.content_dict()
        if not self._validate_content(content_dict, stomp):
            return None
        if self.temp_reach_accepted:
            self.temp_reach_accepted = None
        return [{"type": "end_game"}]

    def _validate_content(self, content_dict: dict | None, stomp: STOMP) -> bool:
        if not content_dict:
            logger.error(f"Invalid content: {stomp.content}")
            return False
        return True

    def build(self, command: dict) -> None | bytes:
        pass
