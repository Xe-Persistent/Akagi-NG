from akagi_ng.bridge.tenhou.utils.judwin import islh, issp, isto


def isrh(h: list[int]) -> set[int]:
    ret = set()

    for i in range(34):
        if h[i] < 4:
            h[i] += 1

            if islh(h) or issp(h) or isto(h):
                ret.add(i)

            h[i] -= 1

    return ret
