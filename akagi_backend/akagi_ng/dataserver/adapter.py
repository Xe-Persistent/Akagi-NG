from __future__ import annotations

from akagi_ng.core.constants import MahjongConstants
from akagi_ng.dataserver.logger import logger
from akagi_ng.mjai_bot import StateTrackerBot
from akagi_ng.mjai_bot.utils import meta_to_recommend
from akagi_ng.settings import local_settings


def _handle_chi_fuuro(
    bot: StateTrackerBot, last_kawa: str | None, chi_type: str | None = None
) -> list[dict[str, object]]:
    """处理吃的副露详情，支持根据位置（左、中、右）过滤"""
    if not last_kawa:
        return []

    results = []
    try:
        candidates = bot.find_chi_candidates()
        for cand in candidates:
            consumed = cand.get("consumed", [])
            if len(consumed) != MahjongConstants.CHI_CONSUMED:
                continue

            # 如果指定了 chi_type，则进行过滤
            if chi_type:
                from akagi_ng.mjai_bot.utils import decode_tile

                last_val = decode_tile(last_kawa)[0]
                c1_val = decode_tile(consumed[0])[0]
                c2_val = decode_tile(consumed[1])[0]
                all_vals = sorted([last_val, c1_val, c2_val])

                if chi_type == "chi_low" and last_val != all_vals[0]:
                    continue
                if chi_type == "chi_mid" and last_val != all_vals[1]:
                    continue
                if chi_type == "chi_high" and last_val != all_vals[2]:
                    continue

            results.append({"tile": last_kawa, "consumed": consumed})

        # 回退:未找到候选且未指定 chi_type 但有 last_kawa
        if not results and not chi_type:
            results.append({"tile": last_kawa, "consumed": []})
    except (AttributeError, Exception) as e:
        logger.warning(f"Error in chi fuuro: {e}")

    return results


def _handle_pon_fuuro(bot: StateTrackerBot, last_kawa: str | None) -> list[dict[str, object]]:
    """处理碰的副露详情"""
    if not last_kawa:
        return []

    results = []
    try:
        candidates = bot.find_pon_candidates()
        if candidates:
            results.append({"tile": last_kawa, "consumed": candidates[0].get("consumed", [])})
        else:
            # 回退
            results.append({"tile": last_kawa, "consumed": []})
    except (AttributeError, Exception) as e:
        logger.warning(f"Error in pon fuuro: {e}")

    return results


def _handle_kan_fuuro(bot: StateTrackerBot, last_kawa: str | None) -> list[dict[str, object]]:
    """处理杠的副露详情(大明杠/暗杠/加杠)"""
    results = []

    try:
        # 优先级1: 大明杠
        daiminkan_candidates = bot.find_daiminkan_candidates()
        if daiminkan_candidates and last_kawa:
            for cand in daiminkan_candidates:
                results.append({"tile": last_kawa, "consumed": cand.get("consumed", [])})
            return results

        # 优先级2: 暗杠和加杠
        ankan_candidates = bot.find_ankan_candidates()
        for cand in ankan_candidates:
            consumed = cand.get("consumed", [])
            results.append({"tile": consumed[0] if consumed else "?", "consumed": consumed})

        kakan_candidates = bot.find_kakan_candidates()
        for cand in kakan_candidates:
            consumed = cand.get("consumed", [])
            results.append({"tile": consumed[0] if consumed else "?", "consumed": consumed})
    except (AttributeError, Exception) as e:
        logger.warning(f"Error in kan fuuro: {e}")

    return results


def _get_fuuro_details(action: str, bot: StateTrackerBot) -> list[dict[str, object]]:
    """
    获取副露(吃、碰、杠)所需的详细信息(牌张和消耗牌)。
    使用 mjai.Bot 原生方法而非手动逻辑。
    返回列表,因为某些操作(如暗杠)可能有多个候选。
    """
    last_kawa = getattr(bot, "last_kawa_tile", None)

    if action in ["chi", "chi_low", "chi_mid", "chi_high"]:
        chi_type = action if action.startswith("chi_") else None
        return _handle_chi_fuuro(bot, last_kawa, chi_type=chi_type)
    if action == "pon":
        return _handle_pon_fuuro(bot, last_kawa)
    if action == "kan":
        return _handle_kan_fuuro(bot, last_kawa)

    return []


