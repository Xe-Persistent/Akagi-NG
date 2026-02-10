import json

from akagi_ng.mjai_bot.engine.base import BaseEngine, InferenceResult
from akagi_ng.mjai_bot.logger import logger


class LookaheadBot:
    """
    专门用于立直前瞻（Lookahead）的 Bot。
    它不维护长期的游戏状态，而是通过快速重放历史事件来恢复状态，
    并对候选切牌进行模拟推理。
    """

    def __init__(self, engine: BaseEngine, player_id: int, is_3p: bool = False):
        self.engine = engine
        self.player_id = player_id
        self.is_3p = is_3p

    def simulate_reach(
        self,
        history_events: list[dict],
        candidate_event: dict,
        game_start_event: dict | None = None,
    ) -> InferenceResult | None:
        """
        在当前状态下模拟 Reach, 并返回 meta 数据(含 q_values/mask_bits)。

        Args:
            history_events: 当前局的历史事件（start_kyoku 之后的事件）
            candidate_event: 候选的 reach 事件
            game_start_event: 游戏开始事件，用于初始化 C++ Bot 状态
        """
        from akagi_ng.mjai_bot.engine.replay import ReplayEngine

        # 1. 构造 ReplayEngine 包装器
        # 这将隔离回放状态与真实引擎状态，确保 C++ Bot 能正确获取元数据
        replay_engine = ReplayEngine(self.engine)

        # 2. 为模拟创建一个专用的 C++ Bot 实例
        # 必须使用 replay_engine 初始化，以便拦截回放请求
        if self.is_3p:
            from akagi_ng.core.lib_loader import libriichi3p as libs
        else:
            from akagi_ng.core.lib_loader import libriichi as libs

        # 注意：这里我们创建了一个新的 bot 实例，专门用于此次模拟
        # 这比复用 self.cpp_bot 更安全，因为它是完全隔离的
        sim_bot = libs.mjai.Bot(replay_engine, self.player_id)

        # 3. 重放历史事件
        # ReplayEngine 处于 replay_mode=True，会快速响应，不调用底层引擎
        all_events: list[dict] = []
        if game_start_event:
            all_events.append(game_start_event)
        all_events.extend(history_events)

        for e in all_events:
            e_json = json.dumps(e, separators=(",", ":"))
            try:
                sim_bot.react(e_json)
            except Exception as e:
                logger.error(f"LookaheadBot: Replay failed at event {e_json}: {e}")
                return None

        # 4. 执行候选事件（真正的推理）
        # 停止回放模式，允许请求穿透到底层引擎 (Provider -> AkagiOT/Mortal)
        replay_engine.stop_replaying()

        cand_json = json.dumps(candidate_event, separators=(",", ":"))

        try:
            # 此时调用底层引擎，应该能正确获取完整元数据
            response_json = sim_bot.react(cand_json)

            if response_json:
                response = json.loads(response_json)
                meta = response.get("meta", {})
                if "mask_bits" in meta:
                    return meta

                # 如果仍然缺少，可能是 engine 本身的问题，但 ReplayEngine 架构已尽力保证环境一致性
                logger.warning("LookaheadBot: ReplayEngine returned meta without mask_bits")

        except Exception as e:
            logger.error(f"LookaheadBot: sim_bot.react failed: {e}")

        return None
