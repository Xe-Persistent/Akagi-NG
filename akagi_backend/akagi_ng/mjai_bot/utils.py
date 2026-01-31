import numpy as np


def decode_tile(tile: str) -> tuple[int, str]:
    """
    解码 MJAI 牌代码为 (数值, 类型)。
    例如: "1m" -> (1, "m"), "5pr" -> (5, "p"), "E" -> (1, "z")
    """
    if not tile:
        return 0, ""

    # 字牌特殊处理
    z_map = {"E": 1, "S": 2, "W": 3, "N": 4, "P": 5, "F": 6, "C": 7}
    if tile in z_map:
        return z_map[tile], "z"

    # 数牌处理
    try:
        val_str = tile[0]
        type_str = tile[1]
        return int(val_str), type_str
    except (ValueError, IndexError):
        return 0, ""


def make_error_response(error_code: str) -> dict:
    """
    构造统一格式的错误响应。

    Args:
        error_code: 错误代码,如 "json_decode_error", "no_bot_loaded" 等

    Returns:
        标准格式的错误响应字典: {"type": "none", "error": error_code}
    """
    return {"type": "none", "error": error_code}


mask_unicode_4p = [
    "1m",
    "2m",
    "3m",
    "4m",
    "5m",
    "6m",
    "7m",
    "8m",
    "9m",
    "1p",
    "2p",
    "3p",
    "4p",
    "5p",
    "6p",
    "7p",
    "8p",
    "9p",
    "1s",
    "2s",
    "3s",
    "4s",
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
    "5mr",
    "5pr",
    "5sr",
    "reach",
    "chi_low",
    "chi_mid",
    "chi_high",
    "pon",
    "kan_select",
    "hora",
    "ryukyoku",
    "none",
]

mask_unicode_3p = [
    "1m",
    "2m",
    "3m",
    "4m",
    "5m",
    "6m",
    "7m",
    "8m",
    "9m",
    "1p",
    "2p",
    "3p",
    "4p",
    "5p",
    "6p",
    "7p",
    "8p",
    "9p",
    "1s",
    "2s",
    "3s",
    "4s",
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
    "5mr",
    "5pr",
    "5sr",
    "reach",
    "pon",
    "kan_select",
    "nukidora",
    "hora",
    "ryukyoku",
    "none",
]


def _is_approximately_equal(left: float, right: float) -> bool:
    """检查两个浮点数是否近似相等"""
    return np.abs(left - right) <= np.finfo(float).eps


def _softmax(arr: list[float] | np.ndarray, temperature: float = 1.0) -> np.ndarray:
    """应用 softmax 变换到数组"""
    arr = np.array(arr, dtype=float)

    if arr.size == 0:
        return arr

    if not _is_approximately_equal(temperature, 1.0):
        arr /= temperature

    # 平移值以确保数值稳定性
    max_val = np.max(arr)
    arr = arr - max_val

    # 应用 softmax 变换
    exp_arr = np.exp(arr)
    sum_exp = np.sum(exp_arr)

    return exp_arr / sum_exp


def meta_to_recommend(meta: dict, is_3p: bool = False, temperature: float = 1.0) -> list[tuple[str, float]]:
    """
    ExampleMeta:
    {
        "q_values":[
            -9.09196,
            -9.46696,
            -8.365397,
            -8.849772,
            -9.43571,
            -10.06071,
            -9.295085,
            -0.73649096,
            -9.27946,
            -9.357585,
            0.3221028,
            -2.7794597
        ],
        "mask_bits":2697207348,
        "is_greedy":true,
        "eval_time_ns":357088300
    }
    """

    recommend = []

    mask_unicode = mask_unicode_3p if is_3p else mask_unicode_4p

    def mask_bits_to_binary_string(mask_bits: int) -> str:
        binary_string = bin(mask_bits)[2:]
        return binary_string.zfill(len(mask_unicode))

    def mask_bits_to_bool_list(mask_bits: int) -> list[bool]:
        binary_string = mask_bits_to_binary_string(mask_bits)
        bool_list = []
        for bit in binary_string[::-1]:
            bool_list.append(bit == "1")
        return bool_list

    q_values = meta["q_values"]
    mask_bits = meta["mask_bits"]
    mask = mask_bits_to_bool_list(mask_bits)
    scaled_q_values = _softmax(q_values, temperature)

    is_full_space = len(q_values) == len(mask_unicode)
    q_value_idx = 0

    for i in range(len(mask_unicode)):
        if mask[i]:
            confidence = scaled_q_values[i] if is_full_space else scaled_q_values[q_value_idx]
            recommend.append((mask_unicode[i], confidence))
            if not is_full_space:
                q_value_idx += 1

    return sorted(recommend, key=lambda x: x[1], reverse=True)
