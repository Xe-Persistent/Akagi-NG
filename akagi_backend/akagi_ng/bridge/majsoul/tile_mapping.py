"""麻将牌映射配置

雀魂(Majsoul)和MJAI格式之间的牌面映射。
"""

# 雀魂 -> MJAI 牌面映射
MS_TILE_2_MJAI_TILE = {
    "0m": "5mr",
    "1m": "1m",
    "2m": "2m",
    "3m": "3m",
    "4m": "4m",
    "5m": "5m",
    "6m": "6m",
    "7m": "7m",
    "8m": "8m",
    "9m": "9m",
    "0p": "5pr",
    "1p": "1p",
    "2p": "2p",
    "3p": "3p",
    "4p": "4p",
    "5p": "5p",
    "6p": "6p",
    "7p": "7p",
    "8p": "8p",
    "9p": "9p",
    "0s": "5sr",
    "1s": "1s",
    "2s": "2s",
    "3s": "3s",
    "4s": "4s",
    "5s": "5s",
    "6s": "6s",
    "7s": "7s",
    "8s": "8s",
    "9s": "9s",
    "1z": "E",
    "2z": "S",
    "3z": "W",
    "4z": "N",
    "5z": "P",
    "6z": "F",
    "7z": "C",
}

# 自动生成的反向映射: MJAI -> 雀魂
MJAI_TILE_2_MS_TILE = {v: k for k, v in MS_TILE_2_MJAI_TILE.items()}

# 牌的排序优先级(用于手牌排序)
PAI_ORDER = [
    "1m",
    "2m",
    "3m",
    "4m",
    "5mr",
    "5m",
    "6m",
    "7m",
    "8m",
    "9m",
    "1p",
    "2p",
    "3p",
    "4p",
    "5pr",
    "5p",
    "6p",
    "7p",
    "8p",
    "9p",
    "1s",
    "2s",
    "3s",
    "4s",
    "5sr",
    "5s",
    "6s",
    "7s",
    "8s",
    "9s",
    "E",
    "S",
    "W",
    "N",
    "P",
    "F",
    "C",
    "?",
]


# 优化排序查找字典
PAI_ORDER_INDEX = {pai: i for i, pai in enumerate(PAI_ORDER)}


def get_pai_sort_key(pai: str) -> int:
    """获取牌的排序索引（用于 list.sort(key=...)）"""
    return PAI_ORDER_INDEX.get(pai, 999)


def compare_pai(pai1: str, pai2: str) -> int:
    """
    比较两张牌的大小,用于排序。

    返回值:
        -1: pai1 < pai2
         0: pai1 == pai2
         1: pai1 > pai2
    """
    idx1 = PAI_ORDER_INDEX.get(pai1, 999)
    idx2 = PAI_ORDER_INDEX.get(pai2, 999)

    if idx1 > idx2:
        return 1
    if idx1 == idx2:
        return 0
    return -1
