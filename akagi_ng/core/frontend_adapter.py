from __future__ import annotations

from typing import Any

from core.libriichi_helper import meta_to_recommend


def _get_fuuro_details(action: str, bot: Any) -> dict[str, Any] | None:
    """
    辅助函数：根据动作类型，获取副露所需的详细信息 (tile 和 consumed)。
    使用 mjai.Bot 原生方法 (find_chi_candidates, find_pon_candidates) 替代手写逻辑。
    """
    last_kawa = getattr(bot, "last_kawa_tile", None)
    if not last_kawa:
        return None

    # Helper to parse tile number
    def get_tile_num(t):
        return int(t[0]) if t and t[0].isdigit() else 0

    try:
        # 1. 处理吃 (Chi)
        if action in ("chi_low", "chi_mid", "chi_high"):
            candidates = bot.find_chi_candidates()
            target_num = get_tile_num(last_kawa)

            for cand in candidates:
                consumed = cand.get("consumed", [])
                if len(consumed) != 2:
                    continue

                c1, c2 = get_tile_num(consumed[0]), get_tile_num(consumed[1])
                # Determine type based on numerical relationship
                # Low: consumed > target (e.g. target 3, consume 4,5)
                # High: consumed < target (e.g. target 3, consume 1,2)
                # Mid: target in between (e.g. target 3, consume 2,4)

                is_low = c1 > target_num and c2 > target_num
                is_high = c1 < target_num and c2 < target_num
                is_mid = not is_low and not is_high

                if action == "chi_low" and is_low:
                    return {"tile": last_kawa, "consumed": consumed}
                if action == "chi_high" and is_high:
                    return {"tile": last_kawa, "consumed": consumed}
                if action == "chi_mid" and is_mid:
                    return {"tile": last_kawa, "consumed": consumed}

        # 2. 处理碰 (Pon)
        elif action == "pon":
            candidates = bot.find_pon_candidates()
            if candidates:
                # Default to the first candidate. 
                # Ideally could let user select if multiple ways to Pon exist (e.g. with Red 5), 
                # but for recommendation display, showing valid one is sufficient.
                return {
                    "tile": last_kawa,
                    "consumed": candidates[0].get("consumed", [])
                }

        # 3. 处理杠 (Kan_Select)
        elif action == "kan_select":
            # Priority 1: Daiminkan (Open Kan)
            # Typically happens on opponent's discard (last_kawa).
            candidates = bot.find_daiminkan_candidates()
            if candidates:
                return {
                    "tile": last_kawa,
                    "consumed": candidates[0].get("consumed", [])
                }

            # Priority 2: Ankan (Closed Kan)
            # Happens on self turn. Consumed = 4 tiles from hand.
            candidates = bot.find_ankan_candidates()
            if candidates:
                # Ankan doesn't have a "target" tile from discard, but we need to show what is being Kan'ed.
                # Usually we return one of the consumed tiles as 'tile' for display purposes, 
                # or rely on consumed list. 
                # For consistency with frontend (shows consumed), we return the consumed list.
                consumed = candidates[0].get("consumed", [])
                return {
                    "tile": consumed[0] if consumed else "?",
                    "consumed": consumed
                }

            # Priority 3: Kakan (Added Kan / Shouminkan)
            # Happens on self turn, adds to existing Pon.
            candidates = bot.find_kakan_candidates()
            if candidates:
                consumed = candidates[0].get("consumed", [])
                return {
                    "tile": consumed[0] if consumed else "?",
                    "consumed": consumed
                }

    except AttributeError:
        pass
    except Exception as e:
        pass

    return None


def _process_standard_recommendations(meta: dict[str, Any], bot: Any) -> list[dict[str, Any]]:
    """Processing standard recommendations (q_values)."""
    recommendations: list[dict[str, Any]] = []
    if "q_values" not in meta or "mask_bits" not in meta:
        return recommendations

    top3_recommendations = meta_to_recommend(meta, bot.is_3p)[:3]
    for action, confidence in top3_recommendations:
        item: dict[str, Any] = {
            "action": action,
            "confidence": float(confidence),
        }
        # Get fuuro details
        fuuro_details = _get_fuuro_details(action, bot)
        if fuuro_details:
            item.update(fuuro_details)

        # Hora -> Tsumo special handling
        if action == 'hora' and getattr(bot, 'can_tsumo_agari', False):
            item['action'] = 'tsumo'
            tsumo_tile = getattr(bot, 'last_self_tsumo', None)
            if tsumo_tile:
                item['tile'] = tsumo_tile
            elif hasattr(bot, 'tehai') and bot.tehai:
                item['tile'] = bot.tehai[-1]

        recommendations.append(item)

    return recommendations


def _attach_riichi_lookahead(recommendations: list[dict[str, Any]], meta: dict[str, Any], bot: Any) -> None:
    """Attach riichi lookahead candidates to the 'reach' recommendation."""
    riichi_lookahead = meta.get("riichi_lookahead")
    if not riichi_lookahead:
        return

    try:
        lookahead_recs = meta_to_recommend(riichi_lookahead, bot.is_3p)
        if not lookahead_recs:
            return

        valid_riichi_discards = getattr(bot, "discardable_tiles_riichi_declaration", None)
        sim_candidates = []

        for action, conf in lookahead_recs:
            if valid_riichi_discards is not None and action not in valid_riichi_discards:
                continue

            sim_candidates.append({
                "tile": action,
                "confidence": float(conf)
            })

            if len(sim_candidates) >= 5:
                break

        if sim_candidates:
            for item in recommendations:
                if item["action"] == "reach":
                    item["sim_candidates"] = sim_candidates
                    break

    except Exception:
        pass


def build_dataserver_payload(mjai_response: dict[str, Any], bot: Any) -> dict[str, Any] | None:
    """
    主函数：构建发送给 DataServer 的 Payload。
    """
    if bot is None:
        return None

    meta = mjai_response.get("meta") or {}

    # 1. Generate Standard Recommendations
    recommendations = _process_standard_recommendations(meta, bot)

    # 2. Attach Riichi Lookahead info if applicable
    _attach_riichi_lookahead(recommendations, meta, bot)

    tehai = list(getattr(bot, "tehai_mjai", []) or [])
    is_riichi_declaration = meta.get("is_riichi_declaration", False)

    return {
        "recommendations": recommendations,
        "tehai": tehai,
        "is_riichi_declaration": is_riichi_declaration
    }
