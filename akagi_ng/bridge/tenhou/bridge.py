import json
import re

from akagi_ng.bridge.base import BaseBridge
from akagi_ng.bridge.logger import logger
from akagi_ng.bridge.tenhou.consts import TenhouConstants
from akagi_ng.bridge.tenhou.utils.converter import (
    tenhou_to_mjai,
    tenhou_to_mjai_one,
    to_34_array,
)
from akagi_ng.bridge.tenhou.utils.decoder import Meld, parse_sc_tag
from akagi_ng.bridge.tenhou.utils.judrdy import isrh
from akagi_ng.bridge.tenhou.utils.state import State
from akagi_ng.core.constants import MahjongConstants


class TenhouBridge(BaseBridge):
    def __init__(self) -> None:
        super().__init__()
        self.state = State()
        self.handlers = {
            "HELO": self._convert_helo,
            "REJOIN": self._convert_rejoin,
            "GO": self._convert_go,
            "TAIKYOKU": self._convert_start_game,
            "INIT": self._convert_start_kyoku,
            "DORA": self._convert_dora,
            "REACH": self._dispatch_reach,
            "AGARI": self._convert_hora,
            "RYUUKYOKU": self._convert_ryukyoku,
            "N": self._dispatch_n,
        }
        self.regex_handlers = [
            (r"^[TUVW]\d*$", self._convert_tsumo),
            (r"^[DEFGdefg]\d*$", self._convert_dahai),
        ]

    def parse(self, content: bytes) -> None | list[dict]:
        """
        解析 Tenhou 消息并返回 MJAI 指令。

        Args:
            content: 待解析的 Tenhou JSON 消息内容

        Returns:
            MJAI 格式消息列表，或 None（心跳消息）

        Note:
            详细的 Tenhou 协议格式说明请参见 docs/PROTOCOL.md
        """
        if not (message := self._decode_message(content)):
            return None

        return self._dispatch_message(message)

    def _decode_message(self, content: bytes) -> dict | None:
        if content == b"<Z/>":
            # Heartbeat
            return None
        try:
            message = json.loads(content)
            assert isinstance(message, dict)
            return message
        except json.JSONDecodeError:
            logger.warning("Failed to decode JSON: %s", content)
            return None
        except AssertionError:
            logger.warning("Invalid JSON: %s", content)
            return None

    def _dispatch_message(self, message: dict) -> list[dict] | None:
        if "owari" in message:
            return self._convert_end_game(message)

        tag = message.get("tag")
        if not tag:
            return None

        if handler := self.handlers.get(tag):
            return handler(message)

        for pattern, handler in self.regex_handlers:
            if re.match(pattern, tag):
                return handler(message)

        return None

    def _dispatch_reach(self, message: dict) -> list[dict] | None:
        step = message.get("step")
        if step == "1":
            return self._convert_reach(message)
        if step == "2":
            return self._convert_reach_accepted(message)
        return None

    def _dispatch_n(self, message: dict) -> list[dict] | None:
        if "m" in message:
            return self._convert_meld(message)
        return None

    def _convert_helo(self, message: dict) -> list[dict] | None:
        return None

    def _convert_rejoin(self, message: dict) -> list[dict] | None:
        return None

    def _convert_go(self, message: dict) -> list[dict] | None:
        return None

    def _convert_start_game(self, message: dict) -> list[dict] | None:
        # message['oya'] 是庄家相对于玩家的座位号
        # 获取玩家的绝对座位号
        self.state.seat = (MahjongConstants.SEATS_4P - int(message["oya"])) % MahjongConstants.SEATS_4P
        return [self.make_start_game(self.state.seat)]

    def _convert_start_kyoku(self, message: dict) -> list[dict] | None:
        self.state.hand = [int(s) for s in message["hai"].split(",")]
        self.state.in_riichi = False
        self.state.live_wall = 70
        self.state.melds.clear()
        self.state.wait.clear()
        self.state.last_kawa_tile = "?"
        self.state.is_tsumo = False
        self.state.is_new_round = True

        bakaze = ["E", "S", "W", "N"]
        oya = self.rel_to_abs(int(message["oya"]))
        seed = [int(s) for s in message["seed"].split(",")]
        bakaze = bakaze[seed[0] // 4]
        kyoku = seed[0] % MahjongConstants.SEATS_4P + 1
        honba = seed[1]
        kyotaku = seed[2]
        dora_marker = tenhou_to_mjai_one(seed[5])
        scores = [int(s) * 100 for s in message["ten"].split(",")]
        tehais = [["?" for _ in range(MahjongConstants.TEHAI_SIZE)]] * MahjongConstants.SEATS_4P
        tehais[self.state.seat] = tenhou_to_mjai(self.state.hand)

        if bakaze == "E" and kyoku == 1 and honba == 0 and 0 in scores:
            self.state.is_3p = True
        if self.state.is_3p:
            new_scores = [-1, -1, -1, -1]
            for i in range(MahjongConstants.SEATS_4P):
                new_scores[self.rel_to_abs(i)] = scores[i]
            scores = new_scores

        return [
            self.make_start_kyoku(
                bakaze=bakaze,
                kyoku=kyoku,
                honba=honba,
                kyotaku=kyotaku,
                oya=oya,
                dora_marker=dora_marker,
                scores=scores,
                tehais=tehais,
            )
        ]

    def _convert_tsumo(self, message: dict) -> list[dict] | None:
        self.state.live_wall -= 1

        tag = message["tag"]
        actor = self.rel_to_abs(ord(tag[0]) - ord("T"))

        mjai_messages = [self.make_tsumo(actor, "?")]

        if actor == self.state.seat:
            index = int(tag[1:])
            mjai_messages[0]["pai"] = tenhou_to_mjai_one(index)
            self.state.hand.append(index)
            self.state.is_tsumo = True
            return mjai_messages
        return mjai_messages

    def _convert_dahai(self, message: dict) -> list[dict] | None:
        tag = message["tag"]
        actor = self.rel_to_abs(ord(str.upper(tag[0])) - ord("D"))
        if len(tag) == 1:
            # tsumogiri
            assert actor == self.state.seat
            index = self.state.hand[-1]
        else:
            index = int(tag[1:])
        pai = tenhou_to_mjai_one(index)
        tsumogiri = str.isupper(tag[0]) if actor != self.state.seat else index == self.state.hand[-1]
        self.state.last_kawa_tile = pai

        mjai_messages = [self.make_dahai(actor, pai, tsumogiri)]

        self.state.is_tsumo = False
        if actor == self.state.seat:
            self.state.hand.remove(index)

        return mjai_messages

    def _convert_meld(self, message: dict) -> list[dict] | None:
        actor = self.rel_to_abs(int(message["who"]))
        m = int(message["m"])
        if (m & TenhouConstants.BIT_MASK_M) == TenhouConstants.BIT_NUKIDORA:
            # nukidora
            mjai_messages = [self.make_nukidora(actor)]
            if actor == self.state.seat:
                for i in self.state.hand:
                    if i // TenhouConstants.TILES_PER_TYPE == TenhouConstants.PEI_INDEX:
                        self.state.hand.remove(i)
                        break
            return mjai_messages
        meld = Meld.parse_meld(m)
        target = (
            (actor - 1) % MahjongConstants.SEATS_4P
            if meld.meld_type == Meld.CHI
            else (actor + meld.target) % MahjongConstants.SEATS_4P
        )

        mjai_messages = [
            {"type": meld.meld_type, "actor": actor, "target": target, "pai": meld.pai, "consumed": meld.consumed}
        ]

        if meld.meld_type in [Meld.KAKAN, Meld.ANKAN]:
            del mjai_messages[0]["target"]
        if meld.meld_type == Meld.ANKAN:
            del mjai_messages[0]["pai"]

        if actor == self.state.seat:
            for i in meld.exposed:
                self.state.hand.remove(i)

            self.state.melds.append(meld)

        return mjai_messages

    def _convert_reach(self, message: dict) -> list[dict] | None:
        actor = self.rel_to_abs(int(message["who"]))
        mjai_messages = [self.make_reach(actor)]

        if actor == self.state.seat:
            return mjai_messages
        return mjai_messages

    def _convert_reach_accepted(self, message: dict) -> list[dict] | None:
        if self.rel_to_abs(int(message["who"])) == self.state.seat:
            self.state.in_riichi = True
            self.state.wait = isrh(to_34_array(self.state.hand))

        actor = self.rel_to_abs(int(message["who"]))
        deltas = [0] * MahjongConstants.SEATS_4P
        deltas[actor] = -1000
        scores = [int(s) * 100 for s in message["ten"].split(",")]

        return [self.make_reach_accepted(actor, deltas, scores)]

    def _convert_dora(self, message: dict) -> list[dict] | None:
        hai = int(message["hai"])
        dora_marker = tenhou_to_mjai_one(hai)
        return [self.make_dora(dora_marker)]

    def _convert_hora(self, message: dict) -> list[dict] | None:
        scores = parse_sc_tag(message)
        # 将分数旋转到玩家座位视角
        scores = scores[-self.state.seat :] + scores[: -self.state.seat]
        return [self.make_end_kyoku()]

    def _convert_ryukyoku(self, message: dict) -> list[dict] | None:
        scores = parse_sc_tag(message)
        return [{"type": "ryukyoku", "scores": scores}, {"type": "end_kyoku"}]

    def _convert_end_game(self, message: dict) -> list[dict] | None:
        return [self.make_end_game()]

    def rel_to_abs(self, rel: int) -> int:
        return (rel + self.state.seat) % MahjongConstants.SEATS_4P

    def abs_to_rel(self, abs: int) -> int:
        return (abs - self.state.seat) % MahjongConstants.SEATS_4P
