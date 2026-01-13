import json
from enum import Enum
from typing import Self

from akagi_ng.bridge.amatsuki.misc import BAKAZE_TO_MJAI_PAI, ID_TO_MJAI_PAI
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
    def __init__(self):
        self.frame: STOMPFrame = None
        self.destination: str = None
        self.content_length: int = 0
        self.content_type: str = None
        self.subscription: str = None
        self.message_id: str = None
        self.content: str = None

    def parse(self, content: bytes) -> Self:
        """Parses the content and returns STOMP object.

        Args:
            content (bytes): Content to be parsed.

        Returns:
            STOMP: STOMP object.
        """
        # Convert bytes to string
        content_str = content.decode("utf-8")
        logger.debug(f"{content_str}")
        # Split by newline
        content_lines = content_str.split("\n")
        # Parse frame
        self.frame = STOMPFrame(content_lines[0])
        # Parse headers
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

        # Parse content
        self.content = content_lines[-1] if content_lines else ""
        # Strip the last character at the end if it's null
        if self.content.endswith("\x00"):
            self.content = self.content[:-1]
        return self

    def content_dict(self) -> dict:
        """Returns content as dictionary.

        If the content is JSON, it will be converted to dictionary.
        Else, returns None.

        Returns:
            dict: Content as dictionary.
        """
        try:
            self.content.strip()
            return json.loads(self.content)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse JSON: {self.content}, Error: {e}")
            return None
        return None


