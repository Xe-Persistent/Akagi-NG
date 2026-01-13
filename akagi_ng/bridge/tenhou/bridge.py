import json
import re
from copy import deepcopy
from itertools import combinations, permutations

from akagi_ng.bridge.base import BaseBridge
from akagi_ng.bridge.logger import logger
from akagi_ng.bridge.tenhou.utils.converter import (
    mjai_to_tenhou,
    mjai_to_tenhou_one,
    tenhou_to_mjai,
    tenhou_to_mjai_one,
    to_34_array,
)
from akagi_ng.bridge.tenhou.utils.decoder import Meld, parse_sc_tag
from akagi_ng.bridge.tenhou.utils.judrdy import isrh
from akagi_ng.bridge.tenhou.utils.state import State


class TenhouBridge(BaseBridge):
    def __init__(self):
        self.state = State()
        pass

    def parse(self, content: bytes) -> None | list[dict]:
        """
                Parses the content and returns MJAI command.

                Args:
                    content (bytes): Content to be parsed.

                Returns:
                    None | list[dict]: MJAI command.

        Tenhou message format:
                <SHUFFLE>
         - seed         Seed for RNG for generating walls and dice rolls.
         - ref          ?
        <GO>            Start of game
         - type             Lobby type.
         - lobby            Lobby number.
        <UN>            User list or user reconnect
         - n[0-3]           Names for each player as URLEncoded UTF-8.
         - dan              List of ranks for each player.
         - rate             List of rates for each player.
         - sx               List of sex ("M" or "F") for each player.
        <BYE>           User disconnect
         - who              Player who disconnected.
        <TAIKYOKU>      Start of round
         - oya              Dealer
        <INIT>          Start of hand
         - seed             Six element list:
                                Round number,
                                Number of combo sticks,
                                Number of riichi sticks,
                                First dice minus one,
                                Second dice minus one,
                                Dora indicator.
         - ten              List of scores for each player
         - oya              Dealer
         - hai[0-3]         Starting hands as a list of tiles for each player.
        <[T-W][0-9]*>   Player draws a tile.
        <[D-G][0-9]*>   Player discards a tile.
        <N>             Player calls a tile.
         - who              The player who called the tile.
         - m                The meld.
        <REACH>         Player declares riichi.
         - who              The player who declared riichi
         - step             Where the player is in declaring riichi:
                                1 -> Called "riichi"
                                2 -> Placed point stick on table after discarding.
         - ten              List of current scores for each player.
        <DORA>          New dora indicator.
         - hai              The new dora indicator tile.
        <AGARI>         A player won the hand
         - who              The player who won.
         - fromwho          Who the winner won from: themselves for tsumo, someone else for ron.
         - hai              The closed hand of the winner as a list of tiles.
         - m                The open melds of the winner as a list of melds.
         - machi            The waits of the winner as a list of tiles.
         - doraHai          The dora as a list of tiles.
         - dorahaiUra       The ura dora as a list of tiles.
         - yaku             List of yaku and their han values.
                                    0 -> tsumo
                                    1 -> riichi
                                    2 -> ippatsu
                                    3 -> chankan
                                    4 -> rinshan
                                    5 -> haitei
                                    6 -> houtei
                                    7 -> pinfu
                                    8 -> tanyao
                                    9 -> ippeiko
                                10-17 -> fanpai
                                18-20 -> yakuhai
                                   21 -> daburi
                                   22 -> chiitoi
                                   23 -> chanta
                                   24 -> itsuu
                                   25 -> sanshokudoujin
                                   26 -> sanshokudou
                                   27 -> sankantsu
                                   28 -> toitoi
                                   29 -> sanankou
                                   30 -> shousangen
                                   31 -> honrouto
                                   32 -> ryanpeikou
                                   33 -> junchan
                                   34 -> honitsu
                                   35 -> chinitsu
                                   52 -> dora
                                   53 -> uradora
                                   54 -> akadora
         - yakuman          List of yakuman.
                                   36 -> renhou
                                   37 -> tenhou
                                   38 -> chihou
                                   39 -> daisangen
                                40,41 -> suuankou
                                   42 -> tsuiisou
                                   43 -> ryuuiisou
                                   44 -> chinrouto
                                45,46 -> chuurenpooto
                                47,48 -> kokushi
                                   49 -> daisuushi
                                   50 -> shousuushi
                                   51 -> suukantsu
         - ten              Three element list:
                                The fu points in the hand,
                                The point value of the hand,
                                The limit value of the hand:
                                    0 -> No limit
                                    1 -> Mangan
                                    2 -> Haneman
                                    3 -> Baiman
                                    4 -> Sanbaiman
                                    5 -> Yakuman
         - ba               Two element list of stick counts:
                                The number of combo sticks,
                                The number of riichi sticks.
         - sc               List of scores and the changes for each player.
         - owari            Final scores including uma at the end of the game.
        <RYUUKYOKU>     The hand ended with a draw
         - type             The type of draw:
                                "yao9"   -> 9 ends
                                "reach4" -> Four riichi calls
                                "ron3"   -> Triple ron
                                "kan4"   -> Four kans
                                "kaze4"  -> Same wind discard on first round
                                "nm"     -> Nagashi mangan.
         - hai[0-3]         The hands revealed by players as a list of tiles.
         - ba               Two element list of stick counts:
                                The number of combo sticks,
                                The number of riichi sticks.
         - sc               List of scores and the changes for each player.
         - owari            Final scores including uma at the end of the game.
        """

        if content == b"<Z/>":
            # Heartbeat
            return None
        try:
            message = json.loads(content)
            assert isinstance(message, dict)
        except json.JSONDecodeError:
            logger.warning("Failed to decode JSON: %s", content)
            return None
        except AssertionError:
            logger.warning("Invalid JSON: %s", content)
            return None

        tag = message.get("tag")

        if tag == "HELO":
            return self._convert_helo(message)
        if tag == "REJOIN":
            return self._convert_rejoin(message)
        if tag == "GO":
            return self._convert_go(message)
        if tag == "TAIKYOKU":
            return self._convert_start_game(message)
        if tag == "INIT":
            return self._convert_start_kyoku(message)
        if re.match(r"^[TUVW]\d*$", tag):
            return self._convert_tsumo(message)
        if re.match(r"^[DEFGdefg]\d*$", tag):
            return self._convert_dahai(message)
        if tag == "N" and "m" in message:
            return self._convert_meld(message)
        if tag == "REACH" and message["step"] == "1":
            return self._convert_reach(message)
        if tag == "REACH" and message["step"] == "2":
            return self._convert_reach_accepted(message)
        if tag == "DORA":
            return self._convert_dora(message)
        if tag == "AGARI" and "owari" not in message:
            return self._convert_hora(message)
        if tag == "RYUUKYOKU" and "owari" not in message:
            return self._convert_ryukyoku(message)
        if "owari" in message:
            return self._convert_end_game(message)
        return None

    def _convert_helo(self, message: dict) -> list[dict] | None:
        return None

    def _convert_rejoin(self, message: dict) -> list[dict] | None:
        return None

    def _convert_go(self, message: dict) -> list[dict] | None:
        return None

    def _convert_start_game(self, message: dict) -> list[dict] | None:
        # message['oya'] is dealer's relative seat to the player
        # Get the player's absolute seat
        mjai_messages = [{"type": "start_game", "id": 0}]
        self.state.seat = (4 - int(message["oya"])) % 4
        mjai_messages[0]["id"] = self.state.seat

        return mjai_messages

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
        kyoku = seed[0] % 4 + 1
        honba = seed[1]
        kyotaku = seed[2]
        dora_marker = tenhou_to_mjai_one(seed[5])
        scores = [int(s) * 100 for s in message["ten"].split(",")]
        tehais = [["?" for _ in range(13)]] * 4
        tehais[self.state.seat] = tenhou_to_mjai(self.state.hand)

        if bakaze == "E" and kyoku == 1 and honba == 0:
            if 0 in scores:
                self.state.is_3p = True
        if self.state.is_3p:
            new_scores = [-1, -1, -1, -1]
            for i in range(4):
                new_scores[self.rel_to_abs(i)] = scores[i]
            scores = new_scores

        mjai_messages = [
            {
                "type": "start_kyoku",
                "bakaze": bakaze,
                "kyoku": kyoku,
                "honba": honba,
                "kyotaku": kyotaku,
                "oya": oya,
                "dora_marker": dora_marker,
                "scores": scores,
                "tehais": tehais,
            }
        ]

        return mjai_messages

    def _convert_tsumo(self, message: dict) -> list[dict] | None:
        self.state.live_wall -= 1

        tag = message["tag"]
        actor = self.rel_to_abs(ord(tag[0]) - ord("T"))
        possible_actions = []

        mjai_messages = [
            {
                "type": "tsumo",
                "actor": actor,
                "pai": "?",
                # 'possible_actions': possible_actions
            }
        ]

        if actor == self.state.seat:
            index = int(tag[1:])
            mjai_messages[0]["pai"] = tenhou_to_mjai_one(index)
            # t = int(message.get('t', 0))

            self.state.hand.append(index)
            self.state.is_tsumo = True

            # if t & 16:
            #     possible_actions.append({'type': 'hora'})

            # if t & 32:
            #     possible_actions.append({'type': 'reach'})

            # if t & 64:
            #     possible_actions.append({'type': 'ryukyoku'})

            # for consumed in self.consumed_ankan(self.state):
            #     possible_actions.append({
            #         'type': 'ankan',
            #         'actor': 0,
            #         'consumed': consumed,
            #     })

            # for pai_consumed in self.consumed_kakan(self.state):
            #     possible_actions.append({
            #         'type': 'kakan',
            #         'actor': 0,
            #         'pai': pai_consumed[0],
            #         'consumed': pai_consumed[1:],
            #     })
            return mjai_messages
        else:
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
        # possible_actions = []

        mjai_messages = [
            {
                "type": "dahai",
                "actor": actor,
                "pai": pai,
                "tsumogiri": tsumogiri,
                # 'possible_actions': possible_actions
            }
        ]

        self.state.is_tsumo = False
        if actor == self.state.seat:
            self.state.hand.remove(index)

        # t = int(message.get('t', 0))

        # if t & 1:
        #     for consumed in self.consumed_pon(self.state, index):
        #         possible_actions.append({
        #             'type': 'pon',
        #             'actor': 0,
        #             'target': actor,
        #             'pai': pai,
        #             'consumed': consumed,
        #         })

        # if t & 2:
        #     for consumed in self.consumed_kan(self.state, index):
        #         possible_actions.append({
        #             'type': 'daiminkan',
        #             'actor': 0,
        #             'target': actor,
        #             'pai': pai,
        #             'consumed': consumed,
        #         })

        # if t & 4:
        #     for consumed in self.consumed_chi(self.state, index):
        #         possible_actions.append({
        #             'type': 'chi',
        #             'actor': 0,
        #             'target': actor,
        #             'pai': pai,
        #             'consumed': consumed,
        #         })

        # if t & 8:
        #     possible_actions.append({'type': 'hora'})

        return mjai_messages

    def _convert_meld(self, message: dict) -> list[dict] | None:
        actor = self.rel_to_abs(int(message["who"]))
        m = int(message["m"])
        if (m & 0x3F) == 0x20:
            # nukidora
            mjai_messages = [{"type": "nukidora", "actor": actor, "pai": "N"}]
            if actor == self.state.seat:
                for i in self.state.hand:
                    if i // 4 == 30:
                        self.state.hand.remove(i)
                        break
            return mjai_messages
        meld = Meld.parse_meld(m)
        if meld.meld_type == Meld.CHI:
            target = (actor - 1) % 4
        else:
            target = (actor + meld.target) % 4

        mjai_messages = [
            {"type": meld.meld_type, "actor": actor, "target": target, "pai": meld.pai, "consumed": meld.consumed}
        ]

        if meld.meld_type in [Meld.KAKAN, Meld.ANKAN]:
            del mjai_messages[0]["target"]
        if meld.meld_type == Meld.ANKAN:
            del mjai_messages[0]["pai"]

        if actor == self.state.seat:
            # mjai_messages[0]['cannot_dahai'] = self.cannot_dahai_meld(meld, self.state)

            for i in meld.exposed:
                self.state.hand.remove(i)

            self.state.melds.append(meld)

        return mjai_messages

    def _convert_reach(self, message: dict) -> list[dict] | None:
        actor = self.rel_to_abs(int(message["who"]))
        mjai_messages = [{"type": "reach", "actor": actor}]

        if actor == self.state.seat:
            # mjai_messages[0]['cannot_dahai'] = self.cannot_dahai_reach(self.state)
            return mjai_messages
        else:
            return mjai_messages

    def _convert_reach_accepted(self, message: dict) -> list[dict] | None:
        if self.rel_to_abs(int(message["who"])) == self.state.seat:
            self.state.in_riichi = True
            self.state.wait = isrh(to_34_array(self.state.hand))

        actor = self.rel_to_abs(int(message["who"]))
        deltas = [0] * 4
        deltas[actor] = -1000
        scores = [int(s) * 100 for s in message["ten"].split(",")]

        mjai_messages = [{"type": "reach_accepted", "actor": actor, "deltas": deltas, "scores": scores}]

        return mjai_messages

    def _convert_dora(self, message: dict) -> list[dict] | None:
        hai = int(message["hai"])
        dora_marker = tenhou_to_mjai_one(hai)
        mjai_messages = [{"type": "dora", "dora_marker": dora_marker}]

        return mjai_messages

    def _convert_hora(self, message: dict) -> list[dict] | None:
        scores = parse_sc_tag(message)
        # Rotate scores to the player's seat
        scores = scores[-self.state.seat :] + scores[: -self.state.seat]
        mjai_messages = [
            # {'type': 'hora', 'scores': scores},
            {"type": "end_kyoku"}
        ]

        return mjai_messages

    def _convert_ryukyoku(self, message: dict) -> list[dict] | None:
        scores = parse_sc_tag(message)
        mjai_messages = [{"type": "ryukyoku", "scores": scores}, {"type": "end_kyoku"}]

        return mjai_messages

    def _convert_end_game(self, message: dict) -> list[dict] | None:
        # scores = parse_sc_tag(message)
        # mjai_messages = []

        # if message['tag'] == 'AGARI':
        #     mjai_messages.append({'type': 'hora', 'scores': scores})
        # else:
        #     mjai_messages.append({'type': 'ryukyoku', 'scores': scores})

        # mjai_messages.append({'type': 'end_kyoku'})
        # scores = parse_owari_tag(message)
        # mjai_messages.append({'type': 'end_game', 'scores': scores})

        mjai_messages = []
        mjai_messages.append({"type": "end_game"})

        return mjai_messages

    def rel_to_abs(self, rel: int) -> int:
        return (rel + self.state.seat) % 4

    def abs_to_rel(self, abs: int) -> int:
        return (abs - self.state.seat) % 4

    def consumed_ankan(self, state: State) -> set[tuple[str, str, str, str]]:
        ret = set()

        if state.live_wall <= 0:
            return ret

        hand34 = to_34_array(state.hand)

        if state.in_riichi:
            # 待ちが変わらない場合のみ可, 送り槓不可
            i = state.hand[-1] // 4

            if hand34[i] == 4:
                hand34[i] -= 4

                if state.wait == isrh(hand34):
                    ret.add(tuple(tenhou_to_mjai([4 * i, 4 * i + 1, 4 * i + 2, 4 * i + 3])))

            return ret
        else:
            for i in range(34):
                if hand34[i] == 4:
                    ret.add(tuple(tenhou_to_mjai([4 * i, 4 * i + 1, 4 * i + 2, 4 * i + 3])))

            return ret

    def consumed_kakan(self, state: State) -> set[tuple[str, str, str, str]]:
        ret = set()

        if state.live_wall <= 0:
            return ret

        for i in state.hand:
            for meld in state.melds:
                if meld.meld_type == Meld.PON and i // 4 == meld.tiles[0] // 4:
                    ret.add(tuple(tenhou_to_mjai([i] + meld.tiles)))

        return ret

    def consumed_pon(self, state: State, index: int) -> set[tuple[str, str]]:
        ret = set()

        for i, j in list(combinations(state.hand, 2)):
            if i // 4 == j // 4 == index // 4:
                ret.add(tuple(tenhou_to_mjai([i, j])))

        return ret

    def consumed_chi(self, state: State, index: int) -> set[tuple[str, str]]:
        ret = set()

        for i, j in list(permutations(state.hand, 2)):
            i34, j34, index34 = i // 4, j // 4, index // 4

            if i34 // 9 == j34 // 9 == index34 // 9:
                if index34 == i34 - 1 == j34 - 2 or i34 + 1 == index34 == j34 - 1 or i34 + 2 == j34 + 1 == index34:
                    ret.add(tuple(tenhou_to_mjai([i, j])))

        return ret

    def consumed_kan(self, state: State, index: int) -> set[tuple[str, str, str]]:
        indices = [i for i in state.hand if i // 4 == index // 4]
        assert len(indices) == 3
        return {tuple(tenhou_to_mjai(indices))}

    def cannot_dahai_meld(self, meld: Meld, state: State) -> list[str]:
        if meld.meld_type == Meld.PON and meld.unused in state.hand:
            return tenhou_to_mjai([meld.unused])
        elif meld.meld_type == Meld.CHI:
            forbidden = [i for i in state.hand if i // 4 == meld.tiles[0] // 4]

            if meld.r == 0 and meld.tiles[0] // 4 // 9 < 6:
                forbidden.extend([i for i in state.hand if i // 4 == meld.tiles[0] // 4 + 3])
            elif meld.r == 2 and meld.tiles[0] // 4 // 9 > 2:
                forbidden.extend([i for i in state.hand if i // 4 == meld.tiles[0] // 4 - 3])

            return list(set(tenhou_to_mjai(forbidden)))
        else:
            return []

    def cannot_dahai_reach(self, state: State) -> list[str]:
        forbidden = []
        hand34 = to_34_array(state.hand)

        for index in state.hand:
            index34 = index // 4

            if hand34[index34] > 0:
                hand34[index34] -= 1

                if not isrh(hand34):
                    forbidden.append(index)

                hand34[index34] += 1

        return list(set(tenhou_to_mjai(forbidden)))

    # ============================================================

    def build(self, mjai_msg: dict) -> None | bytes:
        logger.debug("composing mjai_msg: %s", mjai_msg)
        tenhou_msg = {}
        if mjai_msg["type"] == "dahai":
            # 打牌
            p = mjai_to_tenhou_one(self.state, mjai_msg["pai"], mjai_msg["tsumogiri"])
            logger.debug("p: %s", p)
            tenhou_msg = {"tag": "D", "p": p}
        elif mjai_msg["type"] == "hora":
            if self.state.is_tsumo:
                # 自摸
                tenhou_msg = {"tag": "T", "type": 7}
            else:
                # ロン
                tenhou_msg = {"tag": "N", "type": 6}
        elif mjai_msg["type"] == "reach":
            # 立直
            tenhou_msg = {"tag": "REACH"}
        elif mjai_msg["type"] == "ryukyoku":
            # 九種九牌
            tenhou_msg = {"tag": "N", "type": 9}
        elif mjai_msg["type"] == "ankan":
            # 暗槓
            hai = mjai_to_tenhou_one(self.state, mjai_msg["consumed"][0]) // 4 * 4
            tenhou_msg = {"tag": "N", "type": 4, "hai": hai}
        elif mjai_msg["type"] == "kakan":
            # 加槓
            hai = mjai_to_tenhou_one(self.state, mjai_msg["pai"])
            tenhou_msg = {"tag": "N", "type": 5, "hai": hai}
        elif mjai_msg["type"] == "pon":
            hai0, hai1 = mjai_to_tenhou(self.state, mjai_msg["consumed"])
            tenhou_msg = {"tag": "N", "type": 1, "hai0": hai0, "hai1": hai1}
        elif mjai_msg["type"] == "daiminkan":
            tenhou_msg = {"tag": "N", "type": 2}
        elif mjai_msg["type"] == "chi":
            hai0, hai1 = mjai_to_tenhou(self.state, mjai_msg["consumed"])
            tenhou_msg = {"tag": "N", "type": 3, "hai0": hai0, "hai1": hai1}
        elif mjai_msg["type"] == "nukidora":
            tenhou_msg = {"tag": "N", "type": 10}
        elif mjai_msg["type"] == "none":
            # t != 0
            tenhou_msg = {"tag": "N"}
        else:
            return None
        return json.dumps(tenhou_msg).encode("utf-8")

    def get_pai_index(self, mjai_msg: dict) -> int:
        logger.debug("mjai_msg: %s", mjai_msg)
        if mjai_msg["type"] == "dahai":
            if mjai_msg["tsumogiri"]:
                return len(self.state.hand) - 1
            else:
                hand = deepcopy(self.state.hand)
                logger.debug("hand: %s", hand)
                if self.state.is_tsumo:
                    hand.remove(self.state.hand[-1])
                logger.debug("hand: %s", hand)
                hand.sort()
                logger.debug("hand: %s", hand)
                hand = tenhou_to_mjai(hand)
                logger.debug("hand: %s", hand)
                return hand.index(mjai_msg["pai"])

    def get_chi_index(self, mjai_msg: dict) -> int:
        if mjai_msg["type"] != "chi":
            return
        chi_pai = mjai_msg["pai"]
        if chi_pai[-1] == "r":
            chi_pai = chi_pai[:-1]
        hand = deepcopy(self.state.hand)
        hand.sort()
        mjai_hand = tenhou_to_mjai(hand)

        meta = mjai_msg["meta"]
        action = meta[0][0]
        can_chi_low = any([m[0] == "chi_low" for m in meta])
        can_chi_mid = any([m[0] == "chi_mid" for m in meta])
        can_chi_high = any([m[0] == "chi_high" for m in meta])

        chi_idx = 0
        if action == "chi_high":
            return chi_idx
        if can_chi_high:
            chi_idx += 1
            if chi_pai[0] in ["6", "7"]:
                chi_pai_type = chi_pai[1]
                if f"5{chi_pai_type}r" in mjai_hand:
                    chi_idx += 1

        if action == "chi_mid":
            return chi_idx
        if can_chi_mid:
            chi_idx += 1
            if chi_pai[0] in ["4", "6"]:
                chi_pai_type = chi_pai[1]
                if f"5{chi_pai_type}r" in mjai_hand:
                    chi_idx += 1

        if action == "chi_low":
            return chi_idx
        if can_chi_low:
            chi_idx += 1
            if chi_pai[0] in ["3", "4"]:
                chi_pai_type = chi_pai[1]
                if f"5{chi_pai_type}r" in mjai_hand:
                    chi_idx += 1

        return chi_idx
