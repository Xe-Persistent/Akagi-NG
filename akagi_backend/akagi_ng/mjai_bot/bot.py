import json
from typing import Any

import requests

from akagi_ng.mjai_bot.cloud_api import AkagiApiClient, CircuitBreaker, CloudApiError
from akagi_ng.mjai_bot.engine.factory import load_bot_and_engine
from akagi_ng.mjai_bot.logger import logger
from akagi_ng.mjai_bot.lookahead import LookaheadBot
from akagi_ng.mjai_bot.status import BotStatusContext
from akagi_ng.mjai_bot.utils import meta_to_recommend, serialize_mjai_event
from akagi_ng.schema.constants import MahjongConstants
from akagi_ng.schema.notifications import NotificationCode
from akagi_ng.schema.protocols import EngineProtocol, MJAIBotProtocol
from akagi_ng.schema.types import (
    EndGameEvent,
    MJAIEvent,
    MJAIEventBase,
    MJAIMetadata,
    MJAIResponse,
    ReachEvent,
    StartGameEvent,
    StartKyokuEvent,
    TsumoEvent,
)
from akagi_ng.settings import local_settings

_ACTIONS_WITH_ACTOR = {
    "tsumo",
    "dahai",
    "reach",
    "chi",
    "pon",
    "daiminkan",
    "ankan",
    "kakan",
    "hora",
    "nukidora",
}


def _hidden_hand() -> list[str]:
    return ["?"] * 13


def _event_to_api(event: MJAIEvent, player_id: int, is_3p: bool) -> dict[str, Any]:
    """Shape one Akagi-NG event exactly as Akagi v3.3's API caller does."""
    match event:
        case StartGameEvent():
            return {"type": "start_game", "names": ["", "", "", ""]}
        case StartKyokuEvent(
            bakaze=bakaze,
            dora_marker=dora_marker,
            kyoku=kyoku,
            honba=honba,
            kyotaku=kyotaku,
            oya=oya,
            scores=event_scores,
            tehais=event_tehais,
        ):
            scores = list(event_scores)
            tehais = [list(hand) if seat == player_id else _hidden_hand() for seat, hand in enumerate(event_tehais)]
            if is_3p:
                scores.extend([0] * (4 - len(scores)))
                tehais.extend(_hidden_hand() for _ in range(4 - len(tehais)))
            return {
                "type": "start_kyoku",
                "bakaze": bakaze,
                "dora_marker": dora_marker,
                "kyoku": kyoku,
                "honba": honba,
                "kyotaku": kyotaku,
                "oya": oya,
                "scores": scores,
                "tehais": tehais,
            }
        case TsumoEvent(actor=actor, pai=pai):
            return {"type": "tsumo", "actor": actor, "pai": pai if actor == player_id else "?"}
        case ReachEvent(actor=actor):
            return {"type": "reach", "actor": actor}
        case _:
            payload = json.loads(serialize_mjai_event(event))
            return {key: value for key, value in payload.items() if key != "sync" and value is not None}


def build_api_events(history: list[MJAIEvent], player_id: int, is_3p: bool) -> list[dict[str, Any]]:
    return [_event_to_api(event, player_id, is_3p) for event in history]


def _api_candidates(payload: object) -> list[dict[str, Any]]:
    if not isinstance(payload, list):
        return []
    candidates = []
    for item in payload:
        if not isinstance(item, dict) or not isinstance(item.get("action"), str):
            continue
        prob = item.get("prob", 0.0)
        if not isinstance(prob, int | float):
            prob = 0.0
        candidates.append({"action": item["action"], "prob": float(prob)})
    return candidates


