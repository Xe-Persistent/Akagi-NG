from typing import Any

import numpy as np

from akagi_ng.mjai_bot.logger import logger

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
    "chi",
    "chi",
    "chi",
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


def meta_to_recommend(meta: dict, is_3p=False, temperature=1.0) -> list[Any]:
    # """
    # {
    #     "q_values":[
    #         -9.09196,
    #         -9.46696,
    #         -8.365397,
    #         -8.849772,
    #         -9.43571,
    #         -10.06071,
    #         -9.295085,
    #         -0.73649096,
    #         -9.27946,
    #         -9.357585,
    #         0.3221028,
    #         -2.7794597
    #     ],
    #     "mask_bits":2697207348,
    #     "is_greedy":true,
    #     "eval_time_ns":357088300
    # }
    # """

    recommend = []

    mask_unicode = mask_unicode_3p if is_3p else mask_unicode_4p

    def mask_bits_to_binary_string(mask_bits):
        binary_string = bin(mask_bits)[2:]
        binary_string = binary_string.zfill(len(mask_unicode))
        return binary_string

    def mask_bits_to_bool_list(mask_bits):
        binary_string = mask_bits_to_binary_string(mask_bits)
        bool_list = []
        for bit in binary_string[::-1]:
            bool_list.append(bit == "1")
        return bool_list

    def eq(left, right):
        # Check for approximate equality using numpy's floating-point epsilon
        return np.abs(left - right) <= np.finfo(float).eps

    def softmax(arr, temperature=1.0):
        arr = np.array(arr, dtype=float)  # Ensure the input is a numpy array of floats

        if arr.size == 0:
            return arr  # Return the empty array if input is empty

        if not eq(temperature, 1.0):
            arr /= temperature  # Scale by temperature if temperature is not approximately 1

        # Shift values by max for numerical stability
        max_val = np.max(arr)
        arr = arr - max_val

        # Apply the softmax transformation
        exp_arr = np.exp(arr)
        sum_exp = np.sum(exp_arr)

        softmax_arr = exp_arr / sum_exp

        return softmax_arr

    def scale_list(input_list, temp):
        scaled_list = softmax(input_list, temperature=temp)
        return scaled_list

    q_values = meta["q_values"]
    mask_bits = meta["mask_bits"]
    mask = mask_bits_to_bool_list(mask_bits)
    scaled_q_values = scale_list(q_values, temperature)
    q_value_idx = 0
    for i in range(len(mask_unicode)):
        if mask[i]:
            recommend.append((mask_unicode[i], scaled_q_values[q_value_idx]))
            q_value_idx += 1

    recommend = sorted(recommend, key=lambda x: x[1], reverse=True)
    return recommend


def is_riichi_relevant(engine, player_id, event, is_3p=False):
    """
    Determines if the 'meta' field should be included in the response based on Riichi relevance.
    Relevant if:
    1. 'reach' is a legal action in the current state.
    2. The current event is a 'reach' declaration by the bot itself.
    """
    if not (engine and engine.last_inference_result):
        return False

    mask_unicode_list = mask_unicode_3p if is_3p else mask_unicode_4p

    # Check if Riichi possible
    masks = engine.last_inference_result.get("masks")
    if masks:
        current_mask = masks[0]
        try:
            reach_index = mask_unicode_list.index("reach")
            if len(current_mask) > reach_index and current_mask[reach_index]:
                return True
        except ValueError:
            logger.warning("'reach' not found in mask_unicode_list")

    return False