class AmatsukiBridge(BaseBridge):
    def __init__(self):
        super().__init__()
        # Whether the flow is valid or not
        # True when this flow is a 4P Japanese mahjong game flow
        self.valid_flow: bool = False
        # Desk ID
        self.desk_id: str = None
        # Whether the game has started or not
        # This decides whether to send "start_game" mjai command or not
        self.game_started: bool = False
        # Seat number
        # for first round:
        #   E: 0, S: 1, W: 2, N: 3
        self.seat: int = None
        # temp start round command
        # Because the dora indicator is received after the round start message
        # This is used to store the temp_start_round command temporarily
        # until the dora indicator is received
        self.temp_start_round: dict = None
        # temp reach accepted command
        # reach accepted command is made after confirming that no one has pon chi
        self.temp_reach_accepted: dict = None
        # Current dora count
        # When the dora indicator is received, this will be incremented
        self.current_dora_count: int = 1
        # Last Discard
        # Used when someone chi pon kan
        self.last_discard_actor: int = None
        self.last_discard: str = None
        # Is Three Player
        # This is used to check if the game is 3P or not
        self.is_3p: bool = False
        pass

    def parse(self, content: bytes) -> None | list[dict]:
        """Parses the content and returns MJAI command.

        Args:
            content (bytes): Content to be parsed.

        Returns:
            None | list[dict]: MJAI command.
        """
        try:
            stomp = STOMP().parse(content)
            match stomp.frame:
                case STOMPFrame.CONNECT:
                    pass
                case STOMPFrame.CONNECTED:
                    pass
                case STOMPFrame.SUBSCRIBE:
                    if stomp.destination == "/user/topic/callback/joinDesk":
                        # Current websocket flow is a game flow
                        pass
                    pass
                case STOMPFrame.UNSUBSCRIBE:
                    pass
                case STOMPFrame.SEND:
                    pass
                case STOMPFrame.MESSAGE:
                    logger.debug(f"Destination: {stomp.destination}")
                    if stomp.destination == "/user/topic/callback/joinDesk":
                        content_dict = stomp.content_dict()
                        if not content_dict:
                            logger.error(f"Invalid content: {stomp.content}")
                            return None
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
                            return None
                        if content_dict["status"] != 0:
                            logger.warning(f"status: {content_dict['status']}")
                            return None
                        if content_dict["errorCode"] != 0:
                            logger.warning(f"errorCode: {content_dict['errorCode']}")
                            return None
                        if content_dict["gameType"] != 0:  # 0: Japanese Mahjong
                            logger.warning(f"Unsupported gameType: {content_dict['gameType']}")
                            return None
                        if content_dict["gameMode"] == 0:  # 0: 4P, 1: 3P
                            self.is_3p = False
                        elif content_dict["gameMode"] == 1:  # 0: 4P, 1: 3P
                            self.is_3p = True
                        else:
                            logger.warning(f"Unsupported gameMode: {content_dict['gameMode']}")
                            return None
                        # if content_dict["gameMode"] != 0: # 0: 4P, 1: 3P
                        #     logger.warning(f"Unsupported gameMode: {content_dict['gameMode']}")
                        #     return None
                        # if content_dict["maxCount"] != 4: # 4: 4P, 3: 3P
                        #     logger.warning(f"Unsupported maxCount(playerCount): {content_dict['maxCount']}")
                        #     return None
                        self.valid_flow = True
                        self.desk_id = content_dict["deskId"]
                        return None
                    # ============================================================== #
                    #                         Round Start                            #
                    # ============================================================== #
                    if stomp.destination.startswith("/user/topic/desk/roundStart/"):
                        if not self.valid_flow:
                            return None
                        content_dict = stomp.content_dict()
                        if any(
                            key not in content_dict
                            for key in ["bakaze", "honba", "isAllLast", "oya", "playerPoints", "playerTiles"]
                        ):
                            logger.error(f"Invalid content: {stomp.content}")
                            return None
                        bakaze: int = content_dict["bakaze"]
                        honba: int = content_dict["honba"]
                        is_all_last: bool = content_dict["isAllLast"]
                        oya: int = content_dict["oya"]
                        player_points: list[int] = content_dict["playerPoints"]
                        if self.is_3p:
                            player_points.append(0)
                        tehais: list[list[str]] = []
                        for idx, player_tile in enumerate(content_dict["playerTiles"]):
                            tehai: list[str] = []
                            if any(key not in player_tile for key in ["haiRiver", "tehai"]):
                                logger.error(f"Invalid content: {stomp.content}")
                                return None
                            if any(key not in player_tile["tehai"] for key in ["hand", "kitaArea", "lockArea"]):
                                logger.error(f"Invalid content: {stomp.content}")
                                return None
                            if player_tile["tehai"]["hand"][0]["id"] == -1:
                                # Unknown tile, this means it's not my hand
                                tehai = ["?"] * 13
                                tehais.append(tehai)
                                continue
                            self.seat = idx
                            for tile in player_tile["tehai"]["hand"]:
                                tehai.append(ID_TO_MJAI_PAI[tile["id"]])
                            tehais.append(tehai)
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
                            "dora_marker": None,  # dora indicator, will be set later
                            "kyoku": oya + 1,
                            "honba": honba,
                            "kyotaku": None,  # will be set later, with the dora indicator
                            "oya": oya,
                            "scores": player_points,
                            "tehais": tehais,
                        }
                        self.temp_start_round = command
                        if not self.game_started:  # send start_game command
                            self.game_started = True
                            return [
                                {
                                    "type": "start_game",
                                    "id": self.seat,
                                }
                            ]
                        return None
                    # ============================================================== #
                    #                             Dora                               #
                    # ============================================================== #
                    if stomp.destination.startswith("/topic/desk/syncDora/"):
                        if not self.valid_flow:
                            return None
                        content_dict = stomp.content_dict()
                        if not content_dict:
                            logger.error(f"Invalid content: {stomp.content}")
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
                    # ============================================================== #
                    #                             Tsumo                              #
                    # ============================================================== #
                    if stomp.destination.startswith("/user/topic/desk/draw/"):
                        if not self.valid_flow:
                            return None
                        content_dict = stomp.content_dict()
                        if not content_dict:
                            logger.error(f"Invalid content: {stomp.content}")
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
                    # ============================================================== #
                    #                         Tehai Action                           #
                    # ============================================================== #
                    if stomp.destination.startswith("/topic/desk/tehaiAction/"):
                        if not self.valid_flow:
                            return None
                        content_dict = stomp.content_dict()
                        if not content_dict:
                            logger.error(f"Invalid content: {stomp.content}")
                            return None
                        if any(
                            key not in content_dict
                            for key in ["action", "haiList", "isKiri", "isReachDisplay", "position"]
                        ):
                            logger.error(f"Invalid content: {stomp.content}")
                            return None
                        # ============================================================== #
                        #                            Dahai                               #
                        # ============================================================== #
                        if content_dict["action"] == "KIRI":
                            actor: int = content_dict["position"]
                            pai: str = ID_TO_MJAI_PAI[content_dict["haiList"][0]["id"]]
                            tsumogiri: bool = content_dict["isKiri"]
                            self.last_discard_actor = actor
                            self.last_discard = pai
                            return [{"type": "dahai", "actor": actor, "pai": pai, "tsumogiri": tsumogiri}]
                        # ============================================================== #
                        #                            Ankan                               #
                        # ============================================================== #
                        if content_dict["action"] == "ANNKAN":
                            actor: int = content_dict["position"]
                            consumed: list[str] = []
                            for tile in content_dict["haiList"]:
                                consumed.append(ID_TO_MJAI_PAI[tile["id"]])
                            return [{"type": "ankan", "actor": actor, "consumed": consumed}]
                        # ============================================================== #
                        #                            Kakan                               #
                        # ============================================================== #
                        if content_dict["action"] == "KAKAN":
                            actor: int = content_dict["position"]
                            pai: str = ID_TO_MJAI_PAI[content_dict["haiList"][0]["id"]]
                            consumed: list[str] = []
                            if pai in ["5m", "5p", "5s"]:
                                consumed = [pai] * 3
                                consumed[0] += "r"
                            elif pai in ["5mr", "5pr", "5sr"]:
                                consumed = [pai[:-1]] * 3
                            else:
                                consumed = [pai] * 3
                            return [{"type": "kakan", "actor": actor, "pai": pai, "consumed": consumed}]
                        # ============================================================== #
                        #                            Reach                               #
                        # ============================================================== #
                        if content_dict["action"] == "REACH":
                            actor: int = content_dict["position"]
                            pai: str = ID_TO_MJAI_PAI[content_dict["haiList"][0]["id"]]
                            tsumogiri: bool = content_dict["isKiri"]
                            self.temp_reach_accepted = {"type": "reach_accepted", "actor": actor}
                            self.last_discard_actor = actor
                            return [
                                {"type": "reach", "actor": actor},
                                {"type": "dahai", "actor": actor, "pai": pai, "tsumogiri": tsumogiri},
                            ]
                        # ============================================================== #
                        #                           WReach                               #
                        # ============================================================== #
                        if content_dict["action"] == "WREACH":
                            actor: int = content_dict["position"]
                            pai: str = ID_TO_MJAI_PAI[content_dict["haiList"][0]["id"]]
                            self.temp_reach_accepted = {"type": "reach_accepted", "actor": actor}
                            self.last_discard_actor = actor
                            return [
                                {"type": "reach", "actor": actor},
                                {"type": "dahai", "actor": actor, "pai": pai, "tsumogiri": True},
                            ]
                        # ============================================================== #
                        #                          NukiDora                              #
                        # ============================================================== #
                        if content_dict["action"] == "KITA":
                            assert self.is_3p, "nukidora is only available in 3P"
                            actor: int = content_dict["position"]
                            pai: str = ID_TO_MJAI_PAI[content_dict["haiList"][0]["id"]]
                            return [{"type": "nukidora", "actor": actor, "pai": pai}]
                    # ============================================================== #
                    #                         River Action                           #
                    # ============================================================== #
                    if stomp.destination.startswith("/topic/desk/riverAction/"):
                        if not self.valid_flow:
                            return None
                        content_dict = stomp.content_dict()
                        if not content_dict:
                            logger.error(f"Invalid content: {stomp.content}")
                            return None
                        if any(key not in content_dict for key in ["action", "menzu", "position"]):
                            logger.error(f"Invalid content: {stomp.content}")
                            return None
                        # ============================================================== #
                        #                            Chi                                 #
                        # ============================================================== #
                        if content_dict["action"] == "CHII":
                            skip_pai: bool = True
                            actor: int = content_dict["position"]
                            target: int = self.last_discard_actor
                            pai: str = self.last_discard
                            consumed: list[str] = []
                            for tile in content_dict["menzu"]["menzuList"]:
                                pai = ID_TO_MJAI_PAI[tile["id"]]
                                if skip_pai and pai == self.last_discard:
                                    skip_pai = False
                                    continue
                                consumed.append(pai)
                            ret = []
                            if self.temp_reach_accepted:
                                ret.append(self.temp_reach_accepted)
                                self.temp_reach_accepted = None
                            ret.append(
                                {"type": "chi", "actor": actor, "target": target, "pai": pai, "consumed": consumed}
                            )
                            return ret
                        # ============================================================== #
                        #                            Pon                                 #
                        # ============================================================== #
                        if content_dict["action"] == "PON":
                            skip_pai: bool = True
                            actor: int = content_dict["position"]
                            target: int = self.last_discard_actor
                            pai: str = self.last_discard
                            consumed: list[str] = []
                            for tile in content_dict["menzu"]["menzuList"]:
                                pai = ID_TO_MJAI_PAI[tile["id"]]
                                if skip_pai and pai == self.last_discard:
                                    skip_pai = False
                                    continue
                                consumed.append(pai)
                            ret = []
                            if self.temp_reach_accepted:
                                ret.append(self.temp_reach_accepted)
                                self.temp_reach_accepted = None
                            ret.append(
                                {"type": "pon", "actor": actor, "target": target, "pai": pai, "consumed": consumed}
                            )
                            return ret
                        # ============================================================== #
                        #                          Daiminkan                             #
                        # ============================================================== #
                        if content_dict["action"] == "MINKAN":
                            skip_pai: bool = True
                            actor: int = content_dict["position"]
                            target: int = self.last_discard_actor
                            pai: str = self.last_discard
                            consumed: list[str] = []
                            for tile in content_dict["menzu"]["menzuList"]:
                                pai = ID_TO_MJAI_PAI[tile["id"]]
                                if skip_pai and pai == self.last_discard:
                                    skip_pai = False
                                    continue
                                consumed.append(pai)
                            ret = []
                            if self.temp_reach_accepted:
                                ret.append(self.temp_reach_accepted)
                                self.temp_reach_accepted = None
                            ret.append(
                                {
                                    "type": "daiminkan",
                                    "actor": actor,
                                    "target": target,
                                    "pai": pai,
                                    "consumed": consumed,
                                }
                            )
                            return ret
                    # ============================================================== #
                    #                              Ron                               #
                    # ============================================================== #
                    if stomp.destination.startswith("/topic/desk/ronAction/"):
                        if not self.valid_flow:
                            return None
                        content_dict = stomp.content_dict()
                        if not content_dict:
                            logger.error(f"Invalid content: {stomp.content}")
                            return None
                        if any(key not in content_dict for key in ["agariInfo", "increaseAndDecrease", "isTsumo"]):
                            logger.error(f"Invalid content: {stomp.content}")
                            return None
                        if self.temp_reach_accepted:
                            self.temp_reach_accepted = None
                        return [{"type": "end_kyoku"}]  # Ron
                    # ============================================================== #
                    #                            Ryuukyoku                           #
                    # ============================================================== #
                    if stomp.destination.startswith("/topic/desk/ryuukyokuAction/"):
                        if not self.valid_flow:
                            return None
                        content_dict = stomp.content_dict()
                        if not content_dict:
                            logger.error(f"Invalid content: {stomp.content}")
                            return None
                        if any(key not in content_dict for key in []):
                            logger.error(f"Invalid content: {stomp.content}")
                            return None
                        if self.temp_reach_accepted:
                            self.temp_reach_accepted = None
                        return [{"type": "end_kyoku"}]
                    # ============================================================== #
                    #                          Game End                              #
                    # ============================================================== #
                    if stomp.destination.startswith("/user/topic/desk/gameEnd/"):
                        if not self.valid_flow:
                            return None
                        content_dict = stomp.content_dict()
                        if not content_dict:
                            logger.error(f"Invalid content: {stomp.content}")
                            return None
                        if any(key not in content_dict for key in []):
                            logger.error(f"Invalid content: {stomp.content}")
                            return None
                        if self.temp_reach_accepted:
                            self.temp_reach_accepted = None
                        return [
                            {
                                "type": "end_game",
                            }
                        ]
                    pass
                case _:
                    pass
            return None
        except Exception as e:
            logger.error(f"Failed to parse: {e} at {e.__traceback__.tb_lineno}")
            return None

    def build(self, command: dict) -> None | bytes:
        pass
