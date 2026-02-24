from akagi_ng.schema.constants import MahjongConstants

# 天凤的排序刚好等于标准牌的前 34 张
tiles_mjai = MahjongConstants.BASE_TILES[:34]


def tenhou_to_mjai_one(index: int) -> str:
    return tenhou_to_mjai([index])[0]


def tenhou_to_mjai(indices: list[int]) -> list[str]:
    ret = []

    for index in indices:
        label = tiles_mjai[index // 4]
        ret.append(label + "r" if index in [16, 52, 88] else label)

    return ret


def to_34_array(indices: list[int]) -> list[int]:
    ret = [0] * 34

    for index in indices:
        ret[index // 4] += 1

    return ret
