from __future__ import annotations

from typing import Any

from akagi_ng.dataserver.logger import logger
from akagi_ng.mjai_bot.utils import meta_to_recommend
from akagi_ng.settings import local_settings


def _get_fuuro_details(action: str, bot: Any) -> list[dict[str, Any]]:
    """
    Helper function: Get detailed information (tile and consumed) required for 'fuuro' (meld) based on the action type.
    Uses mjai.Bot native methods (find_chi_candidates, find_pon_candidates) instead of manual logic.
    Returns a list because some actions (like Ankan) might have multiple candidates.
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

            # Fallback if no specific candidates found but we have last_kawa
            if not results and last_kawa:
                results.append({"tile": last_kawa, "consumed": []})

        # 2. Handle Pon
        elif action == "pon":
            if not last_kawa:
                return []
            candidates = bot.find_pon_candidates()
            # Usually only one Pon is possible (or semantically same), but if multiple (e.g. Red 5),
            # we currently just take the first one or we could add all.
            # Ideally we pick the best one or show all.
            # Let's show the first one for now to keep it simple unless requested.
            if candidates:
                results.append({"tile": last_kawa, "consumed": candidates[0].get("consumed", [])})
            else:
                # Fallback: Model wants to Pon but rule engine says no suitable hand tiles?
                # Show the tile anyway so UI doesn't look broken.
                results.append({"tile": last_kawa, "consumed": []})

        # 3. Handle Kan (Kan_Select)
        elif action == "kan_select":
            # Priority 1: Daiminkan (Open Kan)
            # Typically happens on opponent's discard.
            daiminkan_candidates = bot.find_daiminkan_candidates()
            if daiminkan_candidates and last_kawa:
                # If Daiminkan is possible, it takes precedence (cannot Ankan/Kakan on opponent discard)
                for cand in daiminkan_candidates:
                    results.append({"tile": last_kawa, "consumed": cand.get("consumed", [])})
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
                results.append({"tile": consumed[0] if consumed else "?", "consumed": consumed})

            kakan_candidates = bot.find_kakan_candidates()
            for cand in kakan_candidates:
                consumed = cand.get("consumed", [])
                results.append({"tile": consumed[0] if consumed else "?", "consumed": consumed})

    except AttributeError:
        # Bot does not support fuuro detail methods
        logger.debug("Bot object missing find_candidate methods")
    except Exception as e:
        logger.warning(f"Error getting fuuro details: {e}")

    return results


def _process_standard_recommendations(meta: dict[str, Any], bot: Any) -> list[dict[str, Any]]:
    """Processing standard recommendations (q_values)."""
    recommendations: list[dict[str, Any]] = []
    if "q_values" not in meta or "mask_bits" not in meta:
        return recommendations

    top3_recommendations = meta_to_recommend(meta, bot.is_3p, temperature=local_settings.model_config.temperature)[:3]
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
            if action == "hora" and getattr(bot, "can_tsumo_agari", False):
                base_item["action"] = "tsumo"
                tsumo_tile = getattr(bot, "last_self_tsumo", None)
                if tsumo_tile:
                    base_item["tile"] = tsumo_tile
                elif hasattr(bot, "tehai") and bot.tehai:
                    base_item["tile"] = bot.tehai[-1]

            recommendations.append(base_item)

    return recommendations


def _attach_riichi_lookahead(recommendations: list[dict[str, Any]], meta: dict[str, Any], bot: Any) -> None:
    """Attach riichi lookahead candidates to the 'reach' recommendation."""
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
    """
    Main function: Build the Payload to send to DataServer.
    """
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

        tehai = list(getattr(bot, "tehai_mjai", []) or [])

        return {"recommendations": recommendations, "tehai": tehai}

    except Exception as e:
        # Prevent crash if frontend adapter fails (e.g. data shape mismatch)
        logger.error(f"Failed to build payload: {e}")
        return None
