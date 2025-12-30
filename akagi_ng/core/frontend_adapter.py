from __future__ import annotations

from typing import Any

from core.libriichi_helper import meta_to_recommend


def _get_fuuro_details(action: str, bot: Any) -> dict[str, Any] | None:
    """
    辅助函数：根据动作类型，获取副露所需的详细信息 (tile 和 consumed)。
    包含 can_* 检查及 Kan 处理。
    """
    last_kawa = getattr(bot, "last_kawa_tile", None)

    # 1. 处理吃 (Chi)
    if action in ("chi_low", "chi_mid", "chi_high"):
        # 如果没有最后打出的牌，无法吃
        if not last_kawa:
            return None

        try:
            chi_candidates = bot.find_chi_candidates_simple()
            fuuro = None

            if action == "chi_low" and bot.can_chi_low:
                fuuro = chi_candidates.chi_low_meld
            elif action == "chi_mid" and bot.can_chi_mid:
                fuuro = chi_candidates.chi_mid_meld
            elif action == "chi_high" and bot.can_chi_high:
                fuuro = chi_candidates.chi_high_meld

            # fuuro (副露) 结构通常是 (tile, consumed_list)
            if fuuro:
                return {"tile": fuuro[0], "consumed": fuuro[1]}
        except Exception:
            return None

    # 2. 处理碰 (Pon)
    elif action == "pon":
        if bot.can_pon and last_kawa:
            return {
                "tile": last_kawa,
                "consumed": [last_kawa[:2]] * 2
            }

    # 3. 处理杠 (Daiminkan / Kan Select)
    elif action == "kan_select":
        # 片段一逻辑：必须同时满足 can_kan, can_daiminkan 且有最后打出的牌
        if bot.can_kan and bot.can_daiminkan and last_kawa:
            return {
                "tile": last_kawa,
                "consumed": [last_kawa[:2]] * 3
            }

    return None


def build_dataserver_payload(mjai_response: dict[str, Any], bot) -> Optional[dict[str, Any]]:
    """
    主函数：构建发送给 DataServer 的 Payload。
    """
    if bot is None:
        return None

    recommendations: list[dict[str, Any]] = []
    tehai = list(getattr(bot, "tehai_mjai", []) or [])
    last_kawa_tile = getattr(bot, "last_kawa_tile", "?") or "?"

    meta = mjai_response.get("meta") or {}
    if "q_values" in meta and "mask_bits" in meta:
        top3_recommendations = meta_to_recommend(meta, bot.is_3p)[:3]
        for action, confidence in top3_recommendations:
            item: dict[str, Any] = {
                "action": action,
                "confidence": float(confidence),
            }
            # 调用辅助函数获取副露详情 (逻辑解耦)
            fuuro_details = _get_fuuro_details(action, bot)
            if fuuro_details:
                item.update(fuuro_details)
            recommendations.append(item)

    if not recommendations:
        recommendations.append({
            "action": mjai_response.get("type", "none"),
            "confidence": 0.0,
        })

    return {
        "recommendations": recommendations,
        "tehai": tehai,
        "last_kawa_tile": last_kawa_tile,
    }
