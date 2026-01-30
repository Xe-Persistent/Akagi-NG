from __future__ import annotations

from akagi_ng.bridge.tenhou.utils.judwin import islh, issp, isto

MAX_TILE_COUNT = 4


def isrh(h: list[int]) -> set[int]:
    ret = set()

    for i in range(34):
        if h[i] < MAX_TILE_COUNT:
            h[i] += 1

            if islh(h) or issp(h) or isto(h):
                ret.add(i)

            h[i] -= 1

    return ret
