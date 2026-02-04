# http://tenhou.net/img/tehai.js
# http://tenhou.net/img/mentsu136.txt
from enum import StrEnum

from akagi_ng.bridge.tenhou.utils.converter import tenhou_to_mjai


class MeldType(StrEnum):
    CHI = "chi"
    PON = "pon"
    KAKAN = "kakan"
    DAIMINKAN = "daiminkan"
    ANKAN = "ankan"


class Meld:
    def __init__(
        self, target: int, meld_type: MeldType, tiles: list[int], unused: int | None = None, r: int | None = None
    ):
        self.target: int = target
        self.meld_type: MeldType = meld_type
        self.tiles: list[int] = tiles
        self.unused: int | None = unused
        self.r: int | None = r

    @property
    def pai(self) -> str:
        return tenhou_to_mjai([self.tiles[0]])[0]

    @property
    def consumed(self) -> list[str]:
        if self.meld_type == MeldType.ANKAN:
            return tenhou_to_mjai(self.tiles)
        return tenhou_to_mjai(self.tiles[1:])

    @property
    def exposed(self) -> list[int]:
        if self.meld_type == MeldType.ANKAN:
            return self.tiles
        if self.meld_type == MeldType.KAKAN:
            return self.tiles[0:1]
        return self.tiles[1:]

    @staticmethod
    def parse_meld(m: int) -> "Meld":
        if m & (1 << 2):
            # チー
            return Meld.parse_chi(m)
        if m & (1 << 3):
            # ポン
            return Meld.parse_pon(m)
        if m & (1 << 4):
            # 加槓
            return Meld.parse_kakan(m)
        # 大明槓, 暗槓
        return Meld.parse_daiminkan_ankan(m)

    @staticmethod
    def parse_chi(m: int) -> "Meld":
        t = m >> 10
        r = t % 3
        t //= 3
        t = t // 7 * 9 + t % 7
        t *= 4
        h = [
            t + 4 * 0 + ((m >> 3) & 0x3),
            t + 4 * 1 + ((m >> 5) & 0x3),
            t + 4 * 2 + ((m >> 7) & 0x3),
        ]
        h[0], h[r] = h[r], h[0]
        return Meld(m & 3, MeldType.CHI, h, r=r)

    @staticmethod
    def parse_pon(m: int) -> "Meld":
        unused = (m >> 5) & 0x3
        t = m >> 9
        r = t % 3
        t = t // 3 * 4
        h = [t, t + 1, t + 2, t + 3]
        unused = h.pop(unused)
        h[0], h[r] = h[r], h[0]
        return Meld(m & 3, MeldType.PON, h, unused=unused)

    @staticmethod
    def parse_kakan(m: int) -> "Meld":
        added = (m >> 5) & 0x3
        t = m >> 9
        r = t % 3
        t = t // 3 * 4
        h = [t, t + 1, t + 2, t + 3]
        added = h.pop(added)
        h[0], h[r] = h[r], h[0]
        h = [added, *h]
        return Meld(m & 3, MeldType.KAKAN, h)

    @staticmethod
    def parse_daiminkan_ankan(m: int) -> "Meld":
        target = m & 3
        hai0 = m >> 8
        t = hai0 // 4 * 4
        r = hai0 % 4
        h = [t, t + 1, t + 2, t + 3]
        h[0], h[r] = h[r], h[0]

        if target == 0:
            return Meld(target, MeldType.ANKAN, h)
        return Meld(target, MeldType.DAIMINKAN, h)


def parse_sc_tag(message: dict[str, str]) -> list[int]:
    sc = [int(s) for s in message["sc"].split(",")]
    before = sc[0::2]
    delta = sc[1::2]
    return [(x + y) * 100 for x, y in zip(before, delta, strict=False)]


def parse_owari_tag(message: dict[str, str]) -> list[int]:
    sc = [int(s) for s in message["owari"].split(",")[0::2]]
    return [x * 100 for x in sc]