class MortalBot:
    """
    MJAI Bot 的封装类,负责处理事件并返回推荐动作。
    """

    def __init__(
        self,
        status: BotStatusContext,
        engine: EngineProtocol | None = None,
        is_3p: bool = False,
    ):
        self.status = status
        self.engine = engine
        self.is_3p = is_3p
        self.player_id: int | None = None
        self.history: list[MJAIEvent] = []
        self.bot: MJAIBotProtocol | None = None
        self.game_start_event: StartGameEvent | None = None
        self._api_client: AkagiApiClient | None = None
        self._api_signature: tuple[str, str, str] | None = None
        self._api_breaker = CircuitBreaker()

        self.logger = logger

    def react(self, event: MJAIEvent) -> MJAIResponse | None:
        """MortalBot 对外核心接口，流水线处理事件"""
        try:
            # 1. 预处理：生命周期管理与历史记录
            self._pre_react(event)

            # 2. 决策：调用模型/引擎
            response: MJAIResponse | None = self._think(event)
            if not response:
                return None

            # 3. 增强：注入元数据与执行前瞻逻辑
            meta: MJAIMetadata | None = response.get("meta")
            if not meta:
                return None

            self._post_react(meta)

            # 4. 智能抑制：如果推荐内容仅包含唯一的“跳过”，则移除 meta 以隐藏推荐
            if self._should_suppress_meta(meta):
                response.pop("meta", None)

            return response

        except Exception as e:
            self.logger.exception(f"MortalBot runtime error in select_action: {e}")
            self.status.set_flag(NotificationCode.BOT_RUNTIME_ERROR)
            return None

    def _pre_react(self, event: MJAIEvent) -> None:
        """维护历史、处理生命周期事件。"""
        match event:
            case StartGameEvent():
                self._handle_start_game(event)
            case StartKyokuEvent():
                self.history = [self.game_start_event] if self.game_start_event else []
            case EndGameEvent():
                self._handle_end_game()

        # 维护历史
        self.history.append(event)

    def _think(self, event: MJAIEvent) -> MJAIResponse | None:  # noqa: PLR0911
        """Use the local engine as a legal-action gate and V3 API fallback."""
        if not self.bot:
            return None

        is_sync = False
        match event:
            case ReachEvent(actor=actor) if actor == self.player_id:
                # 玩家自己立直时，接下来必须且只能切出立直宣告牌。
                # 引擎无需再做推理（立直前瞻已涵盖此信息），直接转为同步状态以节省算力并抑制 UI 闪烁。
                is_sync = True
                # 检查 MJAIEvent 中的 sync 字段
            case MJAIEventBase(sync=is_sync):
                pass

        try:
            # MJAI 协议底层 C++ Bot (mjai-python) 接受并返回 JSON 字符串
            event_json = serialize_mjai_event(event)
            # can_act=False 时同步快进，仅更新状态，不触发决策推理。
            res = self.bot.react(event_json, can_act=False) if is_sync else self.bot.react(event_json)
            if not res:
                return None
            try:
                local_response = json.loads(res)
            except json.JSONDecodeError:
                self.logger.error(f"MortalBot: engine returned invalid JSON: {res}")
                self.status.set_flag(NotificationCode.JSON_DECODE_ERROR)
                return None

            if not isinstance(local_response, dict):
                self.logger.error("MortalBot: engine returned a non-object JSON response")
                self.status.set_flag(NotificationCode.JSON_DECODE_ERROR)
                return None

            # Sync updates advance libriichi only. They must never spend an API
            # request, matching Akagi v3.3's decision-point gate.
            if is_sync or not local_response.get("meta"):
                return local_response

            return self._remote_or_local(local_response)
        except Exception:
            self.logger.exception("MortalBot engine error")
            self.status.set_flag(NotificationCode.BOT_RUNTIME_ERROR)
            return None

    def _apply_api_config(self) -> tuple[AkagiApiClient, str] | None:
        config = local_settings.api
        if not config.is_active():
            if self._api_signature is not None:
                self._api_client = None
                self._api_signature = None
                self._api_breaker.reset()
            self.status.set_metadata(NotificationCode.FALLBACK_USED, False)
            self.status.set_metadata(NotificationCode.RECONNECTING, False)
            return None

        model = config.model_for(self.is_3p).strip()
        signature = (config.base_url.strip(), config.key.strip(), model)
        if signature != self._api_signature:
            self._api_signature = signature
            self._api_breaker.reset()
            try:
                self._api_client = AkagiApiClient(config.base_url, config.key)
            except CloudApiError as exc:
                self._api_client = None
                self._record_api_failure(exc)

        if self._api_client is None:
            return None
        return self._api_client, model

    def _set_api_metadata(self, *, fallback: bool, reconnecting: bool) -> None:
        self.status.set_metadata(NotificationCode.ENGINE_TYPE, "akagiapi")
        self.status.set_metadata(NotificationCode.FALLBACK_USED, fallback)
        self.status.set_metadata(NotificationCode.RECONNECTING, reconnecting)

    def _record_api_failure(self, error: Exception) -> None:
        backoff, transitioned = self._api_breaker.record_failure()
        self._set_api_metadata(fallback=True, reconnecting=True)
        if transitioned:
            self.status.set_flag(NotificationCode.FALLBACK_USED)
            self.status.set_flag(NotificationCode.RECONNECTING)
        self.logger.warning(f"Akagi V3 API failed ({error}); using local model and retrying after {backoff:.0f}s")

    def _record_api_success(self) -> None:
        if self._api_breaker.record_success():
            self.status.set_flag(NotificationCode.SERVICE_RESTORED)
        self._set_api_metadata(fallback=False, reconnecting=False)

    def _build_remote_response(
        self,
        reaction: dict[str, Any],
        payload: dict[str, Any],
        client: AkagiApiClient,
        model: str,
        events: list[dict[str, Any]],
    ) -> tuple[MJAIResponse | None, Exception | None]:
        remote_response: MJAIResponse = {key: value for key, value in reaction.items() if key != "meta"}
        reaction_type = remote_response.get("type")
        if reaction_type in _ACTIONS_WITH_ACTOR:
            remote_response["actor"] = self.player_id

        api_meta: MJAIMetadata = {
            "api_candidates": _api_candidates(payload.get("candidates")),
            "api_model": str(payload.get("model") or model),
            "engine_type": "akagiapi",
            "fallback_used": False,
            "online_service_reconnecting": False,
        }

        followup_error = None
        if reaction_type == "reach" and not remote_response.get("pai"):
            resolved, followup_error = self._resolve_reach_discard(
                remote_response,
                api_meta,
                client,
                model,
                events,
            )
            if not resolved:
                return None, followup_error

        remote_response["meta"] = api_meta
        return remote_response, followup_error

    def _resolve_reach_discard(
        self,
        response: MJAIResponse,
        meta: MJAIMetadata,
        client: AkagiApiClient,
        model: str,
        events: list[dict[str, Any]],
    ) -> tuple[bool, Exception | None]:
        followup_events = [*events, {"type": "reach", "actor": self.player_id}]
        try:
            followup = client.react(model, self.player_id, followup_events)
        except (CloudApiError, requests.RequestException) as exc:
            discard = self._local_reach_discard()
            if discard:
                response["pai"] = discard
            return discard is not None, exc

        followup_reaction = followup.get("reaction")
        if isinstance(followup_reaction, dict) and followup_reaction.get("type") == "dahai":
            discard = followup_reaction.get("pai")
            if isinstance(discard, str) and discard:
                response["pai"] = discard
                meta["api_reach_candidates"] = _api_candidates(followup.get("candidates"))
                return True, None

        # The request succeeded, so the service is healthy. A malformed or
        # null follow-up still falls back to the local riichi discard.
        discard = self._local_reach_discard()
        if discard:
            response["pai"] = discard
        return discard is not None, None

    def _local_reach_discard(self) -> str | None:
        meta = self._run_riichi_lookahead()
        if not meta:
            return None
        recommendations = meta_to_recommend(
            meta,
            is_3p=self.is_3p,
            temperature=local_settings.model_config.temperature,
        )
        return next(
            (action for action, _confidence in recommendations if action in MahjongConstants.BASE_TILES),
            None,
        )

    def _remote_or_local(self, local_response: MJAIResponse) -> MJAIResponse:
        session = self._apply_api_config()
        if session is None:
            return local_response

        if not self._api_breaker.allows():
            self._set_api_metadata(fallback=True, reconnecting=True)
            return local_response

        client, model = session
        if self.player_id is None:
            return local_response

        events = build_api_events(self.history, self.player_id, self.is_3p)
        try:
            payload = client.react(model, self.player_id, events)
        except (CloudApiError, requests.RequestException) as exc:
            self._record_api_failure(exc)
            return local_response

        reaction = payload.get("reaction")
        if not isinstance(reaction, dict) or not isinstance(reaction.get("type"), str):
            # A reachable server can legitimately report no action. Keep it
            # healthy, but use the local legal move instead of dropping a turn.
            self._record_api_success()
            self.status.set_metadata(NotificationCode.FALLBACK_USED, True)
            return local_response

        remote_response, followup_error = self._build_remote_response(reaction, payload, client, model, events)
        if followup_error:
            self._record_api_failure(followup_error)
        else:
            self._record_api_success()
        return remote_response or local_response

    def _should_suppress_meta(self, meta: MJAIMetadata) -> bool:
        """
        判断是否应该抑制元数据。
        如果唯一合法动作是“跳过”，则返回 True。
        这通常发生在三麻中由于规则禁止“吃”而导致模型返回唯一的“none”动作。
        """
        mask_bits = meta.get("mask_bits", 0)
        none_idx = 43 if self.is_3p else 45
        return mask_bits == (1 << none_idx)

    def _post_react(self, meta: MJAIMetadata):
        """元数据增强阶段"""
        # 1. 注入同步元数据
        meta.update(self.status.metadata)

        # 2. 立直前瞻逻辑
        self._handle_riichi_lookahead(meta)

    def _handle_start_game(self, e: StartGameEvent):
        """处理游戏开始事件，初始化模型和引擎"""
        self.player_id = e.id
        self.bot, self.engine = load_bot_and_engine(self.status, self.player_id, self.is_3p)
        self.history = []
        self.game_start_event = e

        # V3 API is event-level; the embedded Mortal model remains loaded as
        # the legal-action gate and immediate fallback in both modes.
        if local_settings.api.is_active():
            self.status.set_metadata(NotificationCode.ENGINE_TYPE, "akagiapi")
            self.status.set_flag(NotificationCode.MODEL_LOADED_ONLINE)
        elif self.engine:
            engine_type = self.status.metadata.get(NotificationCode.ENGINE_TYPE, "unknown")
            if engine_type == "mortal":
                self.status.set_flag(NotificationCode.MODEL_LOADED_LOCAL)
            elif engine_type == "akagiot":
                self.status.set_flag(NotificationCode.MODEL_LOADED_ONLINE)
            else:
                self.logger.warning(f"Unknown engine type: {engine_type}")

    def _handle_end_game(self):
        """处理游戏结束事件，清理状态"""
        self.player_id = None
        self.bot = None
        self.engine = None
        self.game_start_event = None
        self._api_breaker.reset()

    def _handle_riichi_lookahead(self, meta: MJAIMetadata):
        """
        处理立直前瞻逻辑
        """
        if "q_values" not in meta or "mask_bits" not in meta:
            return

        recommendations = meta_to_recommend(meta, is_3p=self.is_3p, temperature=local_settings.model_config.temperature)
        top_3_actions = [rec[0] for rec in recommendations[:3]]

        if "reach" not in top_3_actions:
            return

        self.logger.info(f"Riichi Lookahead: Reach is in Top 3 ({top_3_actions}). Starting simulation.")
        lookahead_meta = self._run_riichi_lookahead()
        if lookahead_meta:
            meta["riichi_lookahead"] = lookahead_meta
        else:
            self.status.set_flag(NotificationCode.RIICHI_SIM_FAILED)

    def _run_riichi_lookahead(self) -> MJAIMetadata | None:
        """
        运行立直前瞻模拟。
        """
        try:
            if not self.engine or self.player_id is None:
                return None

            self.logger.debug("Riichi Lookahead: Starting simulation (using LookaheadBot).")
            sim_status = BotStatusContext()
            sim_engine = self.engine.fork(status=sim_status)
            lookahead_bot = LookaheadBot(sim_engine, self.player_id, is_3p=self.is_3p)

            reach_event = ReachEvent(actor=self.player_id)
            replay_history = self.history
            if replay_history and isinstance(replay_history[0], StartGameEvent):
                replay_history = replay_history[1:]
            sim_meta: MJAIMetadata | None = lookahead_bot.simulate_reach(
                replay_history,
                reach_event,
                game_start_event=self.game_start_event,
            )

            if not sim_meta:
                self.logger.warning("Riichi Lookahead: Simulation returned no metadata.")
                return None

            sim_recs = meta_to_recommend(
                sim_meta, is_3p=self.is_3p, temperature=local_settings.model_config.temperature
            )
            all_candidates = ", ".join([f"{action}({conf:.3f})" for action, conf in sim_recs])
            self.logger.info(f"Riichi Lookahead: Simulation success. Candidates: {all_candidates}")
            return sim_meta

        except Exception:
            self.logger.exception("Riichi Lookahead failed")
            return None
