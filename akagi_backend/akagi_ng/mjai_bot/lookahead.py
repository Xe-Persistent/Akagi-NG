import json

from akagi_ng.mjai_bot.engine.base import BaseEngine, InferenceResult, engine_options
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

        if is_3p:
            from akagi_ng.core.lib_loader import libriichi3p as libriichi
        else:
            from akagi_ng.core.lib_loader import libriichi

        # 创建新的 C++ Bot 实例，拥有干净的初始状态
        self.cpp_bot = libriichi.mjai.Bot(engine, player_id)

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
        # 1. 重构状态 (Replay)
        # 必须先发送 start_game 事件初始化 C++ Bot，再重放历史事件
        all_events: list[dict] = []
        if game_start_event:
            all_events.append(game_start_event)
        all_events.extend(history_events)

        # Context: is_sync=True -> 告诉 Engine 不要推理, 只更新状态
        with engine_options({"is_sync": True}):
            for e in all_events:
                e_json = json.dumps(e, separators=(",", ":"))
                try:
                    self.cpp_bot.react(e_json)
                except Exception as e:
                    # 如果中间出错(比如状态不对齐), 则无法进行后续模拟
                    logger.error(f"LookaheadBot: Replay failed at event {e_json}: {e}")
                    return None
        # 2. 执行候选事件（真正的推理）
        # 使用 context manager 传递配置，确保 engine 执行推理
        # 我们假设 candidate_event 是 reach 事件 (step 1)，
        # 此时 Bot 会进入立直待切牌状态，并请求 Engine 推理切哪张牌。
        cand_json = json.dumps(candidate_event, separators=(",", ":"))

        # 3. 从 C++ Bot 获取结果
        # libmjai 会将推理结果（包括 mask_bits）打包在 meta 中返回
        try:
            with engine_options({"is_sync": False}):
                response_json = self.cpp_bot.react(cand_json)

            if response_json:
                response = json.loads(response_json)
                meta = response.get("meta", {})
                if "mask_bits" in meta:
                    return meta

        except Exception as e:
            # Fallback (可能缺少 mask_bits)
            logger.error(f"LookaheadBot: cpp_bot.react failed: {e}")

        return None
