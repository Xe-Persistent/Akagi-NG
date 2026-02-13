import json

from akagi_ng.mjai_bot.lookahead import LookaheadBot
from akagi_ng.mjai_bot.status import BotStatusContext
from akagi_ng.schema.notifications import NotificationCode
from akagi_ng.schema.protocols import BotProtocol, EngineProtocol
from akagi_ng.schema.types import (
    MJAIEvent,
    MJAIMetadata,
    MJAIResponse,
    StartGameEvent,
)


class MortalBot:
    """
    Mortal Bot 的封装类,负责处理事件并返回推荐动作。
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
        self.model: BotProtocol | None = None
        self.game_start_event: StartGameEvent | None = None

        from akagi_ng.mjai_bot.mortal.logger import logger

        self.logger = logger

    def react(self, event: MJAIEvent) -> MJAIResponse:
        """MortalBot 对外核心接口，流水线处理事件"""
        try:
            # 1. 预处理：生命周期管理与历史记录
            is_game_start, is_game_end = self._pre_react(event)

            # 2. 决策：调用模型/引擎
            response = self._think(event) if not is_game_end else {"type": "none"}

            # 3. 增强：注入元数据与执行前瞻逻辑
            meta: MJAIMetadata = response.get("meta", {})
            self._post_react(meta, is_game_start)

            # 4. 收尾：业务规则应用与响应组装
            self._finalize_response(response, meta)

            return response

        except Exception as e:
            self.logger.exception(f"MortalBot runtime error in select_action: {e}")
            self.status.set_flag(NotificationCode.BOT_RUNTIME_ERROR)
            return {"type": "none"}

    def _pre_react(self, event: MJAIEvent) -> tuple[bool, bool]:
        """维护历史、处理生命周期事件。返回 (is_game_start, is_game_end)"""
        e_type = event["type"]
        is_game_start = False
        is_game_end = False

        # 生命周期：对局开始
        if e_type == "start_game":
            self._handle_start_game(event)
            is_game_start = True

        # 生命周期：单局开始
        elif e_type == "start_kyoku":
            self.history = []

        # 生命周期：对局结束
        elif e_type == "end_game":
            self._handle_end_game()
            is_game_end = True

        # 维护历史
        self.history.append(event)

        return is_game_start, is_game_end

    def _think(self, event: MJAIEvent) -> MJAIResponse:
        """调用引擎/模型获取决策动作"""
        if not self.model:
            return {"type": "none"}

        if self.engine:
            self.engine.is_sync = event.get("sync", False)

        try:
            # MJAI 协议底层 C++ Bot (mjai-python) 接受并返回 JSON 字符串
            res = self.model.react(json.dumps(event, separators=(",", ":")))
            # 解析响应并确保返回字典
            action = json.loads(res) if isinstance(res, str) else res
            return action if isinstance(action, dict) else {"type": "none"}
        except Exception as e:
            self.logger.error(f"MortalBot engine error: {e}")
            self.status.set_flag(
                NotificationCode.JSON_DECODE_ERROR
                if isinstance(e, json.JSONDecodeError)
                else NotificationCode.BOT_RUNTIME_ERROR
            )
            return {"type": "none"}
        finally:
            if self.engine:
                self.engine.is_sync = False

    def _post_react(self, meta: MJAIMetadata, is_game_start: bool) -> None:
        """元数据增强阶段"""
        # 1. 注入同步元数据
        meta.update(self.status.metadata)

        if is_game_start:
            meta["game_start"] = True

        # 3. 立直前瞻逻辑
        self._handle_riichi_lookahead(meta)

    def _finalize_response(self, response: MJAIResponse, meta: MJAIMetadata) -> None:
        """最终业务逻辑修正"""
        # 三麻抑制单一选项的 meta 显示
        if self.is_3p and "mask_bits" in meta and meta["mask_bits"].bit_count() == 1:
            response.pop("meta", None)
            return

        # 挂载 meta
        if meta:
            response["meta"] = meta

    def _handle_start_game(self, e: StartGameEvent):
        """处理游戏开始事件，初始化模型和引擎"""
        from akagi_ng.mjai_bot.engine.factory import load_bot_and_engine

        self.player_id = e["id"]
        self.model, self.engine = load_bot_and_engine(self.status, self.player_id, self.is_3p)
        self.history = []
        self.game_start_event = e

        # 检测加载的模型类型并设置通知
        if self.engine:
            engine_meta = self.status.metadata
            engine_type = engine_meta.get(NotificationCode.ENGINE_TYPE, "unknown")

            if engine_type == "akagiot":
                self.status.set_flag(NotificationCode.MODEL_LOADED_ONLINE)
            elif engine_type == "mortal":
                self.status.set_flag(NotificationCode.MODEL_LOADED_LOCAL)
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

    def _handle_riichi_lookahead(self, meta: MJAIMetadata):
        """
        处理立直前瞻逻辑
        """
        if "q_values" not in meta or "mask_bits" not in meta:
            return

        from akagi_ng.mjai_bot.utils import meta_to_recommend

        recommendations = meta_to_recommend(meta, is_3p=self.is_3p)
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

            reach_event = {"type": "reach", "actor": self.player_id}
            sim_meta: MJAIMetadata | None = lookahead_bot.simulate_reach(
                self.history,
                reach_event,
                game_start_event=self.game_start_event,
            )

            if not sim_meta:
                self.logger.warning("Riichi Lookahead: Simulation returned no metadata.")
                return None

            if "q_values" in sim_meta and "mask_bits" in sim_meta:
                from akagi_ng.mjai_bot.utils import meta_to_recommend

                sim_recs = meta_to_recommend(sim_meta, is_3p=self.is_3p)
                all_candidates = ", ".join([f"{action}({conf:.3f})" for action, conf in sim_recs])
                self.logger.info(f"Riichi Lookahead: Simulation success. Candidates: {all_candidates}")
                return sim_meta

            self.logger.warning("Riichi Lookahead: Simulation meta missing q_values or mask_bits.")
            return None

        except Exception as lookahead_err:
            self.logger.error(f"Riichi Lookahead failed: {lookahead_err}")
            return None
