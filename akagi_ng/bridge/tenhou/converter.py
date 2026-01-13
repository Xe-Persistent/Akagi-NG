import asyncio
import logging
import re
import traceback
from abc import ABCMeta, abstractmethod
from collections.abc import Awaitable, Callable
from itertools import combinations, permutations

import utils
from utils.converter import mjai_to_tenhou, mjai_to_tenhou_one, tenhou_to_mjai, tenhou_to_mjai_one, to_34_array
from utils.decoder import Meld, parse_owari_tag, parse_sc_tag
from utils.judrdy import isrh
from utils.state import State

logger = logging.getLogger(__name__)


class Base(metaclass=ABCMeta):
    async def main(
        self,
        state: State,
        message: dict[str, str],
        send_to_tenhou: Callable[[dict], Awaitable[None]],
        send_to_mjai: Callable[[dict], Awaitable[dict]],
    ):
        if self.target(message):
            try:
                await self.process(state, message, send_to_tenhou, send_to_mjai)
            except Exception as e:
                logger.error(traceback.format_exc())
                raise e

            return True
        else:
            return False

    @abstractmethod
    def target(self, message: dict[str, str]) -> bool:
        return NotImplemented

    @abstractmethod
    async def process(
        self,
        state: State,
        message: dict[str, str],
        send_to_tenhou: Callable[[dict], Awaitable[None]],
        send_to_mjai: Callable[[dict], Awaitable[dict]],
    ) -> None:
        return NotImplemented


class Helo(Base):
    def target(self, message: dict[str, str]) -> bool:
        return message["tag"] == "HELO"

    async def process(
        self,
        state: State,
        message: dict[str, str],
        send_to_tenhou: Callable[[dict], Awaitable[None]],
        send_to_mjai: Callable[[dict], Awaitable[dict]],
    ):
        await send_to_tenhou({"tag": "JOIN", "t": state.room})


class Rejoin(Base):
    def target(self, message: dict[str, str]) -> bool:
        return message["tag"] == "REJOIN"

    async def process(
        self,
        state: State,
        message: dict[str, str],
        send_to_tenhou: Callable[[dict], Awaitable[None]],
        send_to_mjai: Callable[[dict], Awaitable[dict]],
    ):
        t = message["t"]
        await send_to_tenhou({"tag": "JOIN", "t": t})


class Go(Base):
    def target(self, message: dict[str, str]) -> bool:
        return message["tag"] == "GO"

    async def process(
        self,
        state: State,
        message: dict[str, str],
        send_to_tenhou: Callable[[dict], Awaitable[None]],
        send_to_mjai: Callable[[dict], Awaitable[dict]],
    ):
        await send_to_tenhou({"tag": "GOK"})


class Taikyoku(Base):
    def target(self, message: dict[str, str]) -> bool:
        return message["tag"] == "TAIKYOKU"

    async def process(
        self,
        state: State,
        message: dict[str, str],
        send_to_tenhou: Callable[[dict], Awaitable[None]],
        send_to_mjai: Callable[[dict], Awaitable[dict]],
    ):
        sent = {"type": "start_game", "id": 0, "names": []}

        if "log" in message:
            oya = int(message["oya"])
            log = message["log"]
            seat = (4 - oya) % 4
            log_url = "https://tenhou.net/3/?log={}&tw={}".format(log, seat)
            logger.info("log({}): {}".format(state.name, log_url))
            sent["log"] = log_url

        await send_to_mjai(sent)
        await send_to_tenhou({"tag": "NEXTREADY"})


