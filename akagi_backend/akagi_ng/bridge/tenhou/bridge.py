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
from akagi_ng.bridge.tenhou.utils.decoder import Meld, MeldType, parse_sc_tag
from akagi_ng.bridge.tenhou.utils.judrdy import isrh
from akagi_ng.bridge.tenhou.utils.state import State
from akagi_ng.bridge.types import MJAIEvent, RyukyokuEvent
from akagi_ng.core.constants import MahjongConstants


class TenhouBridge(BaseBridge):
    def __init__(self):
        super().__init__()
        self.state = State()
        self.handlers = {
            "HELO": self._convert_helo,
            "REJOIN": self._convert_rejoin,
            "UN": self._convert_un,
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

    def reset(self):
        self.state = State()

    def parse(self, content: bytes) -> None | list[MJAIEvent]:
        """
        解析 Tenhou 消息并返回 MJAI 指令。
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

    def _dispatch_message(self, message: dict) -> list[MJAIEvent] | None:
        if "owari" in message:
            return self._convert_end_game()

        tag = message.get("tag")
        if not tag:
            return None

        if handler := self.handlers.get(tag):
            return handler(message)

        for pattern, handler in self.regex_handlers:
            if re.match(pattern, tag):
                return handler(message)

        return None

    def _dispatch_reach(self, message: dict) -> list[MJAIEvent] | None:
        step = message.get("step")
        if step == "1":
            return self._convert_reach(message)
        if step == "2":
            return self._convert_reach_accepted(message)
        return None

    def _dispatch_n(self, message: dict) -> list[MJAIEvent] | None:
        if "m" in message:
            return self._convert_meld(message)
        return None

    def _convert_helo(self, message: dict) -> list[MJAIEvent] | None:
        if self.state.game_active:
            logger.info("[Tenhou] Session re-initialized via HELO while game active. Sending end_game.")
            msgs = [self.make_end_game()]
            self.reset()
            return msgs
        return None

    def _convert_rejoin(self, message: dict) -> list[MJAIEvent] | None:
        return None

    def _convert_un(self, message: dict) -> list[MJAIEvent] | None:
        # Robust 3P detection: count non-empty names among n0, n1, n2, n3.
        # In 3P, one of these will be missing or empty strings.
        names = [message.get(f"n{i}", "") for i in range(4)]
        player_count = len([n for n in names if n])
        self.state.is_3p = player_count == MahjongConstants.SEATS_3P
        logger.debug(f"[Tenhou] UN tag: player_count={player_count}, is_3p={self.state.is_3p}")
        return None

    def _convert_start_game(self, message: dict) -> list[MJAIEvent] | None:
        self.state.game_active = True
        # oya in TAIKYOKU is the dealer's absolute seat.
        # Legacy logic maps dealer to actor 0 by setting our seat to (4 - oya) % 4.
        self.state.seat = (MahjongConstants.SEATS_4P - int(message["oya"])) % MahjongConstants.SEATS_4P
        msg = (
            f"[Tenhou] Game started. {'3P' if self.state.is_3p else '4P'} mode. "
            f"Assigned internal seat {self.state.seat}"
        )
        logger.info(msg)
        return [self.make_start_game(self.state.seat)]

    def _convert_start_kyoku(self, message: dict) -> list[MJAIEvent] | None:
        self.state.hand = [int(s) for s in message["hai"].split(",")]
        self.state.in_riichi = False
        self.state.live_wall = 70
        self.state.melds.clear()
        self.state.wait.clear()
        self.state.last_kawa_tile = "?"
        self.state.is_tsumo = False
        self.state.is_new_round = True

        bakaze_names = ["E", "S", "W", "N"]
        oya = self.rel_to_abs(int(message["oya"]))
        seed = [int(s) for s in message["seed"].split(",")]
        bakaze = bakaze_names[seed[0] // 4]
        kyoku = seed[0] % 4 + 1
        honba = seed[1]
        kyotaku = seed[2]
        dora_marker = tenhou_to_mjai_one(seed[5])

        # 处理分数：始终补全到 4 人以兼容 MJAI 引擎
        raw_scores = [int(s) * 100 for s in message["ten"].split(",")]
        scores = [0] * MahjongConstants.SEATS_4P
        for i in range(min(len(raw_scores), MahjongConstants.SEATS_4P)):
            scores[self.rel_to_abs(i)] = raw_scores[i]

        tehais = [["?" for _ in range(MahjongConstants.TEHAI_SIZE)] for _ in range(MahjongConstants.SEATS_4P)]
        tehais[self.state.seat] = tenhou_to_mjai(self.state.hand)

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
                is_3p=self.state.is_3p,
            )
        ]

    def _convert_tsumo(self, message: dict) -> list[MJAIEvent] | None:
        self.state.live_wall -= 1

        tag = message["tag"]
        rel_seat = ord(tag[0]) - ord("T")

        # In 3P mode, 'W' is not a player
        if self.state.is_3p and rel_seat >= MahjongConstants.SEATS_3P:
            return None

        actor = self.rel_to_abs(rel_seat)
        mjai_messages: list[MJAIEvent] = [self.make_tsumo(actor, "?")]

        if actor == self.state.seat:
            # Handle potential tile index in tag (for non-JSON protocols) OR in 'p' field
            index_str = tag[1:]
            if index_str:
                index = int(index_str)
            elif "p" in message:
                index = int(message["p"])
            else:
                logger.warning(f"[Tenhou] Self tsumo tag '{tag}' missing index")
                return mjai_messages

            mjai_messages[0]["pai"] = tenhou_to_mjai_one(index)
            self.state.hand.append(index)
            self.state.is_tsumo = True
            return mjai_messages
        return mjai_messages

    def _convert_dahai(self, message: dict) -> list[MJAIEvent] | None:
        tag = message["tag"]
        rel_seat = ord(str.upper(tag[0])) - ord("D")
        actor = self.rel_to_abs(rel_seat)

        if "p" in message:
            index = int(message["p"])
        elif len(tag) > 1:
            index = int(tag[1:])
        else:
            # Fallback for tsumogiri if index is missing (should not happen in JSON)
            index = self.state.hand[-1] if actor == self.state.seat and self.state.hand else -1

        pai = tenhou_to_mjai_one(index) if index != -1 else "?"

        # Tenhou JSON: uppercase letter means discard (and might be tsumogiri),
        # lowercase letter means tsumogiri? Actually legacy uses isupper check.
        tsumogiri = (
            str.isupper(tag[0])
            if actor != self.state.seat
            else (index == self.state.hand[-1] if self.state.hand else True)
        )
        self.state.last_kawa_tile = pai

        mjai_messages: list[MJAIEvent] = [self.make_dahai(actor, pai, tsumogiri)]

        self.state.is_tsumo = False
        if actor == self.state.seat and index != -1:
            if index in self.state.hand:
                self.state.hand.remove(index)
            else:
                logger.warning(f"[Tenhou] Tile {index} ({pai}) not in hand during Dahai. State sync issue.")

        return mjai_messages

    def _convert_meld(self, message: dict) -> list[MJAIEvent] | None:
        actor = self.rel_to_abs(int(message["who"]))
        m = int(message["m"])
        if (m & TenhouConstants.BIT_MASK_M) == TenhouConstants.BIT_NUKIDORA:
            return self._handle_nukidora(actor)

        meld = Meld.parse_meld(m)
        num_players = MahjongConstants.SEATS_4P
        mjai_messages: list[MJAIEvent] = []

        match meld.meld_type:
            case MeldType.CHI:
                target = (actor - 1) % num_players
                mjai_messages.append(self.make_chi(actor, target, meld.pai, meld.consumed))
            case MeldType.PON:
                target = (actor + meld.target) % num_players
                mjai_messages.append(self.make_pon(actor, target, meld.pai, meld.consumed))
            case MeldType.DAIMINKAN:
                target = (actor + meld.target) % num_players
                mjai_messages.append(self.make_daiminkan(actor, target, meld.pai, meld.consumed))
            case MeldType.KAKAN:
                mjai_messages.append(self.make_kakan(actor, meld.pai, meld.consumed))
            case MeldType.ANKAN:
                mjai_messages.append(self.make_ankan(actor, meld.consumed))
            case _:
                logger.warning(f"Unknown meld type: {meld.meld_type}")
                return []

        if actor == self.state.seat:
            self._update_hand_for_meld(meld)
            self.state.melds.append(meld)

        return mjai_messages

    def _handle_nukidora(self, actor: int) -> list[MJAIEvent]:
        mjai_messages: list[MJAIEvent] = [self.make_nukidora(actor)]
        if actor == self.state.seat:
            found = False
            for i in self.state.hand:
                if i // TenhouConstants.TILES_PER_TYPE == TenhouConstants.PEI_INDEX:
                    self.state.hand.remove(i)
                    found = True
                    break
            if not found:
                logger.warning("[Tenhou] Nukidora (Pei) not found in hand during conversion")
        return mjai_messages

    def _update_hand_for_meld(self, meld: Meld):
        for i in meld.exposed:
            if i in self.state.hand:
                self.state.hand.remove(i)
            else:
                logger.warning(f"[Tenhou] Tile {i} in meld {meld.meld_type} not found in hand")

    def _convert_reach(self, message: dict) -> list[MJAIEvent] | None:
        actor = self.rel_to_abs(int(message["who"]))
        mjai_messages: list[MJAIEvent] = [self.make_reach(actor)]

        if actor == self.state.seat:
            return mjai_messages
        return mjai_messages

    def _convert_reach_accepted(self, message: dict) -> list[MJAIEvent] | None:
        actor = self.rel_to_abs(int(message["who"]))
        if actor == self.state.seat:
            self.state.in_riichi = True
            self.state.wait = isrh(to_34_array(self.state.hand))

        deltas = [0] * 4
        deltas[actor] = -1000
        scores = [0] * 4
        raw_scores = [int(s) * 100 for s in message["ten"].split(",")]

        for i in range(min(len(raw_scores), 4)):
            scores[self.rel_to_abs(i)] = raw_scores[i]

        return [self.make_reach_accepted(actor, deltas, scores)]

    def _convert_dora(self, message: dict) -> list[MJAIEvent] | None:
        hai = int(message["hai"])
        dora_marker = tenhou_to_mjai_one(hai)
        return [self.make_dora(dora_marker)]

    def _convert_hora(self, message: dict) -> list[MJAIEvent] | None:
        self.state.is_new_round = False
        # Rotate scores accordingly
        raw_scores = parse_sc_tag(message)
        scores = [0] * 4
        for i in range(min(len(raw_scores), 4)):
            scores[self.rel_to_abs(i)] = raw_scores[i]
        return [self.make_end_kyoku()]

    def _convert_ryukyoku(self, message: dict) -> list[MJAIEvent] | None:
        raw_scores = parse_sc_tag(message)
        scores = [0] * 4
        for i in range(min(len(raw_scores), 4)):
            scores[self.rel_to_abs(i)] = raw_scores[i]
        ryukyoku_event: RyukyokuEvent = {"type": "ryukyoku", "scores": scores}
        return [ryukyoku_event, self.make_end_kyoku()]

    def _convert_end_game(self) -> list[MJAIEvent] | None:
        self.state.game_active = False
        return [self.make_end_game()]

    def rel_to_abs(self, rel: int) -> int:
        return (rel + self.state.seat) % MahjongConstants.SEATS_4P

    def abs_to_rel(self, abs_seat: int) -> int:
        return (abs_seat - self.state.seat) % MahjongConstants.SEATS_4P
