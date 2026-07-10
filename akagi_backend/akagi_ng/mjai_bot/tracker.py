from akagi_ng.core.lib_loader import libriichi
from akagi_ng.mjai_bot.logger import logger
from akagi_ng.mjai_bot.status import BotStatusContext
from akagi_ng.mjai_bot.utils import meta_to_recommend, serialize_mjai_event
from akagi_ng.schema.constants import MahjongConstants
from akagi_ng.schema.notifications import NotificationCode
from akagi_ng.schema.protocols import PlayerStateProtocol, StateTrackerProtocol
from akagi_ng.schema.types import (
    ChiType,
    DahaiEvent,
    FullRecommendationData,
    FuuroAction,
    FuuroDetail,
    MJAIEvent,
    MJAIMetadata,
    MJAIResponse,
    NukidoraEvent,
    Recommendation,
    SimCandidate,
    StartGameEvent,
)
from akagi_ng.settings import local_settings


class StateTracker(StateTrackerProtocol):
    """
    状态追踪器，用于跟踪游戏状态。
    作为 libriichi PlayerState 的封装包装器，向下提供状态查询以供推理、副露推荐以及前端展示等使用。
    """

    def __init__(self, status: BotStatusContext, is_3p: bool = False):
        self.status: BotStatusContext = status
        self.is_3p: bool = is_3p
        self.meta: MJAIMetadata = {}
        self.player_id: int = 0
        self.player_state: PlayerStateProtocol | None = None

    def react(self, event: MJAIEvent) -> MJAIResponse | None:
        try:
            processed_event = event
            match event:
                case StartGameEvent(id=player_id, is_3p=is_3p):
                    self.player_id = player_id
                    self.is_3p = is_3p
                    self.player_state = libriichi.state.PlayerState(self.player_id)
                # 三麻兼容：libriichi.PlayerState 状态追踪库不支持 nukidora 事件，需要转换为 dahai 事件
                case NukidoraEvent(actor=actor):
                    processed_event = DahaiEvent(
                        actor=actor,
                        pai="N",
                        tsumogiri=self.last_self_tsumo == "N" and actor == self.player_id,
                    )
                case _:
                    pass

            logger.debug(f"-> {processed_event}")
            if self.player_state:
                self.player_state.update(serialize_mjai_event(processed_event))

            return None

        except Exception:
            brief = self.player_state.brief_info() if self.player_state else "None"
            logger.exception(f"Exception in react. Brief info:\n{brief}")
            self.status.set_flag(NotificationCode.STATE_TRACKER_ERROR)

        return None

    @property
    def last_self_tsumo(self) -> str | None:
        return self.player_state.last_self_tsumo() if self.player_state else None

    @property
    def last_kawa_tile(self) -> str | None:
        return self.player_state.last_kawa_tile() if self.player_state else None

    @property
    def self_riichi_accepted(self) -> bool:
        return self.player_state.self_riichi_accepted if self.player_state else False

    @property
    def can_tsumo_agari(self) -> bool:
        return self.player_state.last_cans.can_tsumo_agari if self.player_state else False

    @property
    def tehai_mjai_with_aka(self) -> list[str]:
        """根据 tehai 和 akas_in_hand 构建带有赤宝牌标记的手牌列表"""
        if not self.player_state:
            return []

        tiles = MahjongConstants.BASE_TILES[:34]

        counts = self.player_state.tehai
        akas = self.player_state.akas_in_hand

        result = []
        for i, count in enumerate(counts):
            if count == 0:
                continue
            base_str = tiles[i]

            # 处理赤宝牌
            aka_idx = -1
            match base_str:
                case "5m":
                    aka_idx = 0
                case "5p":
                    aka_idx = 1
                case "5s":
                    aka_idx = 2

            non_aka_count = count
            if aka_idx >= 0 and akas[aka_idx]:
                result.append(f"{base_str}r")
                non_aka_count -= 1

            for _ in range(non_aka_count):
                result.append(base_str)

        return result

    def build_recommendations(self, response: MJAIResponse) -> FullRecommendationData | None:
        """构建发送到 DataServer 的 Payload"""
        try:
            # 更新内部元数据，以便后续方法使用
            meta: MJAIMetadata = response.get("meta")
            if not meta:
                return None
            self.meta = meta

            # 1. 生成标准推荐
            recommendations = self._process_standard_recommendations(response)

            # 2. 如果适用，附加立直前瞻信息
            self._attach_riichi_lookahead(recommendations)

            # 3. 如果已立直，过滤掉无需显示的推荐
            if self.self_riichi_accepted:
                allow_actions = {"kan", "tsumo", "ron", "nukidora"}
                recommendations = [rec for rec in recommendations if rec["action"] in allow_actions]

            return FullRecommendationData(
                recommendations=recommendations,
                engine_type=meta.get(NotificationCode.ENGINE_TYPE, "unknown"),
                fallback_used=meta.get(NotificationCode.FALLBACK_USED, False),
                circuit_open=meta.get(NotificationCode.RECONNECTING, False),
            )

        except Exception:
            logger.exception("Failed to build recommendations")
            return None

    def _extract_consumed(self, target_bases: list[str]) -> list[str]:
        """提取消耗牌，优先消耗赤宝牌"""
        consumed = []
        hand = self.tehai_mjai_with_aka
        tsumo = self.last_self_tsumo
        if tsumo:
            hand.append(tsumo)

        for base in target_bases:
            pure_base = base.replace("r", "")
            aka_version = f"{pure_base}r" if "5" in pure_base else None

            if aka_version and aka_version in hand:
                consumed.append(aka_version)
                hand.remove(aka_version)
            elif pure_base in hand:
                consumed.append(pure_base)
                hand.remove(pure_base)
            else:
                consumed.append(pure_base)
        return consumed

    def _handle_chi_fuuro(self, last_kawa: str, chi_type: ChiType) -> list[FuuroDetail]:
        if not getattr(self.player_state.last_cans, f"can_{chi_type}", False):
            return [{"tile": last_kawa, "consumed": []}]

        base = last_kawa.replace("r", "")
        try:
            num = int(base[0])
            suit = base[1]
        except (ValueError, IndexError):
            return [{"tile": last_kawa, "consumed": []}]

        targets = []
        match chi_type:
            case "chi_low":
                targets = [f"{num + 1}{suit}", f"{num + 2}{suit}"]
            case "chi_mid":
                targets = [f"{num - 1}{suit}", f"{num + 1}{suit}"]
            case "chi_high":
                targets = [f"{num - 2}{suit}", f"{num - 1}{suit}"]

        consumed = self._extract_consumed(targets)
        return [{"tile": last_kawa, "consumed": consumed}]

    def _handle_pon_fuuro(self, last_kawa: str) -> list[FuuroDetail]:
        if not self.player_state.last_cans.can_pon:
            return [{"tile": last_kawa, "consumed": []}]

        base = last_kawa.replace("r", "")
        consumed = self._extract_consumed([base] * 2)
        return [{"tile": last_kawa, "consumed": consumed}]

    def _handle_kan_fuuro(self, last_kawa: str | None) -> list[FuuroDetail]:
        results: list[FuuroDetail] = []
        if last_kawa and self.player_state.last_cans.can_daiminkan:
            base = last_kawa.replace("r", "")
            consumed = self._extract_consumed([base] * 3)
            results.append({"tile": last_kawa, "consumed": consumed})
            return results

        for cand in self.player_state.ankan_candidates():
            base = cand.replace("r", "")
            consumed = self._extract_consumed([base] * 4)
            results.append({"tile": f"{base}r" if f"{base}r" in consumed else base, "consumed": consumed})

        for cand in self.player_state.kakan_candidates():
            base = cand.replace("r", "")
            consumed = self._extract_consumed([base])
            results.append({"tile": consumed[0], "consumed": consumed})
        return results

    def _get_fuuro_details(self, action: FuuroAction) -> list[FuuroDetail]:
        last_kawa = self.last_kawa_tile
        if not self.player_state or (action != "kan_select" and not last_kawa):
            return []

        match action:
            case "chi_low" | "chi_mid" | "chi_high":
                return self._handle_chi_fuuro(last_kawa, chi_type=action)
            case "pon":
                return self._handle_pon_fuuro(last_kawa)
            case "kan_select":
                return self._handle_kan_fuuro(last_kawa)
            case _:
                return []

    def _handle_hora_action(self, base_item: Recommendation):
        if self.can_tsumo_agari:
            base_item["action"] = "tsumo"
            if tsumo_tile := self.last_self_tsumo:
                base_item["tile"] = tsumo_tile
        else:
            base_item["action"] = "ron"
            if last_kawa := self.last_kawa_tile:
                base_item["tile"] = last_kawa

    def _api_reach_candidates(self, response: MJAIResponse) -> list[SimCandidate]:
        result = [
            SimCandidate(
                tile=candidate["action"].removeprefix("dahai:"),
                confidence=candidate.get("prob", 0.0),
            )
            for candidate in self.meta.get("api_reach_candidates", [])
            if candidate.get("action", "").startswith("dahai:")
        ]
        if not result and (pai := response.get("pai")):
            result.append(SimCandidate(tile=pai, confidence=1.0))
        return result

    def _exact_api_recommendation(  # noqa: C901, PLR0911, PLR0912
        self, response: MJAIResponse, confidence: float
    ) -> Recommendation | None:
        reaction_type = response.get("type")
        match reaction_type:
            case "dahai" if pai := response.get("pai"):
                return {"action": pai, "confidence": confidence}
            case "reach":
                item: Recommendation = {"action": "reach", "confidence": confidence}
                if candidates := self._api_reach_candidates(response):
                    item["sim_candidates"] = candidates
                return item
            case "chi" | "pon":
                item = {"action": reaction_type, "confidence": confidence}
                if pai := response.get("pai"):
                    item["tile"] = pai
                if consumed := response.get("consumed"):
                    item["consumed"] = consumed
                return item
            case "daiminkan" | "ankan" | "kakan":
                item = {"action": "kan", "confidence": confidence}
                if pai := response.get("pai"):
                    item["tile"] = pai
                if consumed := response.get("consumed"):
                    item["consumed"] = consumed
                return item
            case "hora":
                item = {"action": "hora", "confidence": confidence}
                self._handle_hora_action(item)
                return item
            case "ryukyoku" | "none":
                return {"action": reaction_type, "confidence": confidence}
            case "nukidora":
                return {"action": "nukidora", "confidence": confidence, "tile": "N"}
            case _:
                return None

    def _coarse_api_recommendation(  # noqa: PLR0911
        self, action: str, confidence: float
    ) -> Recommendation | None:
        if action.startswith("dahai:"):
            return {"action": action.removeprefix("dahai:"), "confidence": confidence}
        match action:
            case "chi_low" | "chi_mid" | "chi_high":
                return {"action": "chi", "confidence": confidence}
            case "kan":
                return {"action": "kan", "confidence": confidence}
            case "hora":
                item: Recommendation = {"action": "hora", "confidence": confidence}
                self._handle_hora_action(item)
                return item
            case "reach" | "pon" | "ryukyoku" | "none":
                return {"action": action, "confidence": confidence}
            case "nukidora":
                return {"action": "nukidora", "confidence": confidence, "tile": "N"}
            case _:
                return None

    def _process_api_recommendations(self, response: MJAIResponse) -> list[Recommendation]:
        candidates = self.meta.get("api_candidates", [])
        top_probability = candidates[0].get("prob", 1.0) if candidates else 1.0
        exact = self._exact_api_recommendation(response, top_probability)
        recommendations = [exact] if exact else []

        # candidates[0] is the exact reaction rendered above. Remaining rows
        # are intentionally coarse, matching Akagi v3.3's HUD behavior.
        for candidate in candidates[1:] if exact else candidates:
            item = self._coarse_api_recommendation(
                candidate.get("action", ""),
                candidate.get("prob", 0.0),
            )
            if item:
                recommendations.append(item)
        return recommendations[:3]

    def _process_standard_recommendations(self, response: MJAIResponse) -> list[Recommendation]:
        recommendations: list[Recommendation] = []
        if "api_candidates" in self.meta:
            return self._process_api_recommendations(response)
        if "q_values" not in self.meta or "mask_bits" not in self.meta:
            return recommendations

        top3 = meta_to_recommend(self.meta, self.is_3p, temperature=local_settings.model_config.temperature)[:3]

        for action, confidence in top3:
            original_action = action
            if action == "kan_select":
                action = "kan"
            elif action.startswith("chi_"):
                action = "chi"

            base_item: Recommendation = {"action": action, "confidence": confidence}
            fuuro_details = self._get_fuuro_details(original_action)

            if fuuro_details:
                recommendations.extend(base_item | detail for detail in fuuro_details)
            else:
                # 如果有具体详情(如多个杠),展开
                if action == "hora":
                    self._handle_hora_action(base_item)
                # 无副露详情,只添加基本项
                elif action == "nukidora":
                    base_item["tile"] = "N"
                recommendations.append(base_item)
        return recommendations

    def _attach_riichi_lookahead(self, recommendations: list[Recommendation]):
        lookahead_meta = self.meta.get("riichi_lookahead")
        if not lookahead_meta:
            return

        try:
            lookahead_recs = meta_to_recommend(
                lookahead_meta, self.is_3p, temperature=local_settings.model_config.temperature
            )
            if not lookahead_recs:
                return

            sim_candidates: list[SimCandidate] = [
                SimCandidate(tile=act, confidence=float(conf)) for act, conf in lookahead_recs
            ][: MahjongConstants.MIN_RIICHI_CANDIDATES]

            for item in recommendations:
                if item["action"] == "reach":
                    item["sim_candidates"] = sim_candidates
                    break

        except Exception as e:
            logger.warning(f"Error attaching riichi lookahead: {e}")
