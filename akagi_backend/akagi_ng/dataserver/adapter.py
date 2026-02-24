from typing import Literal

from akagi_ng.dataserver.logger import logger
from akagi_ng.mjai_bot import StateTracker
from akagi_ng.mjai_bot.utils import meta_to_recommend
from akagi_ng.schema.constants import MahjongConstants
from akagi_ng.schema.notifications import NotificationCode
from akagi_ng.schema.types import (
    FullRecommendationData,
    FuuroDetail,
    MJAIMetadata,
    MJAIResponse,
    Recommendation,
    SimCandidate,
)
from akagi_ng.settings import local_settings

ChiType = Literal["chi_low", "chi_mid", "chi_high"]
FuuroAction = Literal["chi_low", "chi_mid", "chi_high", "pon", "kan_select"]


def _extract_consumed(hand_tiles_with_aka: list[str], target_bases: list[str]) -> list[str]:
    """
    基于需要消耗的基础牌名（不带 'r'），从实际带有赤宝牌的手牌列表里提取出要用掉的牌
    优先提取带有 'r' 的赤宝牌
    """
    consumed = []
    hand = hand_tiles_with_aka.copy()

    for base in target_bases:
        aka_version = f"{base}r" if "5" in base else None

        if aka_version and aka_version in hand:
            consumed.append(aka_version)
            hand.remove(aka_version)
        elif base in hand:
            consumed.append(base)
            hand.remove(base)
        else:
            consumed.append(base)

    return consumed


def _handle_chi_fuuro(bot: StateTracker, last_kawa: str | None, chi_type: ChiType) -> list[FuuroDetail]:
    """处理吃的副露详情，直接通过 libriichi 的验证判定所需消耗"""
    if not last_kawa or not bot.player_state:
        return []

    if not getattr(bot.player_state.last_cans, f"can_{chi_type}", False):
        return [{"tile": last_kawa, "consumed": []}]

    base = last_kawa.replace("r", "")
    try:
        num = int(base[0])
        suit = base[1]
    except (ValueError, IndexError):
        return [{"tile": last_kawa, "consumed": []}]

    targets = []
    if chi_type == "chi_low":
        targets = [f"{num + 1}{suit}", f"{num + 2}{suit}"]
    elif chi_type == "chi_mid":
        targets = [f"{num - 1}{suit}", f"{num + 1}{suit}"]
    elif chi_type == "chi_high":
        targets = [f"{num - 2}{suit}", f"{num - 1}{suit}"]

    consumed = _extract_consumed(bot.tehai_mjai_with_aka, targets)
    return [{"tile": last_kawa, "consumed": consumed}]


def _handle_pon_fuuro(bot: StateTracker, last_kawa: str | None) -> list[FuuroDetail]:
    """处理碰的副露详情"""
    if not last_kawa or not bot.player_state:
        return []

    if not bot.player_state.last_cans.can_pon:
        return [{"tile": last_kawa, "consumed": []}]

    base = last_kawa.replace("r", "")
    consumed = _extract_consumed(bot.tehai_mjai_with_aka, [base, base])

    return [{"tile": last_kawa, "consumed": consumed}]


def _handle_kan_fuuro(bot: StateTracker, last_kawa: str | None) -> list[FuuroDetail]:
    """处理杠的副露详情(大明杠/暗杠/加杠)"""
    if not bot.player_state:
        return []

    results: list[FuuroDetail] = []

    # 优先级1: 大明杠
    if last_kawa and bot.player_state.last_cans.can_daiminkan:
        base = last_kawa.replace("r", "")
        consumed = _extract_consumed(bot.tehai_mjai_with_aka, [base, base, base])
        results.append({"tile": last_kawa, "consumed": consumed})
        return results

    # 优先级2: 暗杠
    for cand in bot.player_state.ankan_candidates():
        base = cand.replace("r", "")
        consumed = _extract_consumed(bot.tehai_mjai_with_aka, [base, base, base, base])
        results.append({"tile": consumed[0] if consumed else "?", "consumed": consumed})

    # 优先级3: 加杠
    for cand in bot.player_state.kakan_candidates():
        base = cand.replace("r", "")
        consumed = _extract_consumed(bot.tehai_mjai_with_aka, [base])
        results.append({"tile": consumed[0] if consumed else "?", "consumed": consumed})

    return results