class Init(Base):
    bakaze = ["E", "S", "W", "N"]

    def target(self, message: dict[str, str]) -> bool:
        return message["tag"] == "INIT"

    async def process(
        self,
        state: State,
        message: dict[str, str],
        send_to_tenhou: Callable[[dict], Awaitable[None]],
        send_to_mjai: Callable[[dict], Awaitable[dict]],
    ):
        state.hand = [int(s) for s in message["hai"].split(",")]
        state.in_riichi = False
        state.live_wall = 70
        state.melds.clear()
        state.wait.clear()

        oya = int(message["oya"])
        seed = [int(s) for s in message["seed"].split(",")]
        bakaze = self.bakaze[seed[0] // 4]
        kyoku = seed[0] % 4
        honba = seed[1]
        kyotaku = seed[2]
        dora_marker = tenhou_to_mjai_one(seed[5])
        tehais = [["?" for _ in range(13)]] * 4
        tehais[0] = tenhou_to_mjai(state.hand)

        sent = {
            "type": "start_kyoku",
            "bakaze": bakaze,
            "kyoku": kyoku,
            "honba": honba,
            "kyotaku": kyotaku,
            "oya": oya,
            "dora_marker": dora_marker,
            "tehais": tehais,
        }

        await send_to_mjai(sent)


class Tsumo(Base):
    def target(self, message: dict[str, str]) -> bool:
        return re.match(r"^[TUVW]\d*$", message["tag"])

    async def process(
        self,
        state: State,
        message: dict[str, str],
        send_to_tenhou: Callable[[dict], Awaitable[None]],
        send_to_mjai: Callable[[dict], Awaitable[dict]],
    ):
        state.live_wall -= 1

        tag = message["tag"]
        actor = ord(tag[0]) - ord("T")
        possible_actions = []

        sent = {"type": "tsumo", "actor": actor, "pai": "?", "possible_actions": possible_actions}

        if actor == 0:
            index = int(tag[1:])
            sent["pai"] = tenhou_to_mjai_one(index)
            t = int(message.get("t", 0))

            state.hand.append(index)

            if t & 16:
                possible_actions.append({"type": "hora"})

            if t & 32:
                possible_actions.append({"type": "reach"})

            if t & 64:
                possible_actions.append({"type": "ryukyoku"})

            for consumed in self.consumed_ankan(state):
                possible_actions.append(
                    {
                        "type": "ankan",
                        "actor": 0,
                        "consumed": consumed,
                    }
                )

            for pai_consumed in self.consumed_kakan(state):
                possible_actions.append(
                    {
                        "type": "kakan",
                        "actor": 0,
                        "pai": pai_consumed[0],
                        "consumed": pai_consumed[1:],
                    }
                )

            received = await send_to_mjai(sent)

            if received["type"] == "dahai":
                # 打牌
                p = mjai_to_tenhou_one(state, received["pai"], received["tsumogiri"])

                if not state.in_riichi:
                    await utils.random_sleep(1, 2)

                await send_to_tenhou({"tag": "D", "p": p})
            elif received["type"] == "hora":
                # 自摸
                await utils.random_sleep(1, 2)
                await send_to_tenhou({"tag": "N", "type": 7})
            elif received["type"] == "reach":
                # 立直
                await utils.random_sleep(1, 2)
                await send_to_tenhou({"tag": "REACH"})
            elif received["type"] == "ryukyoku":
                # 九種九牌
                await utils.random_sleep(1, 2)
                await send_to_tenhou({"tag": "N", "type": 9})
            elif received["type"] == "ankan":
                # 暗槓
                await utils.random_sleep(1, 2)
                hai = mjai_to_tenhou_one(state, received["consumed"][0]) // 4 * 4
                await send_to_tenhou({"tag": "N", "type": 4, "hai": hai})
            elif received["type"] == "kakan":
                # 加槓
                await utils.random_sleep(1, 2)
                hai = mjai_to_tenhou_one(state, received["pai"])
                await send_to_tenhou({"tag": "N", "type": 5, "hai": hai})
        else:
            await send_to_mjai(sent)

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


class Dahai(Base):
    def target(self, message: dict[str, str]) -> bool:
        return re.match(r"^[DEFGefg]\d*$", message["tag"])

    async def process(
        self,
        state: State,
        message: dict[str, str],
        send_to_tenhou: Callable[[dict], Awaitable[None]],
        send_to_mjai: Callable[[dict], Awaitable[dict]],
    ):
        tag = message["tag"]
        actor = ord(str.upper(tag[0])) - ord("D")
        index = int(tag[1:])
        pai = tenhou_to_mjai_one(index)
        tsumogiri = str.isupper(tag[0]) if actor != 0 else index == state.hand[-1]
        possible_actions = []

        sent = {
            "type": "dahai",
            "actor": actor,
            "pai": pai,
            "tsumogiri": tsumogiri,
            "possible_actions": possible_actions,
        }

        if actor == 0:
            state.hand.remove(index)

        t = int(message.get("t", 0))

        if t & 1:
            for consumed in self.consumed_pon(state, index):
                possible_actions.append(
                    {
                        "type": "pon",
                        "actor": 0,
                        "target": actor,
                        "pai": pai,
                        "consumed": consumed,
                    }
                )

        if t & 2:
            for consumed in self.consumed_kan(state, index):
                possible_actions.append(
                    {
                        "type": "daiminkan",
                        "actor": 0,
                        "target": actor,
                        "pai": pai,
                        "consumed": consumed,
                    }
                )

        if t & 4:
            for consumed in self.consumed_chi(state, index):
                possible_actions.append(
                    {
                        "type": "chi",
                        "actor": 0,
                        "target": actor,
                        "pai": pai,
                        "consumed": consumed,
                    }
                )

        if t & 8:
            possible_actions.append({"type": "hora"})

        received = await send_to_mjai(sent)

        if received["type"] == "pon":
            hai0, hai1 = mjai_to_tenhou(state, received["consumed"])
            await utils.random_sleep(1, 2)
            await send_to_tenhou({"tag": "N", "type": 1, "hai0": hai0, "hai1": hai1})
        elif received["type"] == "daiminkan":
            await send_to_tenhou({"tag": "N", "type": 2})
            await utils.random_sleep(1, 2)
        elif received["type"] == "chi":
            hai0, hai1 = mjai_to_tenhou(state, received["consumed"])
            await utils.random_sleep(1, 2)
            await send_to_tenhou({"tag": "N", "type": 3, "hai0": hai0, "hai1": hai1})
        elif received["type"] == "hora":
            await utils.random_sleep(1, 2)
            await send_to_tenhou({"tag": "N", "type": 6})
        elif t != 0 and received["type"] == "none":
            await send_to_tenhou({"tag": "N"})

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


class Naki(Base):
    def target(self, message: dict[str, str]) -> bool:
        return message["tag"] == "N" and "m" in message

    async def process(
        self,
        state: State,
        message: dict[str, str],
        send_to_tenhou: Callable[[dict], Awaitable[None]],
        send_to_mjai: Callable[[dict], Awaitable[dict]],
    ):
        actor = int(message["who"])
        m = int(message["m"])
        meld = Meld.parse_meld(m)
        target = (actor + meld.target) % 4

        sent = {"type": meld.meld_type, "actor": actor, "target": target, "pai": meld.pai, "consumed": meld.consumed}

        if actor == 0:
            sent["cannot_dahai"] = self.cannot_dahai(meld, state)

            for i in meld.exposed:
                state.hand.remove(i)

            state.melds.append(meld)

        received = await send_to_mjai(sent)

        if received["type"] == "dahai":
            # 打牌
            p = mjai_to_tenhou_one(state, received["pai"], received["tsumogiri"])
            await utils.random_sleep(1, 2)
            await send_to_tenhou({"tag": "D", "p": p})

    def cannot_dahai(self, meld: Meld, state: State) -> list[str]:
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


class ReachStep1(Base):
    def target(self, message: dict[str, str]) -> bool:
        return message["tag"] == "REACH" and message["step"] == "1"

    async def process(
        self,
        state: State,
        message: dict[str, str],
        send_to_tenhou: Callable[[dict], Awaitable[None]],
        send_to_mjai: Callable[[dict], Awaitable[dict]],
    ):
        actor = int(message["who"])
        sent = {"type": "reach", "actor": actor}

        if actor == 0:
            sent["cannot_dahai"] = self.cannot_dahai(state)
            received = await send_to_mjai(sent)
            p = mjai_to_tenhou_one(state, received["pai"], received["tsumogiri"])
            await utils.random_sleep(1, 2)
            await send_to_tenhou({"tag": "D", "p": p})
        else:
            await send_to_mjai(sent)

    def cannot_dahai(self, state: State) -> list[str]:
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


class ReachStep2(Base):
    def target(self, message: dict[str, str]) -> bool:
        return message["tag"] == "REACH" and message["step"] == "2"

    async def process(
        self,
        state: State,
        message: dict[str, str],
        send_to_tenhou: Callable[[dict], Awaitable[None]],
        send_to_mjai: Callable[[dict], Awaitable[dict]],
    ):
        if int(message["who"]) == 0:
            state.in_riichi = True
            state.wait = isrh(to_34_array(state.hand))

        actor = int(message["who"])
        deltas = [0] * 4
        deltas[actor] = -1000
        scores = [int(s) * 100 for s in message["ten"].split(",")]
        await send_to_mjai({"type": "reach_accepted", "actor": actor, "deltas": deltas, "scores": scores})


class Dora(Base):
    def target(self, message: dict[str, str]) -> bool:
        return message["tag"] == "DORA"

    async def process(
        self,
        state: State,
        message: dict[str, str],
        send_to_tenhou: Callable[[dict], Awaitable[None]],
        send_to_mjai: Callable[[dict], Awaitable[dict]],
    ):
        hai = int(message["hai"])
        dora_marker = tenhou_to_mjai_one(hai)
        await send_to_mjai({"type": "dora", "dora_marker": dora_marker})


class Agari(Base):
    def target(self, message: dict[str, str]) -> bool:
        return message["tag"] == "AGARI" and "owari" not in message

    async def process(
        self,
        state: State,
        message: dict[str, str],
        send_to_tenhou: Callable[[dict], Awaitable[None]],
        send_to_mjai: Callable[[dict], Awaitable[dict]],
    ):
        scores = parse_sc_tag(message)
        await send_to_mjai({"type": "hora", "scores": scores})
        await send_to_mjai({"type": "end_kyoku"})
        await send_to_tenhou({"tag": "NEXTREADY"})


class Ryuukyoku(Base):
    def target(self, message: dict[str, str]) -> bool:
        return message["tag"] == "RYUUKYOKU" and "owari" not in message

    async def process(
        self,
        state: State,
        message: dict[str, str],
        send_to_tenhou: Callable[[dict], Awaitable[None]],
        send_to_mjai: Callable[[dict], Awaitable[dict]],
    ):
        scores = parse_sc_tag(message)
        await send_to_mjai({"type": "ryukyoku", "scores": scores})
        await send_to_mjai({"type": "end_kyoku"})
        await send_to_tenhou({"tag": "NEXTREADY"})


class End(Base):
    def target(self, message: dict[str, str]) -> bool:
        return "owari" in message

    async def process(
        self,
        state: State,
        message: dict[str, str],
        send_to_tenhou: Callable[[dict], Awaitable[None]],
        send_to_mjai: Callable[[dict], Awaitable[dict]],
    ):
        scores = parse_sc_tag(message)

        if message["tag"] == "AGARI":
            await send_to_mjai({"type": "hora", "scores": scores})
        else:
            await send_to_mjai({"type": "ryukyoku", "scores": scores})

        await send_to_mjai({"type": "end_kyoku"})
        scores = parse_owari_tag(message)

        try:
            await send_to_mjai({"type": "end_game", "scores": scores})
        except asyncio.exceptions.IncompleteReadError:
            pass
