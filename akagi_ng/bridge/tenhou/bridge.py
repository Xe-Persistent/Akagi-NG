import json
import re
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
from akagi_ng.core.constants import MahjongConstants


class TenhouConstants:
    """天凤协议常量"""

    TILES_PER_TYPE = 4  # 每种牌的数量

    # Logic constants
    TILES_PER_SUIT = 9
    CHI_OFFSET = 3
    MAGIC_LIMIT_6 = 6
    MAGIC_LIMIT_2 = 2
    PEI_INDEX = 30
    BIT_MASK_M = 0x3F
    BIT_NUKIDORA = 0x20

    # N type values
    TYPE_PON = 1
    TYPE_DAIMINKAN = 2
    TYPE_CHI = 3
    TYPE_ANKAN = 4
    TYPE_KAKAN = 5
    TYPE_RON = 6
    TYPE_TSUMO = 7
    TYPE_RYUKYOKU = 9
    TYPE_NUKIDORA = 10


class TenhouBridge(BaseBridge):
    def __init__(self) -> None:
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
        解析内容并返回 MJAI 指令。

        Args:
            content (bytes): 待解析的内容。

        Returns:
            None | list[dict]: MJAI 指令。

        Tenhou 消息格式:
                <SHUFFLE>
         - seed         用于生成牌墙和骰子的随机数种子。
         - ref          ?
        <GO>            游戏开始
         - type             大厅类型。
         - lobby            大厅编号。
        <UN>            用户列表或用户重连
         - n[0-3]           每个玩家的名称 (URLEncoded UTF-8)。
         - dan              每个玩家的段位。
         - rate             每个玩家的 Rate。
         - sx               每个玩家的性别 ("M" 或 "F")。
        <BYE>           用户断开连接
         - who              断开连接的玩家。
        <TAIKYOKU>      对局开始
         - oya              庄家
        <INIT>          开局 (配牌)
         - seed             6 个元素的列表:
                                局数,
                                本场数,
                                立直棒数,
                                骰子1减一,
                                骰子2减一,
                                宝牌指示牌。
         - ten              每个玩家的点数列表
         - oya              庄家
         - hai[0-3]         每个玩家的配牌列表。
        <[T-W][0-9]*>   玩家摸牌。
        <[D-G][0-9]*>   玩家切牌。
        <N>             玩家鸣牌。
         - who              鸣牌的玩家。
         - m                副露数据。
        <REACH>         玩家立直。
         - who              立直的玩家
         - step             立直步骤:
                                1 -> 宣言 "立直"
                                2 -> 切牌后放置立直棒。
         - ten              每个玩家的当前点数列表。
        <DORA>          新宝牌指示牌。
         - hai              新的宝牌指示牌。
        <AGARI>         玩家和牌
         - who              和牌的玩家。
         - fromwho          谁点的炮: 自摸则是自己, 荣和则是别人。
         - hai              赢家的手牌列表。
         - m                赢家的副露列表。
         - machi            赢家的听牌列表。
         - doraHai          宝牌列表。
         - dorahaiUra       里宝牌列表。
         - yaku             役及其番数列表。
                                    0 -> 门前清自摸和
                                    1 -> 立直
                                    2 -> 一发
                                    3 -> 枪杠
                                    4 -> 岭上开花
                                    5 -> 海底摸月
                                    6 -> 河底捞鱼
                                    7 -> 平和
                                    8 -> 断幺九
                                    9 -> 一杯口
                                10-17 -> 翻牌 (自风/场风/三元牌)
                                18-20 -> 役牌
                                   21 -> 双立直
                                   22 -> 七对子
                                   23 -> 混全带幺九
                                   24 -> 一气通贯
                                   25 -> 三色同顺
                                   26 -> 三色同刻
                                   27 -> 三杠子
                                   28 -> 对对和
                                   29 -> 三暗刻
                                   30 -> 小三元
                                   31 -> 混老头
                                   32 -> 二杯口
                                   33 -> 纯全带幺九
                                   34 -> 混一色
                                   35 -> 清一色
                                   52 -> 宝牌
                                   53 -> 里宝牌
                                   54 -> 红宝牌
         - yakuman          役满列表。
                                   36 -> 人和
                                   37 -> 天和
                                   38 -> 地和
                                   39 -> 大三元
                                40,41 -> 四暗刻 / 四暗刻单骑
                                   42 -> 字一色
                                   43 -> 绿一色
                                   44 -> 清老头
                                45,46 -> 九莲宝灯 / 纯正九莲宝灯
                                47,48 -> 国士无双 / 国士无双十三面待
                                   49 -> 大四喜
                                   50 -> 小四喜
                                   51 -> 四杠子
         - ten              3 个元素的列表:
                                符数,
                                点数,
                                满贯限制:
                                    0 -> 无限制
                                    1 -> 满贯
                                    2 -> 跳满
                                    3 -> 倍满
                                    4 -> 三倍满
                                    5 -> 役满
         - ba               2 个元素的列表 (场棒):
                                本场数,
                                立直棒数。
         - sc               每个玩家的分数及变化列表。
         - owari            游戏结束时的最终分数 (含马点)。
        <RYUUKYOKU>     流局
         - type             流局类型:
                                "yao9"   -> 九种九牌
                                "reach4" -> 四家立直
                                "ron3"   -> 三家和
                                "kan4"   -> 四开杠
                                "kaze4"  -> 四风连打
                                "nm"     -> 流局满贯。
         - hai[0-3]         玩家展示的手牌列表。
         - ba               (同上)
         - sc               (同上)
         - owari            (同上)
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
        mjai_messages = [{"type": "start_game", "id": 0}]
        self.state.seat = (MahjongConstants.SEATS_4P - int(message["oya"])) % MahjongConstants.SEATS_4P
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

        if bakaze == "E" and kyoku == 1 and honba == 0 and 0 in scores:
            self.state.is_3p = True
        if self.state.is_3p:
            new_scores = [-1, -1, -1, -1]
            for i in range(4):
                new_scores[self.rel_to_abs(i)] = scores[i]
            scores = new_scores

        return [
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

    def _convert_tsumo(self, message: dict) -> list[dict] | None:
        self.state.live_wall -= 1

        tag = message["tag"]
        actor = self.rel_to_abs(ord(tag[0]) - ord("T"))

        mjai_messages = [
            {
                "type": "tsumo",
                "actor": actor,
                "pai": "?",
            }
        ]

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

        mjai_messages = [
            {
                "type": "dahai",
                "actor": actor,
                "pai": pai,
                "tsumogiri": tsumogiri,
            }
        ]

        self.state.is_tsumo = False
        if actor == self.state.seat:
            self.state.hand.remove(index)

        return mjai_messages

    def _convert_meld(self, message: dict) -> list[dict] | None:
        actor = self.rel_to_abs(int(message["who"]))
        m = int(message["m"])
        if (m & TenhouConstants.BIT_MASK_M) == TenhouConstants.BIT_NUKIDORA:
            # nukidora
            mjai_messages = [{"type": "nukidora", "actor": actor, "pai": "N"}]
            if actor == self.state.seat:
                for i in self.state.hand:
                    if i // TenhouConstants.TILES_PER_TYPE == TenhouConstants.PEI_INDEX:
                        self.state.hand.remove(i)
                        break
            return mjai_messages
        meld = Meld.parse_meld(m)
        target = (actor - 1) % 4 if meld.meld_type == Meld.CHI else (actor + meld.target) % 4

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
        return mjai_messages

    def _convert_reach_accepted(self, message: dict) -> list[dict] | None:
        if self.rel_to_abs(int(message["who"])) == self.state.seat:
            self.state.in_riichi = True
            self.state.wait = isrh(to_34_array(self.state.hand))

        actor = self.rel_to_abs(int(message["who"]))
        deltas = [0] * 4
        deltas[actor] = -1000
        scores = [int(s) * 100 for s in message["ten"].split(",")]

        return [{"type": "reach_accepted", "actor": actor, "deltas": deltas, "scores": scores}]

    def _convert_dora(self, message: dict) -> list[dict] | None:
        hai = int(message["hai"])
        dora_marker = tenhou_to_mjai_one(hai)
        return [{"type": "dora", "dora_marker": dora_marker}]

    def _convert_hora(self, message: dict) -> list[dict] | None:
        scores = parse_sc_tag(message)
        # Rotate scores to the player's seat
        scores = scores[-self.state.seat :] + scores[: -self.state.seat]
        return [
            # {'type': 'hora', 'scores': scores},
            {"type": "end_kyoku"}
        ]

    def _convert_ryukyoku(self, message: dict) -> list[dict] | None:
        scores = parse_sc_tag(message)
        return [{"type": "ryukyoku", "scores": scores}, {"type": "end_kyoku"}]

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
            i = state.hand[-1] // TenhouConstants.TILES_PER_TYPE

            if hand34[i] == TenhouConstants.TILES_PER_TYPE:
                hand34[i] -= TenhouConstants.TILES_PER_TYPE

                if state.wait == isrh(hand34):
                    ret.add(tuple(tenhou_to_mjai([4 * i, 4 * i + 1, 4 * i + 2, 4 * i + 3])))

            return ret
        for i in range(34):
            if hand34[i] == TenhouConstants.TILES_PER_TYPE:
                ret.add(tuple(tenhou_to_mjai([4 * i, 4 * i + 1, 4 * i + 2, 4 * i + 3])))

        return ret

    def consumed_kakan(self, state: State) -> set[tuple[str, str, str, str]]:
        ret = set()

        if state.live_wall <= 0:
            return ret

        for i in state.hand:
            for meld in state.melds:
                if (
                        meld.meld_type == Meld.PON
                        and i // TenhouConstants.TILES_PER_TYPE == meld.tiles[0] // TenhouConstants.TILES_PER_TYPE
                ):
                    ret.add(tuple(tenhou_to_mjai([i, *meld.tiles])))

        return ret

    def consumed_pon(self, state: State, index: int) -> set[tuple[str, str]]:
        ret = set()

        for i, j in list(combinations(state.hand, 2)):
            if (
                    i // TenhouConstants.TILES_PER_TYPE
                    == j // TenhouConstants.TILES_PER_TYPE
                    == index // TenhouConstants.TILES_PER_TYPE
            ):
                ret.add(tuple(tenhou_to_mjai([i, j])))

        return ret

    def consumed_chi(self, state: State, index: int) -> set[tuple[str, str]]:
        ret = set()

        for i, j in list(permutations(state.hand, 2)):
            i34, j34, index34 = (
                i // TenhouConstants.TILES_PER_TYPE,
                j // TenhouConstants.TILES_PER_TYPE,
                index // TenhouConstants.TILES_PER_TYPE,
            )

            if i34 // 9 == j34 // 9 == index34 // 9 and (
                    index34 == i34 - 1 == j34 - 2 or i34 + 1 == index34 == j34 - 1 or i34 + 2 == j34 + 1 == index34
            ):
                ret.add(tuple(tenhou_to_mjai([i, j])))

        return ret

    def consumed_kan(self, state: State, index: int) -> set[tuple[str, str, str]]:
        indices = [
            i for i in state.hand if i // TenhouConstants.TILES_PER_TYPE == index // TenhouConstants.TILES_PER_TYPE
        ]
        assert len(indices) == MahjongConstants.DAIMINKAN_CONSUMED
        return {tuple(tenhou_to_mjai(indices))}

    def cannot_dahai_meld(self, meld: Meld, state: State) -> list[str]:
        if meld.meld_type == Meld.PON and meld.unused in state.hand:
            return tenhou_to_mjai([meld.unused])
        if meld.meld_type == Meld.CHI:
            forbidden = [
                i
                for i in state.hand
                if i // TenhouConstants.TILES_PER_TYPE == meld.tiles[0] // TenhouConstants.TILES_PER_TYPE
            ]

            if (
                    meld.r == 0
                    and meld.tiles[0] // TenhouConstants.TILES_PER_TYPE // TenhouConstants.TILES_PER_SUIT
                    < TenhouConstants.MAGIC_LIMIT_6
            ):
                forbidden.extend(
                    [
                        i
                        for i in state.hand
                        if i // TenhouConstants.TILES_PER_TYPE
                           == meld.tiles[0] // TenhouConstants.TILES_PER_TYPE + TenhouConstants.CHI_OFFSET
                    ]
                )
            elif (
                    meld.r == TenhouConstants.MAGIC_LIMIT_2
                    and meld.tiles[0] // TenhouConstants.TILES_PER_TYPE // TenhouConstants.TILES_PER_SUIT
                    > TenhouConstants.MAGIC_LIMIT_2
            ):
                forbidden.extend(
                    [
                        i
                        for i in state.hand
                        if i // TenhouConstants.TILES_PER_TYPE
                           == meld.tiles[0] // TenhouConstants.TILES_PER_TYPE - TenhouConstants.CHI_OFFSET
                    ]
                )

            return list(set(tenhou_to_mjai(forbidden)))
        return []

    def cannot_dahai_reach(self, state: State) -> list[str]:
        forbidden = []
        hand34 = to_34_array(state.hand)

        for index in state.hand:
            index34 = index // TenhouConstants.TILES_PER_TYPE

            if hand34[index34] > 0:
                hand34[index34] -= 1

                if not isrh(hand34):
                    forbidden.append(index)

                hand34[index34] += 1

        return list(set(tenhou_to_mjai(forbidden)))

    # ============================================================

    def _build_dahai(self, mjai_msg: dict) -> dict:
        p = mjai_to_tenhou_one(self.state, mjai_msg["pai"], mjai_msg["tsumogiri"])
        logger.debug("p: %s", p)
        return {"tag": "D", "p": p}

    def _build_hora(self, mjai_msg: dict) -> dict:
        return (
            {"tag": "T", "type": TenhouConstants.TYPE_TSUMO}
            if self.state.is_tsumo
            else {"tag": "N", "type": TenhouConstants.TYPE_RON}
        )

    def _build_reach(self, mjai_msg: dict) -> dict:
        return {"tag": "REACH"}

    def _build_ryukyoku(self, mjai_msg: dict) -> dict:
        return {"tag": "N", "type": TenhouConstants.TYPE_RYUKYOKU}

    def _build_ankan(self, mjai_msg: dict) -> dict:
        hai = mjai_to_tenhou_one(self.state, mjai_msg["consumed"][0]) // 4 * 4
        return {"tag": "N", "type": TenhouConstants.TYPE_ANKAN, "hai": hai}

    def _build_kakan(self, mjai_msg: dict) -> dict:
        hai = mjai_to_tenhou_one(self.state, mjai_msg["pai"])
        return {"tag": "N", "type": TenhouConstants.TYPE_KAKAN, "hai": hai}

    def _build_pon(self, mjai_msg: dict) -> dict:
        hai0, hai1 = mjai_to_tenhou(self.state, mjai_msg["consumed"])
        return {"tag": "N", "type": TenhouConstants.TYPE_PON, "hai0": hai0, "hai1": hai1}

    def _build_daiminkan(self, mjai_msg: dict) -> dict:
        return {"tag": "N", "type": TenhouConstants.TYPE_DAIMINKAN}

    def _build_chi(self, mjai_msg: dict) -> dict:
        hai0, hai1 = mjai_to_tenhou(self.state, mjai_msg["consumed"])
        return {"tag": "N", "type": TenhouConstants.TYPE_CHI, "hai0": hai0, "hai1": hai1}

    def _build_nukidora(self, mjai_msg: dict) -> dict:
        return {"tag": "N", "type": TenhouConstants.TYPE_NUKIDORA}

    def _build_none(self, mjai_msg: dict) -> dict:
        return {"tag": "N"}

    def build(self, mjai_msg: dict) -> None | bytes:
        logger.debug("composing mjai_msg: %s", mjai_msg)

        handlers = {
            "dahai": self._build_dahai,
            "hora": self._build_hora,
            "reach": self._build_reach,
            "ryukyoku": self._build_ryukyoku,
            "ankan": self._build_ankan,
            "kakan": self._build_kakan,
            "pon": self._build_pon,
            "daiminkan": self._build_daiminkan,
            "chi": self._build_chi,
            "nukidora": self._build_nukidora,
            "none": self._build_none,
        }

        if handler := handlers.get(mjai_msg["type"]):
            tenhou_msg = handler(mjai_msg)
            return json.dumps(tenhou_msg).encode("utf-8")

        return None