def _get_fuuro_details(action: FuuroAction, bot: StateTracker) -> list[FuuroDetail]:
    """获取副露(吃、碰、杠)所需的详细信息(牌张和消耗牌)。"""
    last_kawa = bot.last_kawa_tile

    match action:
        case "chi_low" | "chi_mid" | "chi_high":
            return _handle_chi_fuuro(bot, last_kawa, chi_type=action)
        case "pon":
            return _handle_pon_fuuro(bot, last_kawa)
        case "kan_select":
            return _handle_kan_fuuro(bot, last_kawa)
        case _:
            return []


def _handle_hora_action(base_item: Recommendation, bot: StateTracker):
    """处理和牌(hora)动作的特殊逻辑"""
    if bot.can_tsumo_agari:
        # 情况A: 自摸
        base_item["action"] = "tsumo"
        tsumo_tile = bot.last_self_tsumo
        if tsumo_tile:
            base_item["tile"] = tsumo_tile
    else:
        # 情况B: 荣和
        base_item["action"] = "ron"
        last_kawa = bot.last_kawa_tile
        if last_kawa:
            base_item["tile"] = last_kawa


def _process_standard_recommendations(meta: MJAIMetadata, bot: StateTracker) -> list[Recommendation]:
    """处理标准推荐(q_values)"""
    recommendations: list[Recommendation] = []
    if "q_values" not in meta or "mask_bits" not in meta:
        return recommendations

    top3_recommendations = meta_to_recommend(meta, bot.is_3p, temperature=local_settings.model_config.temperature)[:3]
    for action, confidence in top3_recommendations:
        original_action = action

        if action == "kan_select":
            action = "kan"
        elif action.startswith("chi_"):
            action = "chi"

        base_item: Recommendation = {
            "action": action,
            "confidence": confidence,
        }

        # 获取副露详情
        fuuro_details_list: list[FuuroDetail] = _get_fuuro_details(original_action, bot)

        if fuuro_details_list:
            # 如果有具体详情(如多个杠),展开
            recommendations.extend(base_item | detail for detail in fuuro_details_list)
        else:
            # 无副露详情,只添加基本项
            if action == "hora":
                _handle_hora_action(base_item, bot)
            elif action == "nukidora":
                base_item["tile"] = "N"

            recommendations.append(base_item)

    return recommendations


def _attach_riichi_lookahead(recommendations: list[Recommendation], meta: MJAIMetadata, bot: StateTracker):
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

        valid_riichi_discards = bot.discardable_tiles_riichi_declaration
        sim_candidates: list[SimCandidate] = []

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


def build_dataserver_payload(mjai_response: MJAIResponse, bot: StateTracker) -> FullRecommendationData | None:
    """构建发送到 DataServer 的 Payload"""
    try:
        if bot is None:
            return None

        meta: MJAIMetadata = mjai_response.get("meta")
        if not meta:
            return None

        # 1. Generate Standard Recommendations
        recommendations = _process_standard_recommendations(meta, bot)

        # 2. 如果适用，附加立直前瞻信息
        _attach_riichi_lookahead(recommendations, meta, bot)

        # 3. 如果已立直，过滤掉无需显示的推荐
        if bot.self_riichi_accepted:
            allow_actions = {"kan", "tsumo", "ron", "nukidora"}
            recommendations = [rec for rec in recommendations if rec["action"] in allow_actions]

        if recommendations:
            logger.debug(f"Recommendations: {recommendations}")

        return {
            "recommendations": recommendations,
            "engine_type": meta.get(NotificationCode.ENGINE_TYPE),
            "fallback_used": meta.get(NotificationCode.FALLBACK_USED),
            "circuit_open": meta.get(NotificationCode.RECONNECTING),
        }

    except Exception:
        logger.exception("Failed to build payload")
        return None
