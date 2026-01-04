from __future__ import annotations

from typing import Any

from core.libriichi_helper import meta_to_recommend


def _get_fuuro_details(action: str, bot: Any) -> list[dict[str, Any]]:
    """
    辅助函数：根据动作类型，获取副露所需的详细信息 (tile 和 consumed)。
    使用 mjai.Bot 原生方法 (find_chi_candidates, find_pon_candidates) 替代手写逻辑。
    返回列表，因为某些动作（如暗杠）可能有多个候选项。
    """
    results = []
    last_kawa = getattr(bot, "last_kawa_tile", None)

    # Helper to parse tile number
    def get_tile_num(t):
        return int(t[0]) if t and t[0].isdigit() else 0

    try:
        # 1. 处理吃 (Chi)
        if action in ("chi_low", "chi_mid", "chi_high"):
            if not last_kawa:
                return []
            candidates = bot.find_chi_candidates()
            target_num = get_tile_num(last_kawa)

            for cand in candidates:
                consumed = cand.get("consumed", [])
                if len(consumed) != 2:
                    continue

                c1, c2 = get_tile_num(consumed[0]), get_tile_num(consumed[1])
                # Determine type based on numerical relationship
                is_low = c1 > target_num and c2 > target_num
                is_high = c1 < target_num and c2 < target_num
                is_mid = not is_low and not is_high

                if action == "chi_low" and is_low:
                    results.append({"tile": last_kawa, "consumed": consumed})
                elif action == "chi_high" and is_high:
                    results.append({"tile": last_kawa, "consumed": consumed})
                elif action == "chi_mid" and is_mid:
                    results.append({"tile": last_kawa, "consumed": consumed})

            # Fallback if no specific candidates found but we have last_kawa
            if not results and last_kawa:
                results.append({"tile": last_kawa, "consumed": []})

        # 2. 处理碰 (Pon)
        elif action == "pon":
            if not last_kawa:
                return []
            candidates = bot.find_pon_candidates()
            # Usually only one Pon is possible (or semantically same), but if multiple (e.g. Red 5),
            # we currently just take the first one or we could add all.
            # Ideally we pick the best one or show all. Let's show the first one for now to keep it simple unless requested.
            if candidates:
                results.append({
                    "tile": last_kawa,
                    "consumed": candidates[0].get("consumed", [])
                })
            else:
                # Fallback: Model wants to Pon but rule engine says no suitable hand tiles?
                # Show the tile anyway so UI doesn't look broken.
                results.append({"tile": last_kawa, "consumed": []})

        # 3. 处理杠 (Kan_Select)
        elif action == "kan_select":
            # Priority 1: Daiminkan (Open Kan)
            # Typically happens on opponent's discard.
            daiminkan_candidates = bot.find_daiminkan_candidates()
            if daiminkan_candidates and last_kawa:
                # If Daiminkan is possible, it takes precedence (cannot Ankan/Kakan on opponent discard)
                for cand in daiminkan_candidates:
                    results.append({
                        "tile": last_kawa,
                        "consumed": cand.get("consumed", [])
                    })
                return results
            elif last_kawa:
                # Check if this is a Daiminkan situation (not self turn)
                # Ideally we should check turn but we can just append a fallback for Daiminkan if we have last_kawa
                # However, Kan Select is tricky because it could be Ankan/Kakan.
                # If we have last_kawa, it's likely Daiminkan opportunity.
                pass

            # Priority 2: Ankan (Closed Kan) & Kakan (Added Kan)
            # Both can happen on self turn.
            ankan_candidates = bot.find_ankan_candidates()
            for cand in ankan_candidates:
                consumed = cand.get("consumed", [])
                results.append({
                    "tile": consumed[0] if consumed else "?",
                    "consumed": consumed
                })

            kakan_candidates = bot.find_kakan_candidates()
            for cand in kakan_candidates:
                consumed = cand.get("consumed", [])
                results.append({
                    "tile": consumed[0] if consumed else "?",
                    "consumed": consumed
                })

    except AttributeError:
        pass
    except Exception as e:
        # In production we might want to log this
        pass

    return results


def _process_standard_recommendations(meta: dict[str, Any], bot: Any) -> list[dict[str, Any]]:
    """Processing standard recommendations (q_values)."""
    recommendations: list[dict[str, Any]] = []
    if "q_values" not in meta or "mask_bits" not in meta:
        return recommendations

    top3_recommendations = meta_to_recommend(meta, bot.is_3p)[:3]
    for action, confidence in top3_recommendations:
        base_item: dict[str, Any] = {
            "action": action,
            "confidence": float(confidence),
        }

        # Get fuuro details (list)
        fuuro_details_list = _get_fuuro_details(action, bot)

        if fuuro_details_list:
            # If we have specific details (e.g. multiple Kans), expand them
            for detail in fuuro_details_list:
                new_item = base_item.copy()
                new_item.update(detail)
                recommendations.append(new_item)
        else:
            # No fuuro details (e.g. simple discard, or no candidates found for action)
            # Just add the base item

            # Hora -> Tsumo special handling
            if action == 'hora' and getattr(bot, 'can_tsumo_agari', False):
                base_item['action'] = 'tsumo'
                tsumo_tile = getattr(bot, 'last_self_tsumo', None)
                if tsumo_tile:
                    base_item['tile'] = tsumo_tile
                elif hasattr(bot, 'tehai') and bot.tehai:
                    base_item['tile'] = bot.tehai[-1]

            recommendations.append(base_item)

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

    meta = mjai_response.get("meta")
    if not meta:
        return None

    # 1. Generate Standard Recommendations
    recommendations = _process_standard_recommendations(meta, bot)

    # 2. Attach Riichi Lookahead info if applicable
    _attach_riichi_lookahead(recommendations, meta, bot)

    tehai = list(getattr(bot, "tehai_mjai", []) or [])

    return {
        "recommendations": recommendations,
        "tehai": tehai
    }
