from unittest.mock import MagicMock

from akagi_ng.dataserver.adapter import _handle_chi_fuuro, build_dataserver_payload
from akagi_ng.mjai_bot import StateTrackerBot
from akagi_ng.mjai_bot.utils import meta_to_recommend


def test_chi_differentiation():
    # 模拟模型输出：chi_l, chi_m, chi_r 都有不同的置信度
    # 假设 action_space=46, chi_l/m/r 在 38, 39, 40
    q_values = [0.0] * 46
    q_values[38] = 2.0  # chi_low
    q_values[39] = 1.0  # chi_mid
    q_values[40] = 0.5  # chi_high

    # mask 允许这三个动作
    mask_bits = (1 << 38) | (1 << 39) | (1 << 40)

    meta = {
        "q_values": q_values,
        "mask_bits": mask_bits,
    }

    recs = meta_to_recommend(meta, is_3p=False)

    # 验证 recs 中的 label 是否为 chi_low, chi_mid, chi_high 且 confidence 不同
    labels = [r[0] for r in recs]
    assert "chi_low" in labels
    assert "chi_mid" in labels
    assert "chi_high" in labels

    # 置信度排序应为 chi_low > chi_mid > chi_high
    assert recs[0][0] == "chi_low"
    assert recs[1][0] == "chi_mid"
    assert recs[2][0] == "chi_high"
    assert recs[0][1] > recs[1][1] > recs[2][1]


def test_chi_adapter_filtering():
    # 模拟 Bot 状态：上家打 3m，手牌有 1m2m, 2m4m, 4m5m
    bot = MagicMock(spec=StateTrackerBot)
    bot.is_3p = False
    bot.last_kawa_tile = "3m"
    # find_chi_candidates 返回所有可能
    bot.find_chi_candidates.return_value = [
        {"consumed": ["1m", "2m"]},  # chi_high (discard 3, eat 3 with 12)
        {"consumed": ["2m", "4m"]},  # chi_mid (discard 3, eat 3 with 24)
        {"consumed": ["4m", "5m"]},  # chi_low (discard 3, eat 3 with 45)
    ]

    # 测试过滤
    res_low = _handle_chi_fuuro(bot, "3m", chi_type="chi_low")
    assert len(res_low) == 1
    assert res_low[0]["consumed"] == ["4m", "5m"]

    res_mid = _handle_chi_fuuro(bot, "3m", chi_type="chi_mid")
    assert len(res_mid) == 1
    assert res_mid[0]["consumed"] == ["2m", "4m"]

    res_high = _handle_chi_fuuro(bot, "3m", chi_type="chi_high")
    assert len(res_high) == 1
    assert res_high[0]["consumed"] == ["1m", "2m"]


def test_full_payload_chi():
    bot = MagicMock(spec=StateTrackerBot)
    bot.is_3p = False
    bot.last_kawa_tile = "3m"
    bot.find_chi_candidates.return_value = [
        {"consumed": ["1m", "2m"]},
        {"consumed": ["2m", "4m"]},
        {"consumed": ["4m", "5m"]},
    ]

    q_values = [0.0] * 46
    q_values[38] = 2.0  # chi_low
    q_values[39] = 1.0  # chi_mid
    q_values[40] = 0.5  # chi_high
    mask_bits = (1 << 38) | (1 << 39) | (1 << 40)

    mjai_response = {
        "meta": {
            "q_values": q_values,
            "mask_bits": mask_bits,
        }
    }

    payload = build_dataserver_payload(mjai_response, bot)
    recs = payload["recommendations"]

    assert len(recs) == 3
    # 验证 action 都变回了 "chi"，但 consumed 不同且顺序正确
    assert recs[0]["action"] == "chi"
    assert recs[0]["consumed"] == ["4m", "5m"]

    assert recs[1]["action"] == "chi"
    assert recs[1]["consumed"] == ["2m", "4m"]

    assert recs[2]["action"] == "chi"
    assert recs[2]["consumed"] == ["1m", "2m"]

    # 验证置信度是降序的
    assert recs[0]["confidence"] > recs[1]["confidence"] > recs[2]["confidence"]
