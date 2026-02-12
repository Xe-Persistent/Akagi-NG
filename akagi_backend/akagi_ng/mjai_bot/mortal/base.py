import json

from akagi_ng.core import NotificationCode
from akagi_ng.core.protocols import Bot, EngineProtocol, MjaiMetadata
from akagi_ng.mjai_bot.lookahead import LookaheadBot
from akagi_ng.mjai_bot.utils import make_error_response


class MortalBot:
    """
    Mortal Bot 的封装类,负责处理事件并返回推荐动作。
    """

    def __init__(self, engine: EngineProtocol | None = None, is_3p: bool = False):
        self.engine = engine
        self.is_3p = is_3p
        self.player_id: int | None = None
        self.riichi_candidates = []
        self.history = []
        self.history_json = []  # 缓存已序列化的事件以提升性能
        self.model: Bot | None = None
        self.game_start_event = None
        self.meta = {}
        self.notification_flags = {}  # 系统状态通知标志
        self._pending_notifications = {}  # 暂存的通知标志（如模型加载事件）

        from akagi_ng.mjai_bot.engine.factory import load_bot_and_engine
        from akagi_ng.mjai_bot.mortal.logger import logger

        # 根据游戏模式动态加载库
        if is_3p:
            from akagi_ng.core.lib_loader import libriichi3p

            self.libriichi = libriichi3p
        else:
            from akagi_ng.core.lib_loader import libriichi

            self.libriichi = libriichi

        self.model_loader = load_bot_and_engine
        self.logger = logger

    def _process_events(self, events: list[dict]) -> tuple[str | None, bool]:
        """
        处理事件列表,返回最后的模型响应和是否为游戏开始批次。

        Returns:
            (return_action, is_game_start_batch)
        """
        return_action = None
        is_game_start_batch = False
        for e in events:
            e_type = e["type"]
            if e_type == "start_game":
                self._handle_start_game(e)
                is_game_start_batch = True
                continue

            if self.model is None or self.player_id is None:
                self.logger.error(f"Model is not loaded yet, skipping event: {e_type}")
                continue

            if e_type == "start_kyoku":
                self.history = []
                self.history_json = []

            # 预备序列化数据并缓存
            e_json = json.dumps(e, separators=(",", ":"))
            self.history.append(e)
            self.history_json.append(e_json)

            if e_type == "end_game":
                self._handle_end_game()
                continue

            # 处理同步/回放模式
            is_sync = e.get("sync", False)

            if self.engine:
                try:
                    self.engine.is_sync = is_sync
                    return_action = self.model.react(e_json)
                finally:
                    self.engine.is_sync = False
            else:
                return_action = self.model.react(e_json)

        return return_action, is_game_start_batch

    def _handle_start_game(self, e: dict):
        """处理游戏开始事件，初始化模型和引擎"""
        self.player_id = e["id"]
        self.model, self.engine = self.model_loader(self.player_id, self.is_3p)
        self.history = []
        self.history_json = []
        self.game_start_event = e

        # 检测加载的模型类型并设置通知
        meta = self.engine.get_additional_meta()
        engine_type = meta.get("engine_type", "unknown")

        if engine_type == "akagiot":
            self._pending_notifications["model_loaded_online"] = True
        elif engine_type == "mortal":
            self._pending_notifications["model_loaded_local"] = True
        elif engine_type == "replay":
            pass
        else:
            self.logger.warning(f"Unknown engine type: {engine_type}")

    def _handle_end_game(self):
        """处理游戏结束事件，清理状态"""
        self.player_id = None
        self.model = None
        self.engine = None
        self.game_start_event = None

    def _handle_riichi_lookahead(self, meta: MjaiMetadata):
        """
        处理立直前瞻逻辑,如果满足条件则运行模拟并更新 meta 或 notification_flags。

        Args:
            meta: 模型返回的元数据
            events: 原始事件列表
        """
        # 检查 meta 中是否有推荐数据
        if "q_values" not in meta or "mask_bits" not in meta:
            return

        from akagi_ng.mjai_bot.utils import meta_to_recommend

        recommendations = meta_to_recommend(meta, is_3p=self.is_3p)
        top_3_actions = [rec[0] for rec in recommendations[:3]]

        # 检查立直是否在 Top 3 推荐中
        if "reach" not in top_3_actions:
            return

        self.logger.info(f"Riichi Lookahead: Reach is in Top 3 ({top_3_actions}). Starting simulation.")
        lookahead_meta = self._run_riichi_lookahead()
        if lookahead_meta:
            # 区分: 立直前瞻错误放到通知标志中,成功的元数据放到 meta 中
            if lookahead_meta.get("error"):
                self.notification_flags["riichi_lookahead"] = lookahead_meta
            else:
                meta["riichi_lookahead"] = lookahead_meta

    def _set_meta_to_response(self, raw_data: dict, meta: MjaiMetadata):
        """
        根据游戏模式设置 meta 到响应中。

        Args:
            raw_data: 原始响应数据
            meta: 要设置的元数据
        """
        if not meta:
            return

        if not self.is_3p:
            raw_data["meta"] = meta
            return

        # 三麻特殊处理：如果只有一个合法操作，不显示推荐
        mask_bits = meta.get("mask_bits")
        if mask_bits and mask_bits.bit_count() == 1:
            self.logger.debug("Bot (3p): Suppressing metadata because only 1 legal action exists.")
            raw_data.pop("meta", None)
        else:
            raw_data["meta"] = meta

    def react(self, events: str) -> str:
        """
        处理事件。必须先发送 `start_game` 事件初始化 Bot。
        """
        try:
            events = json.loads(events)
        except json.JSONDecodeError as e:
            self.logger.error(f"Failed to parse events: {events}, {e}")
            return json.dumps(make_error_response(NotificationCode.PARSE_ERROR), separators=(",", ":"))

        try:
            # 1. 处理事件并获取模型响应
            return_action, is_game_start_batch = self._process_events(events)

            # 2. 解析模型响应
            try:
                raw_data = {"type": "none"} if return_action is None else json.loads(return_action)
            except json.JSONDecodeError as e:
                self.logger.error(f"Failed to parse model response: {e}")
                raw_data = make_error_response(NotificationCode.JSON_DECODE_ERROR)

            meta = raw_data.get("meta", {})

            # 3. 收集引擎通知标志
            self.notification_flags.clear()
            if self.engine:
                engine_flags = self.engine.get_notification_flags()
                self.notification_flags.update(engine_flags)

            # 合并暂存的通知
            if self._pending_notifications:
                self.notification_flags.update(self._pending_notifications)
                self._pending_notifications.clear()

            # 4. 注入引擎附加元数据和 game_start 标志到 meta
            if self.engine and hasattr(self.engine, "get_additional_meta"):
                additional_meta = self.engine.get_additional_meta()
                meta.update(additional_meta)

            if is_game_start_batch:
                meta["game_start"] = True

            # 5. 处理立直前瞻逻辑
            self._handle_riichi_lookahead(meta)

            # 6. 设置 meta 到响应中
            self._set_meta_to_response(raw_data, meta)

            return json.dumps(raw_data, separators=(",", ":"))

        except Exception as e:
            self.logger.error(f"MortalBot error: {e}")
            import traceback

            self.logger.error(traceback.format_exc())
            return json.dumps(make_error_response(NotificationCode.BOT_RUNTIME_ERROR), separators=(",", ":"))

    def _run_riichi_lookahead(self) -> dict[str, object]:
        """
        运行立直前瞻模拟。
        返回模拟元数据，失败时返回 None。
        """
        try:
            if not self.engine or self.player_id is None:
                return {"error": True}

            self.logger.debug("Riichi Lookahead: Starting simulation (using LookaheadBot).")

            # 实例化 LookaheadBot
            # 使用 fork() 获取纯净的、同类型的 Engine 副本
            # 这样前瞻模拟将遵循当前引擎的状态：
            # - 如果在线引擎激活，前瞻也使用在线引擎（及其 Fork）。
            # - 如果处于回退状态，前瞻自然也使用本地引擎的副本。
            sim_engine = self.engine.fork()

            lookahead_bot = LookaheadBot(sim_engine, self.player_id, is_3p=self.is_3p)

            # 构造 Reach 事件
            reach_event = {"type": "reach", "actor": self.player_id}

            # 运行模拟
            sim_meta = lookahead_bot.simulate_reach(
                self.history,
                reach_event,
                game_start_event=self.game_start_event,
            )

            if not sim_meta:
                self.logger.warning("Riichi Lookahead: Simulation returned no metadata.")
                return {"error": True}

            # 记录成功 - 防御性检查: 确保 sim_meta 包含必需字段
            if "q_values" in sim_meta and "mask_bits" in sim_meta:
                from akagi_ng.mjai_bot.utils import meta_to_recommend

                sim_recs = meta_to_recommend(sim_meta, is_3p=self.is_3p)
                all_candidates = ", ".join([f"{action}({conf:.3f})" for action, conf in sim_recs])
                self.logger.info(f"Riichi Lookahead: Simulation success. Candidates: {all_candidates}")
            else:
                self.logger.warning("Riichi Lookahead: Simulation meta missing q_values or mask_bits.")

            return sim_meta

        except Exception as lookahead_err:
            self.logger.error(f"Riichi Lookahead failed: {lookahead_err}")
            import traceback

            self.logger.error(traceback.format_exc())
            return {"error": True}
