import json

from akagi_ng.bridge.base import BaseBridge
from akagi_ng.bridge.logger import logger
from akagi_ng.bridge.riichi_city.consts import CARD2MJAI


class RCMessage:
    def __init__(self, msg_id, msg_type, msg_data):
        self.msg_id: int = msg_id
        self.msg_type: int = msg_type
        self.msg_data: dict = msg_data

    def __str__(self):
        return f"Message: {self.msg_id} {self.msg_type} {self.msg_data}"


class GameStatus:
    def __init__(self):
        self.seat = -1
        self.tehai = []
        self.tsumo = None

        self.last_dahai_actor = -1

        self.player_list = []
        self.dora_markers = []
        self.accept_reach = None
        self.game_start = False
        self.shift = 0
        self.classify_id = None

        self.is_3p = False


class RiichiCityBridge(BaseBridge):
    def __init__(self):
        super().__init__()
        self.uid = -1
        self.game_status = GameStatus()

    def preprocess(self, content: bytes) -> RCMessage | None:
        """Preprocess the content and returns RCMessage.

        Args:
            content (bytes): Content to be preprocessed.

        Returns:
            RCMessage: RCMessage object.
        """
        # Convert first 4 byte to int
        msg_len = int.from_bytes(content[:4], byteorder="big")
        # Check if the message is complete
        if len(content) != msg_len:
            logger.warning(f"Message is not complete, expected {msg_len} bytes, got {len(content)} bytes")
            logger.warning(f"Message: {content.hex(' ')}")
            return
        # Check next 4 byte is 00 0f 00 01
        # Still don't know what this means.
        if content[4:8] != b"\x00\x0f\x00\x01":
            logger.warning("Message is unknown format, expected 00 0f 00 01")
            logger.warning(f"Message: {content.hex(' ')}")
            return
        # Convert next 4 byte to int
        msg_id = int.from_bytes(content[8:12], byteorder="big")
        # Convert next 2 byte to int
        msg_type = int.from_bytes(content[12:14], byteorder="big")
        # Check next 1 byte is 01
        # Still don't know what this means.
        if content[14] != 1:
            logger.warning("Message is unknown format, expected 01")
            logger.warning(f"Message: {content.hex(' ')}")
            return
        # Load json data from the rest of the message
        # if there are no data, it will be empty
        msg_data = {} if len(content) == 15 else json.loads(content[15:].decode("utf-8"))
        logger.debug({"msg_id": msg_id, "msg_type": msg_type, "msg_data": msg_data})

        return RCMessage(msg_id, msg_type, msg_data)

    def parse(self, content: bytes) -> None | list[dict]:
        """Parses the content and returns MJAI command.

        Args:
            content (bytes): Content to be parsed.

        Returns:
            None | list[dict]: MJAI command.
        """
        mjai_msgs = []
        rc_msg = self.preprocess(content)
        if rc_msg is None:
            return None

        if rc_msg.msg_type == 0x01:
            if "uid" not in rc_msg.msg_data:
                logger.error(f"Unknown login message: {rc_msg.msg_data}")
                return
            self.uid = int(rc_msg.msg_data["uid"])
            logger.info(f"Got uid: {self.uid}")
            return
        if "cmd" in rc_msg.msg_data:
            match rc_msg.msg_data["cmd"]:
                # =============================================================== #
                # cmd_enter_room:
                #     -> start_game
                # =============================================================== #
                case "cmd_enter_room":
                    # Might get multiple cmd_enter_room messages in one game.
                    if self.game_status.classify_id is not None:
                        if self.game_status.classify_id == rc_msg.msg_data["data"]["options"]["classify_id"]:
                            logger.warning(f"Already in room {self.game_status.classify_id}")
                            return
                    self.game_status = GameStatus()
                    self.game_status.game_start = True
                    players = rc_msg.msg_data["data"]["players"]
                    if rc_msg.msg_data["data"]["options"]["player_count"] == 3:
                        self.game_status.is_3p = True
                    for idx, player in enumerate(players):
                        self.game_status.player_list.append(player["user"]["user_id"])
                        # if player["user"]["user_id"] == self.uid:
                        #     position_at = player['position_at']
                        #     self.game_status.seat = position_at
                        #     mjai_msgs.append({
                        #         "type": "start_game",
                        #         "id": position_at
                        #     })
                        logger.info(f"Player {idx}: {player['user']['user_id']}")
                    # if self.game_status.is_3p:
                    #     self.game_status.player_list.append(-1)
                    return mjai_msgs
                # =============================================================== #
                # cmd_game_start:
                #     -> start_kyoku, tsumo
                # =============================================================== #
                case "cmd_game_start":
                    bakaze = CARD2MJAI[rc_msg.msg_data["data"]["quan_feng"]]
                    dora_marker = CARD2MJAI[rc_msg.msg_data["data"]["bao_pai_card"]]
                    if self.game_status.game_start:
                        # Rotate the player list * rc_msg.msg_data["data"]["dealer_pos"]
                        self.game_status.player_list = (
                            self.game_status.player_list[rc_msg.msg_data["data"]["dealer_pos"] :]
                            + self.game_status.player_list[: rc_msg.msg_data["data"]["dealer_pos"]]
                        )
                        position_at = self.game_status.player_list.index(self.uid)
                        self.game_status.seat = position_at
                        self.game_status.shift = rc_msg.msg_data["data"]["dealer_pos"]
                        mjai_msgs.append({"type": "start_game", "id": position_at})
                        if self.game_status.is_3p:
                            self.game_status.player_list.append(-1)
                        self.game_status.game_start = False
                    if self.game_status.is_3p:
                        kyoku = ((rc_msg.msg_data["data"]["dealer_pos"] - self.game_status.shift) % 3) + 1
                    else:
                        kyoku = ((rc_msg.msg_data["data"]["dealer_pos"] - self.game_status.shift) % 4) + 1
                    honba = rc_msg.msg_data["data"]["ben_chang_num"]
                    kyotaku = rc_msg.msg_data["data"]["li_zhi_bang_num"]
                    if self.game_status.is_3p:
                        oya = (rc_msg.msg_data["data"]["dealer_pos"] - self.game_status.shift) % 3
                    else:
                        oya = (rc_msg.msg_data["data"]["dealer_pos"] - self.game_status.shift) % 4
                    scores = [player["hand_points"] for player in rc_msg.msg_data["data"]["user_info_list"]]
                    if self.game_status.is_3p:
                        scores.append(0)
                    tehais = [["?"] * 13 for _ in range(4)]
                    if len(rc_msg.msg_data["data"]["hand_cards"]) == 14:
                        my_tehai = rc_msg.msg_data["data"]["hand_cards"][:13]
                        my_tsumo = rc_msg.msg_data["data"]["hand_cards"][13]
                    else:
                        my_tehai = rc_msg.msg_data["data"]["hand_cards"]
                        my_tsumo = None
                    my_tehai = [CARD2MJAI[card] for card in my_tehai]
                    self.game_status.tehai = my_tehai
                    tehais[self.game_status.seat] = my_tehai
                    mjai_msgs.append(
                        {
                            "type": "start_kyoku",
                            "bakaze": bakaze,
                            "dora_marker": dora_marker,
                            "kyoku": kyoku,
                            "honba": honba,
                            "kyotaku": kyotaku,
                            "oya": oya,
                            "scores": scores,
                            "tehais": tehais,
                        }
                    )
                    self.game_status.dora_markers = []
                    self.game_status.tsumo = my_tsumo
                    if my_tsumo is not None:
                        my_tsumo = CARD2MJAI[my_tsumo]
                        mjai_msgs.append(
                            {
                                "type": "tsumo",
                                "actor": self.game_status.seat,
                                "pai": my_tsumo,
                            }
                        )
                    else:
                        mjai_msgs.append(
                            {
                                "type": "tsumo",
                                "actor": oya,
                                "pai": "?",
                            }
                        )
                    return mjai_msgs
                # =============================================================== #
                # cmd_in_card_brc:
                #     -> tsumo for other players
                # =============================================================== #
                case "cmd_in_card_brc":
                    if self.game_status.accept_reach is not None:
                        mjai_msgs.append(self.game_status.accept_reach)
                        self.game_status.accept_reach = None
                    actor = self.game_status.player_list.index(rc_msg.msg_data["data"]["user_id"])
                    pai = CARD2MJAI[rc_msg.msg_data["data"]["card"]]
                    mjai_msgs.append(
                        {
                            "type": "tsumo",
                            "actor": actor,
                            "pai": pai,
                        }
                    )
                    return mjai_msgs
                # =============================================================== #
                # cmd_game_action_brc:
                #     -> chi, pon, ankan, kakan, reach, dahai
                #     -> end_kyoku, end_game
                # =============================================================== #
                case "cmd_game_action_brc":
                    action_info = rc_msg.msg_data["data"]["action_info"]
                    if self.game_status.accept_reach is not None:
                        mjai_msgs.append(self.game_status.accept_reach)
                        self.game_status.accept_reach = None
                    for action in action_info:
                        match action["action"]:
                            case 2 | 3 | 4:
                                # chi_low, chi_mid, chi_high
                                actor = self.game_status.player_list.index(action["user_id"])
                                target = (actor - 1) % 4
                                pai = CARD2MJAI[action["card"]]
                                consumed = [CARD2MJAI[card] for card in action["group_cards"]]
                                mjai_msgs.append(
                                    {
                                        "type": "chi",
                                        "actor": actor,
                                        "target": target,
                                        "pai": pai,
                                        "consumed": consumed,
                                    }
                                )
                                return mjai_msgs
                            case 5:
                                actor = self.game_status.player_list.index(action["user_id"])
                                target = self.game_status.last_dahai_actor
                                pai = CARD2MJAI[action["card"]]
                                consumed = [CARD2MJAI[card] for card in action["group_cards"]]
                                mjai_msgs.append(
                                    {
                                        "type": "pon",
                                        "actor": actor,
                                        "target": target,
                                        "pai": pai,
                                        "consumed": consumed,
                                    }
                                )
                                return mjai_msgs
                            case 6:
                                actor = self.game_status.player_list.index(action["user_id"])
                                target = self.game_status.last_dahai_actor
                                pai = CARD2MJAI[action["card"]]
                                consumed = [CARD2MJAI[card] for card in action["group_cards"]]
                                mjai_msgs.append(
                                    {
                                        "type": "daiminkan",
                                        "actor": actor,
                                        "target": target,
                                        "pai": pai,
                                        "consumed": consumed,
                                    }
                                )
                                return mjai_msgs
                            case 7:
                                # actor = self.game_status.player_list.index(action["user_id"])
                                # target = self.game_status.last_dahai_actor
                                # pai = CARD2MJAI[action["card"]]
                                # self.mjai_msgs.append({
                                #     "type": "hora",
                                #     "actor": actor,
                                #     "target": target,
                                #     "pai": pai,
                                # })
                                mjai_msgs.append(
                                    {
                                        "type": "end_kyoku",
                                    }
                                )
                                return mjai_msgs
                            case 8:
                                actor = self.game_status.player_list.index(action["user_id"])
                                consumed = [CARD2MJAI[action["card"]]] * 4
                                if consumed[0] in ["5m", "5p", "5s"]:
                                    consumed[0] += "r"
                                mjai_msgs.append(
                                    {
                                        "type": "ankan",
                                        "actor": actor,
                                        "consumed": consumed,
                                    }
                                )
                                return mjai_msgs
                            case 9:
                                actor = self.game_status.player_list.index(action["user_id"])
                                pai = CARD2MJAI[action["card"]]
                                consumed = [pai] * 3
                                if pai in ["5m", "5p", "5s"]:
                                    consumed[0] += "r"
                                if pai in ["5mr", "5pr", "5sr"]:
                                    consumed = [pai[:2]] * 3
                                mjai_msgs.append(
                                    {
                                        "type": "kakan",
                                        "actor": actor,
                                        "pai": pai,
                                        "consumed": consumed,
                                    }
                                )
                                return mjai_msgs
                            case 10:
                                # tsumo ron
                                mjai_msgs.append(
                                    {
                                        "type": "end_kyoku",
                                    }
                                )
                                return mjai_msgs
                            case 11:
                                actor = self.game_status.player_list.index(action["user_id"])
                                pai = CARD2MJAI[action["card"]]
                                tsumogiri = action["move_cards_pos"][0] == 14 if action["move_cards_pos"] else True
                                if action["is_li_zhi"]:
                                    mjai_msgs.append(
                                        {
                                            "type": "reach",
                                            "actor": actor,
                                        }
                                    )
                                mjai_msgs.append(
                                    {
                                        "type": "dahai",
                                        "actor": actor,
                                        "pai": pai,
                                        "tsumogiri": tsumogiri,
                                    }
                                )
                                self.game_status.last_dahai_actor = actor
                                if action["is_li_zhi"]:
                                    # TODO: When want to chi or pon or kan the
                                    # tile that is discarded, This causes problem.
                                    # reach_accepted should be sent after the actor
                                    # actually discards the tile.
                                    # mjai_msgs.append({
                                    #     "type": "reach_accepted",
                                    #     "actor": actor,
                                    # })
                                    self.game_status.accept_reach = {
                                        "type": "reach_accepted",
                                        "actor": actor,
                                    }
                                if len(self.game_status.dora_markers) > 0:
                                    for dora_marker in self.game_status.dora_markers:
                                        mjai_msgs.append(
                                            {
                                                "type": "dora",
                                                "dora_marker": dora_marker,
                                            }
                                        )
                                    self.game_status.dora_markers = []
                                return mjai_msgs
                            case 12:
                                # ryukyoku
                                mjai_msgs.append(
                                    {
                                        "type": "end_kyoku",
                                    }
                                )
                                return mjai_msgs
                            case 13:
                                actor = self.game_status.player_list.index(action["user_id"])
                                pai = CARD2MJAI[action["card"]]  # Must be "N"
                                mjai_msgs.append(
                                    {
                                        "type": "nukidora",
                                        "actor": actor,
                                        "pai": pai,
                                    }
                                )
                                return mjai_msgs
                            case _:
                                pass
                # =============================================================== #
                # cmd_send_current_action:
                #     -> tsumo for self
                # =============================================================== #
                case "cmd_send_current_action":
                    if self.game_status.accept_reach is not None:
                        mjai_msgs.append(self.game_status.accept_reach)
                        self.game_status.accept_reach = None
                    pai = CARD2MJAI[rc_msg.msg_data["data"]["in_card"]]
                    if pai != "?":
                        mjai_msgs.append(
                            {
                                "type": "tsumo",
                                "actor": self.game_status.seat,
                                "pai": pai,
                            }
                        )
                    else:
                        logger.warning(f"Unknown tsumo: {rc_msg.msg_data}")
                    return mjai_msgs
                    # if len(self.mjai_msgs) > 0:
                    #     self.react()
                # case "cmd_send_other_action":
                #     if len(self.mjai_msgs) > 0:
                #         self.react()
                case "cmd_gang_bao_brc":
                    dora_marker = CARD2MJAI[rc_msg.msg_data["data"]["cards"][-1]]
                    self.game_status.dora_markers.append(dora_marker)
                case "cmd_room_end":
                    mjai_msgs.append(
                        {
                            "type": "end_game",
                        }
                    )
                    self.game_status = GameStatus()
                    return mjai_msgs
                case _:
                    pass

    def build(self, command: dict) -> None | bytes:
        pass
