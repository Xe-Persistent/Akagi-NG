from typing import Any

from akagi_ng.dataserver.logger import logger
from akagi_ng.mjai_bot.utils import meta_to_recommend
from akagi_ng.settings import local_settings


def _get_fuuro_details(action: str, bot: Any) -> list[dict[str, Any]]:
    """
    获取副露（吃、碰、杠）所需的详细信息（牌张和消耗牌）。
    使用 mjai.Bot 原生方法而非手动逻辑。
    返回列表，因为某些操作（如暗杠）可能有多个候选。
    """
    results = []
    last_kawa = getattr(bot, "last_kawa_tile", None)

    try:
        # 1. Handle Chi
        if action == "chi":
            if not last_kawa:
                return []
            candidates = bot.find_chi_candidates()

            for cand in candidates:
                consumed = cand.get("consumed", [])
                if len(consumed) != 2:
                    continue
                results.append({"tile": last_kawa, "consumed": consumed})

            # 回退：未找到候选但有 last_kawa
            if not results and last_kawa:
                results.append({"tile": last_kawa, "consumed": []})

        # 2. Handle Pon
        elif action == "pon":
            if not last_kawa:
                return []
            candidates = bot.find_pon_candidates()
            # 通常只有一种碰，取第一个即可
            if candidates:
                results.append({"tile": last_kawa, "consumed": candidates[0].get("consumed", [])})
            else:
                # 回退：模型想碰但规则引擎说没有合适的手牌？仍然显示以免 UI 异常
                results.append({"tile": last_kawa, "consumed": []})

        # 3. Handle Kan (Kan_Select)
        elif action == "kan_select":
            # 优先级 1：大明杠（开杠）
            daiminkan_candidates = bot.find_daiminkan_candidates()
            if daiminkan_candidates and last_kawa:
                # 大明杠优先（不能在对手出牌时暗杠/加杠）
                for cand in daiminkan_candidates:
                    results.append({"tile": last_kawa, "consumed": cand.get("consumed", [])})
                return results
            elif last_kawa:
                # 有 last_kawa 可能是大明杠机会
                pass

            # 优先级 2：暗杠和加杠（都在自己回合发生）
            ankan_candidates = bot.find_ankan_candidates()
            for cand in ankan_candidates:
                consumed = cand.get("consumed", [])
                results.append({"tile": consumed[0] if consumed else "?", "consumed": consumed})

            kakan_candidates = bot.find_kakan_candidates()
            for cand in kakan_candidates:
                consumed = cand.get("consumed", [])
                results.append({"tile": consumed[0] if consumed else "?", "consumed": consumed})

    except AttributeError:
        # Bot 不支持副露详细方法
        logger.debug("Bot object missing find_candidate methods")
    except Exception as e:
        logger.warning(f"Error getting fuuro details: {e}")

    return results


def _process_standard_recommendations(meta: dict[str, Any], bot: Any) -> list[dict[str, Any]]:
    """处理标准推荐（q_values）"""
    recommendations: list[dict[str, Any]] = []
    if "q_values" not in meta or "mask_bits" not in meta:
        return recommendations

    top3_recommendations = meta_to_recommend(meta, bot.is_3p, temperature=local_settings.model_config.temperature)[:3]
    for action, confidence in top3_recommendations:
        base_item: dict[str, Any] = {
            "action": action,
            "confidence": float(confidence),
        }

        # 获取副露详情
        fuuro_details_list = _get_fuuro_details(action, bot)

        if fuuro_details_list:
            # 如果有具体详情（如多个杠），展开
            for detail in fuuro_details_list:
                new_item = base_item.copy()
                new_item.update(detail)
                recommendations.append(new_item)
        else:
            # 无副露详情，只添加基本项

            # 特殊处理 'hora'
            if action == "hora":
                if getattr(bot, "can_tsumo_agari", False):
                    # 情况 A：自摸
                    base_item["action"] = "tsumo"
                    tsumo_tile = getattr(bot, "last_self_tsumo", None)
                    if tsumo_tile:
                        base_item["tile"] = tsumo_tile
                    elif hasattr(bot, "tehai") and bot.tehai:
                        base_item["tile"] = bot.tehai[-1]
                else:
                    # 情况 B：荣和
                    base_item["action"] = "ron"
                    last_kawa = getattr(bot, "last_kawa_tile", None)
                    if last_kawa:
                        base_item["tile"] = last_kawa

            elif action == "nukidora":
                # 拔北
                base_item["tile"] = "N"

            recommendations.append(base_item)

    return recommendations


def _attach_riichi_lookahead(recommendations: list[dict[str, Any]], meta: dict[str, Any], bot: Any) -> None:
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
            if valid_riichi_discards is not None and action not in valid_riichi_discards:
                continue

            sim_candidates.append({"tile": action, "confidence": float(conf)})

            if len(sim_candidates) >= 5:
                break

        if sim_candidates:
            for item in recommendations:
                if item["action"] == "reach":
                    item["sim_candidates"] = sim_candidates
                    break

    except Exception as e:
        logger.warning(f"Error attaching riichi lookahead: {e}")


def build_dataserver_payload(mjai_response: dict[str, Any], bot: Any) -> dict[str, Any] | None:
    """构建发送到 DataServer 的 Payload"""
    try:
        if bot is None:
            return None

        meta = mjai_response.get("meta")
        if not meta:
            return None

        # 1. Generate Standard Recommendations
        recommendations = _process_standard_recommendations(meta, bot)

        # 2. Attach Riichi Lookahead info if applicable
        _attach_riichi_lookahead(recommendations, meta, bot)

        if recommendations:
            logger.debug(f"Recommendations: {recommendations}")

        return {
            "recommendations": recommendations,
            "is_riichi": getattr(bot, "self_riichi_accepted", False) if bot else False,
        }

    except Exception as e:
        # 防止前端适配器崩溃
        logger.error(f"Failed to build payload: {e}")
        return None
