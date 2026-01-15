import json

from akagi_ng.bridge.base import BaseBridge
from akagi_ng.bridge.logger import logger
from akagi_ng.bridge.riichi_city.consts import CARD2MJAI, RCAction
from akagi_ng.core.constants import MahjongConstants


class RCMessage:
    def __init__(self, msg_id: int, msg_type: int, msg_data: dict) -> None:
        self.msg_id = msg_id
        self.msg_type = msg_type
        self.msg_data = msg_data

    def __str__(self) -> str:
        return f"Message: {self.msg_id} {self.msg_type} {self.msg_data}"


class GameStatus:
    def __init__(self) -> None:
        self.seat: int = -1
        self.tehai: list[str] = []
        self.tsumo: str | None = None

        self.last_dahai_actor: int = -1

        self.player_list: list[int] = []
        self.dora_markers: list[str] = []
        self.accept_reach: dict | None = None
        self.game_start: bool = False
        self.shift: int = 0
        self.classify_id: int | None = None

        self.is_3p = False


class RiichiCityBridge(BaseBridge):
    HEADER_LENGTH = 15

    def __init__(self) -> None:
        super().__init__()
        self.uid: int = -1
        self.game_status = GameStatus()
        self.handlers = {
            "cmd_enter_room": self._handle_enter_room,
            "cmd_game_start": self._handle_game_start,
            "cmd_in_card_brc": self._handle_in_card_brc,
            "cmd_game_action_brc": self._handle_game_action_brc,
            "cmd_send_current_action": self._handle_send_current_action,
            "cmd_gang_bao_brc": self._handle_gang_bao_brc,
            "cmd_room_end": self._handle_room_end,
        }

    def preprocess(self, content: bytes) -> RCMessage | None:
        """预处理内容并返回 RCMessage。

        Args:
            content (bytes): 待预处理的内容。

        Returns:
            RCMessage: RCMessage 对象。
        """
        # 将前 4 个字节转换为整数
        msg_len = int.from_bytes(content[:4], byteorder="big")
        # 检查消息是否完整
        if len(content) != msg_len:
            logger.warning(f"Message is not complete, expected {msg_len} bytes, got {len(content)} bytes")
            logger.warning(f"Message: {content.hex(' ')}")
            return None
        # 检查接下来的 4 个字节是否为 00 0f 00 01
        # 尚不清楚这代表什么。
        if content[4:8] != b"\x00\x0f\x00\x01":
            logger.warning("Message is unknown format, expected 00 0f 00 01")
            logger.warning(f"Message: {content.hex(' ')}")
            return None
        # 将接下来的 4 个字节转换为整数
        msg_id = int.from_bytes(content[8:12], byteorder="big")
        # 将接下来的 2 个字节转换为整数
        msg_type = int.from_bytes(content[12:14], byteorder="big")
        # 检查接下来的 1 个字节是否为 01
        # 尚不清楚这代表什么。
        if content[14] != 1:
            logger.warning("Message is unknown format, expected 01")
            logger.warning(f"Message: {content.hex(' ')}")
            return None
        # 从剩余消息中加载 JSON 数据
        # 如果没有数据，将为空
        msg_data = (
            {} if len(content) == self.HEADER_LENGTH else json.loads(content[self.HEADER_LENGTH:].decode("utf-8"))
        )
        logger.debug({"msg_id": msg_id, "msg_type": msg_type, "msg_data": msg_data})

        return RCMessage(msg_id, msg_type, msg_data)

    def parse(self, content: bytes) -> None | list[dict]:
        """解析内容并返回 MJAI 指令。

        Args:
            content (bytes): 待解析的内容。

        Returns:
            None | list[dict]: MJAI 指令。
        """

        rc_msg = self.preprocess(content)
        if rc_msg is None:
            return None

        if rc_msg.msg_type == 0x01:
            if "uid" not in rc_msg.msg_data:
                logger.error(f"Unknown login message: {rc_msg.msg_data}")
                return None
            self.uid = int(rc_msg.msg_data["uid"])
            logger.info(f"Got uid: {self.uid}")
            return None
        if "cmd" in rc_msg.msg_data and (handler := self.handlers.get(rc_msg.msg_data["cmd"])):
            return handler(rc_msg)
        return None

    def _handle_enter_room(self, rc_msg: RCMessage) -> list[dict] | None:
        if (
                self.game_status.classify_id is not None
                and self.game_status.classify_id == rc_msg.msg_data["data"]["options"]["classify_id"]
        ):
            logger.warning(f"Already in room {self.game_status.classify_id}")
            return None
        self.game_status = GameStatus()
        self.game_status.game_start = True
        players = rc_msg.msg_data["data"]["players"]
        if rc_msg.msg_data["data"]["options"]["player_count"] == MahjongConstants.PLAYER_COUNT_3P:
            self.game_status.is_3p = True
        for idx, player in enumerate(players):
            self.game_status.player_list.append(player["user"]["user_id"])
            logger.info(f"Player {idx}: {player['user']['user_id']}")
        return []

    def _handle_game_start(self, rc_msg: RCMessage) -> list[dict] | None:
        mjai_msgs = []
        bakaze = CARD2MJAI[rc_msg.msg_data["data"]["quan_feng"]]
        dora_marker = CARD2MJAI[rc_msg.msg_data["data"]["bao_pai_card"]]
        if self.game_status.game_start:
            # 根据 dealer_pos 旋转玩家列表
            self.game_status.player_list = (
                    self.game_status.player_list[rc_msg.msg_data["data"]["dealer_pos"]:]
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
        tehais = [["?" for _ in range(13)] for _ in range(4)]
        if len(rc_msg.msg_data["data"]["hand_cards"]) == MahjongConstants.TSUMO_TEHAI_SIZE:
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

    def _handle_in_card_brc(self, rc_msg: RCMessage) -> list[dict] | None:
        mjai_msgs = []
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

    def _handle_rc_meld(self, action: dict, mjai_msgs: list[dict]) -> None:
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

    def _handle_rc_pon_daiminkan(self, action: dict, mjai_msgs: list[dict], meld_type: str) -> None:
        actor = self.game_status.player_list.index(action["user_id"])
        target = self.game_status.last_dahai_actor
        pai = CARD2MJAI[action["card"]]
        consumed = [CARD2MJAI[card] for card in action["group_cards"]]
        mjai_msgs.append(
            {
                "type": meld_type,
                "actor": actor,
                "target": target,
                "pai": pai,
                "consumed": consumed,
            }
        )

    def _handle_rc_ankan(self, action: dict, mjai_msgs: list[dict]) -> None:
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

    def _handle_rc_kakan(self, action: dict, mjai_msgs: list[dict]) -> None:
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

    def _handle_rc_action(self, action: dict, mjai_msgs: list[dict]) -> None:
        match action["action"]:
            case RCAction.CHI_LOW | RCAction.CHI_MID | RCAction.CHI_HIGH:
                self._handle_rc_meld(action, mjai_msgs)
            case RCAction.PON:
                self._handle_rc_pon_daiminkan(action, mjai_msgs, "pon")
            case RCAction.DAIMINKAN:
                self._handle_rc_pon_daiminkan(action, mjai_msgs, "daiminkan")
            case RCAction.HORA:
                mjai_msgs.append({"type": "end_kyoku"})
            case RCAction.ANKAN:
                self._handle_rc_ankan(action, mjai_msgs)
            case RCAction.KAKAN:
                self._handle_rc_kakan(action, mjai_msgs)
            case RCAction.RON_TSUMO:
                mjai_msgs.append({"type": "end_kyoku"})

    def _handle_rc_dahai(self, action: dict, mjai_msgs: list[dict]) -> None:
        actor = self.game_status.player_list.index(action["user_id"])
        pai = CARD2MJAI[action["card"]]
        tsumogiri = (
            action["move_cards_pos"][0] == MahjongConstants.TSUMO_TEHAI_SIZE if action["move_cards_pos"] else True
        )
        if action["is_li_zhi"]:
            mjai_msgs.append({"type": "reach", "actor": actor})
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
            self.game_status.accept_reach = {"type": "reach_accepted", "actor": actor}
        if self.game_status.dora_markers:
            for dora_marker in self.game_status.dora_markers:
                mjai_msgs.append({"type": "dora", "dora_marker": dora_marker})
            self.game_status.dora_markers = []

    def _handle_rc_nukidora(self, action: dict, mjai_msgs: list[dict]) -> None:
        actor = self.game_status.player_list.index(action["user_id"])
        pai = CARD2MJAI[action["card"]]
        mjai_msgs.append(
            {
                "type": "nukidora",
                "actor": actor,
                "pai": pai,
            }
        )

    def _handle_rc_action(self, action: dict, mjai_msgs: list[dict]) -> None:
        match action["action"]:
            case RCAction.CHI_LOW | RCAction.CHI_MID | RCAction.CHI_HIGH:
                self._handle_rc_meld(action, mjai_msgs)
            case RCAction.PON:
                self._handle_rc_pon_daiminkan(action, mjai_msgs, "pon")
            case RCAction.DAIMINKAN:
                self._handle_rc_pon_daiminkan(action, mjai_msgs, "daiminkan")
            case RCAction.ANKAN:
                self._handle_rc_ankan(action, mjai_msgs)
            case RCAction.KAKAN:
                self._handle_rc_kakan(action, mjai_msgs)
            case RCAction.DAHAI_REACH:
                self._handle_rc_dahai(action, mjai_msgs)
            case RCAction.NUKIDORA:
                self._handle_rc_nukidora(action, mjai_msgs)
            case RCAction.HORA | RCAction.RON_TSUMO | RCAction.RYUKYOKU:
                mjai_msgs.append({"type": "end_kyoku"})
            case _:
                pass

    def _handle_game_action_brc(self, rc_msg: RCMessage) -> list[dict] | None:
        mjai_msgs = []
        action_info = rc_msg.msg_data["data"]["action_info"]
        if self.game_status.accept_reach is not None:
            mjai_msgs.append(self.game_status.accept_reach)
            self.game_status.accept_reach = None
        for action in action_info:
            self._handle_rc_action(action, mjai_msgs)
            # Check if flow should stop (return immediately after constructing msgs?)
            # The original logic used `return mjai_msgs` inside match cases, implying early return per action.
            # But action_info is a list. Could there be multiple actions?
            # Looking at original code: `return mjai_msgs` was inside EACH case.
            # So it processes ONLY THE FIRST matched action and returns.
            # If so, the loop `for action in action_info` is effectively doing `if action_info: action=action_info[0]`.
            # Let's preserve the original behavior: return after handling one action.
            if mjai_msgs:
                return mjai_msgs
        return None

    def _handle_send_current_action(self, rc_msg: RCMessage) -> list[dict] | None:
        mjai_msgs = []
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

    def _handle_gang_bao_brc(self, rc_msg: RCMessage) -> list[dict] | None:
        dora_marker = CARD2MJAI[rc_msg.msg_data["data"]["cards"][-1]]
        self.game_status.dora_markers.append(dora_marker)
        return None

    def _handle_room_end(self, rc_msg: RCMessage) -> list[dict] | None:
        self.game_status = GameStatus()
        return [{"type": "end_game"}]

    def build(self, command: dict) -> None | bytes:
        pass
