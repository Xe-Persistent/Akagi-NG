import json

from akagi_ng.core.notification_codes import NotificationCode
from akagi_ng.mjai_bot.engine.base import BaseEngine
from akagi_ng.mjai_bot.engine.mortal import MortalEngine
from akagi_ng.mjai_bot.utils import is_riichi_relevant, make_error_response


class MortalBot:
    def __init__(self, engine: MortalEngine | None = None, is_3p: bool = False):
        self.engine = engine
        self.is_3p = is_3p
        self.player_id: int | None = None
        self.riichi_candidates = []
        self.history = []
        self.model: BaseEngine | None = None
        self.game_start_event = None
        self.meta = {}
        self.notification_flags = {}  # 系统状态通知标志

        from akagi_ng.mjai_bot.engine.loader import load_model
        from akagi_ng.mjai_bot.mortal.logger import logger

        # 根据游戏模式动态加载库
        if is_3p:
            from akagi_ng.core.lib_loader import libriichi3p

            self.libriichi = libriichi3p
            self.model_loader = lambda seat: load_model(seat, is_3p=True, logger=logger)
        else:
            from akagi_ng.core.lib_loader import libriichi

            self.libriichi = libriichi
            self.model_loader = lambda seat: load_model(seat, is_3p=False, logger=logger)

        self.logger = logger

    def react(self, events: str) -> str:
        """
        处理事件。必须先发送 `start_game` 事件初始化 Bot。
        """
        try:
            events = json.loads(events)
        except json.JSONDecodeError as e:
            self.logger.error(f"Failed to parse events: {events}, {e}")
            return json.dumps(make_error_response(NotificationCode.PARSE_ERROR), separators=(",", ":"))

        return_action = None
        is_game_start_batch = False

        try:
            for e in events:
                if e["type"] == "start_game":
                    self.player_id = e["id"]
                    self.model, self.engine = self.model_loader(self.player_id)
                    self.history = []
                    self.game_start_event = e
                    is_game_start_batch = True
                    continue
                if self.model is None or self.player_id is None:
                    self.logger.error("Model is not loaded yet")
                    continue

                if e["type"] == "start_kyoku":
                    self.history = []

                self.history.append(e)

                if e["type"] == "end_game":
                    self.player_id = None
                    self.model = None
                    self.engine = None
                    self.game_start_event = None
                    continue
                return_action = self.model.react(json.dumps(e, separators=(",", ":")))

            try:
                raw_data = {"type": "none"} if return_action is None else json.loads(return_action)
            except json.JSONDecodeError as e:
                self.logger.error(f"Failed to parse model response: {e}")
                raw_data = make_error_response(NotificationCode.JSON_DECODE_ERROR)

            meta = raw_data.get("meta", {})

            # 1. 收集引擎通知标志
            self.notification_flags.clear()
            if self.engine:
                engine_flags = self.engine.get_notification_flags()
                self.notification_flags.update(engine_flags)

            # 2. 注入 game_start 标志到 meta (这是推理相关的元数据)
            if is_game_start_batch:
                meta["game_start"] = True

            # 3. 立直前瞻逻辑
            if events and is_riichi_relevant(self.engine, self.player_id, events[-1], is_3p=self.is_3p):
                # 确保最后一次推理结果已更新
                if self.engine:
                    meta.update(self.engine.last_inference_result)

                # 检查是否应该推荐立直切牌
                from akagi_ng.mjai_bot.utils import meta_to_recommend

                recommendations = meta_to_recommend(meta, is_3p=self.is_3p)

                is_reach_candidate = False
                top_3_actions = [rec[0] for rec in recommendations[:3]]
                self.logger.debug(f"Riichi Lookahead: Top 3 actions: {top_3_actions}")

                if "reach" in top_3_actions:
                    is_reach_candidate = True

                if is_reach_candidate:
                    self.logger.info("Riichi Lookahead: Reach is in Top 3 recommendations. Starting simulation.")
                    lookahead_meta = self._run_riichi_lookahead()
                    if lookahead_meta:
                        # 区分: 立直前瞻错误放到通知标志中,成功的元数据放到 meta 中
                        if lookahead_meta.get("error"):
                            self.notification_flags["riichi_lookahead"] = lookahead_meta
                        else:
                            meta["riichi_lookahead"] = lookahead_meta

            if meta:
                # 三麻特殊处理：如果只有一个合法操作，不显示推荐
                if self.is_3p:
                    mask_bits = meta.get("mask_bits")
                    if mask_bits and mask_bits.bit_count() == 1:
                        self.logger.debug(
                            "Bot (3p): Suppressing metadata because only 1 legal action exists (forced move)."
                        )
                        if "meta" in raw_data:
                            del raw_data["meta"]
                    else:
                        raw_data["meta"] = meta
                else:
                    raw_data["meta"] = meta

            return json.dumps(raw_data, separators=(",", ":"))

        except FileNotFoundError as e:
            self.logger.error(f"Model file missing: {e}")
            return json.dumps(make_error_response(NotificationCode.MISSING_RESOURCES), separators=(",", ":"))

        except Exception as e:
            self.logger.error(f"MortalBot error: {e}")
            import traceback

            self.logger.error(traceback.format_exc())
            return json.dumps(make_error_response(NotificationCode.BOT_RUNTIME_ERROR), separators=(",", ":"))

    def _run_riichi_lookahead(self):
        """
        使用 ReplayEngine 运行立直前瞻模拟。
        返回模拟元数据，失败时返回 None。
        """
        try:
            from akagi_ng.mjai_bot.engine.replay import ReplayEngine

            # 使用 ReplayEngine 进行模拟
            sim_engine = ReplayEngine(self.engine, [None] * len(self.history))
            self.logger.debug("Riichi Lookahead: Using ReplayEngine for simulation.")

            # 创建模拟 Bot
            sim_bot = self.libriichi.mjai.Bot(sim_engine, self.player_id)

            # 回放历史事件
            self.logger.debug(f"Riichi Lookahead: Replaying {len(self.history)} events.")

            # 三麻需要先回放 game_start 事件以初始化模式
            if self.is_3p and self.game_start_event:
                sim_bot.react(json.dumps(self.game_start_event, separators=(",", ":")))

            for h_event in self.history:
                sim_bot.react(json.dumps(h_event, separators=(",", ":")))

            # 停止回放模式，让引擎处理前瞻
            sim_engine.stop_replaying()

            # 应用立直事件
            reach_event = {"type": "reach", "actor": self.player_id}
            self.logger.debug("Riichi Lookahead: Applying reach event.")
            sim_resp = sim_bot.react(json.dumps(reach_event, separators=(",", ":")))

            # 从响应中提取模拟元数据
            try:
                sim_data = json.loads(sim_resp)
            except json.JSONDecodeError as e:
                self.logger.error(f"Failed to parse simulation response: {e}")
                return {"error": True}
            sim_meta = sim_data.get("meta", {})

            # 记录成功
            from akagi_ng.mjai_bot.utils import meta_to_recommend

            sim_recs = meta_to_recommend(sim_meta, is_3p=self.is_3p)
            best_sim_action = sim_recs[0][0] if sim_recs else "none"
            self.logger.info(f"Riichi Lookahead: Success. Best sim action: {best_sim_action}")

            return sim_meta

        except Exception as lookahead_err:
            self.logger.error(f"Riichi Lookahead failed: {lookahead_err}")
            import traceback

            self.logger.error(traceback.format_exc())
            # 返回错误标志
            return {"error": True}