def _handle_hora_action(base_item: dict[str, object], bot: StateTrackerBot):
    """处理和牌(hora)动作的特殊逻辑"""
    if getattr(bot, "can_tsumo_agari", False):
        # 情况A: 自摸
        base_item["action"] = "tsumo"
        tsumo_tile = getattr(bot, "last_self_tsumo", None)
        if tsumo_tile:
            base_item["tile"] = tsumo_tile
        elif hasattr(bot, "tehai") and bot.tehai:
            base_item["tile"] = bot.tehai[-1]
    else:
        # 情况B: 荣和
        base_item["action"] = "ron"
        last_kawa = getattr(bot, "last_kawa_tile", None)
        if last_kawa:
            base_item["tile"] = last_kawa


def _process_standard_recommendations(meta: dict[str, object], bot: StateTrackerBot) -> list[dict[str, object]]:
    """处理标准推荐(q_values)"""
    recommendations: list[dict[str, object]] = []
    if "q_values" not in meta or "mask_bits" not in meta:
        return recommendations

    top3_recommendations = meta_to_recommend(meta, bot.is_3p, temperature=local_settings.model_config.temperature)[:3]
    for action, confidence in top3_recommendations:
        if action == "kan_select":
            action = "kan"

        base_item: dict[str, object] = {
            "action": action,
            "confidence": float(confidence),
        }

        if action.startswith("chi_"):
            base_item["action"] = "chi"

        # 获取副露详情
        fuuro_details_list = _get_fuuro_details(action, bot)

        if fuuro_details_list:
            # 如果有具体详情(如多个杠),展开
            for detail in fuuro_details_list:
                new_item = base_item.copy()
                new_item.update(detail)
                recommendations.append(new_item)
        else:
            # 无副露详情,只添加基本项
            # 特殊处理和牌和拔北
            if action == "hora":
                _handle_hora_action(base_item, bot)
            elif action == "nukidora":
                base_item["tile"] = "N"

            recommendations.append(base_item)

    return recommendations


def _attach_riichi_lookahead(recommendations: list[dict[str, object]], meta: dict[str, object], bot: StateTrackerBot):
    """为 reach 推荐附加立直前瞻候选"""
    riichi_lookahead = meta.get("riichi_lookahead")
    if not riichi_lookahead:
        return

    try:
        lookahead_recs = meta_to_recommend(
            riichi_lookahead,
            bot.is_3p,
            temperature=local_settings.model_config.temperature,
        )
        if not lookahead_recs:
            return

        valid_riichi_discards = getattr(bot, "discardable_tiles_riichi_declaration", None)
        sim_candidates = []

        for action, conf in lookahead_recs:
            if valid_riichi_discards and action not in valid_riichi_discards:
                continue

            sim_candidates.append({"tile": action, "confidence": float(conf)})

            if len(sim_candidates) >= MahjongConstants.MIN_RIICHI_CANDIDATES:
                break

        if sim_candidates:
            for item in recommendations:
                if item["action"] == "reach":
                    item["sim_candidates"] = sim_candidates
                    break

    except Exception as e:
        logger.warning(f"Error attaching riichi lookahead: {e}")


def build_dataserver_payload(mjai_response: dict[str, object], bot: StateTrackerBot) -> dict[str, object] | None:
    """构建发送到 DataServer 的 Payload"""
    try:
        if bot is None:
            return None

        meta = mjai_response.get("meta")
        if not meta:
            return None

        # 1. Generate Standard Recommendations
        recommendations = _process_standard_recommendations(meta, bot)

        # 2. 如果适用，附加立直前瞻信息
        _attach_riichi_lookahead(recommendations, meta, bot)

        # 3. 如果已立直，过滤掉无需显示的推荐（只保留和牌、暗杠、流局等）
        if getattr(bot, "self_riichi_accepted", False):
            # 立直后只显示: 暗杠(kan), 自摸(tsumo), 荣和(ron), 流局(ryukyoku), 拔北(nukidora)
            # 注意: 这里的 'kan' 包含了暗杠候选
            allow_actions = {"kan", "tsumo", "ron", "ryukyoku", "nukidora"}
            recommendations = [rec for rec in recommendations if rec["action"] in allow_actions]

        if recommendations:
            logger.debug(f"Recommendations: {recommendations}")

        return {
            "recommendations": recommendations,
            "engine_type": meta.get("engine_type"),
            "is_fallback": meta.get("is_fallback"),
            "circuit_open": meta.get("circuit_open"),
        }

    except Exception as e:
        logger.error(f"Failed to build payload: {e}")
        return None
