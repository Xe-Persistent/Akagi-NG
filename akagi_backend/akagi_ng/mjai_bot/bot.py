import json

from mjai import Bot
from mjai.bot.tools import calc_shanten
from mjai.mlibriichi.state import PlayerState

from akagi_ng.mjai_bot.logger import logger
from akagi_ng.mjai_bot.status import BotStatusContext
from akagi_ng.schema.constants import MahjongConstants
from akagi_ng.schema.notifications import NotificationCode
from akagi_ng.schema.protocols import BotProtocol
from akagi_ng.schema.types import MJAIEvent, MJAIMetadata, MJAIResponse


class StateTrackerBot(Bot, BotProtocol):
    """
    状态追踪 Bot，用于跟踪游戏状态。
    重写部分 mjai.Bot 方法以兼容 Akagi 应用。
    """

    def __init__(self, status: BotStatusContext):
        super().__init__()
        self.status = status
        self.is_3p = False
        self.meta: MJAIMetadata = {}
        self.__discard_events: list[MJAIEvent] = []
        self.__call_events: list[MJAIEvent] = []
        self.__dora_indicators: list[str] = []

    def react(self, event: MJAIEvent) -> MJAIResponse:
        try:
            # 追踪辅助状态并更新核心引擎
            processed_event = event
            match event["type"]:
                case "start_game":
                    self.player_id = event["id"]
                    self.player_state = PlayerState(self.player_id)
                    self.is_3p = event["is_3p"]
                    self.__discard_events = []
                    self.__call_events = []
                    self.__dora_indicators = []
                case "start_kyoku":
                    self.__dora_indicators.append(event["dora_marker"])
                case "dora":
                    self.__dora_indicators.append(event["dora_marker"])
                case "dahai":
                    self.__discard_events.append(event)
                case "chi" | "pon" | "daiminkan" | "kakan" | "ankan":
                    self.__call_events.append(event)
                case "nukidora":
                    # 三麻兼容：mjai.mlibriichi 状态追踪库不支持 nukidora，需要转换为 dahai 事件
                    processed_event = {
                        "type": "dahai",
                        "actor": event["actor"],
                        "pai": "N",
                        "tsumogiri": self.last_self_tsumo == "N" and event["actor"] == self.player_id,
                    }
                    self.__discard_events.append(processed_event)
                case _:
                    pass

            logger.debug(f"Event: {processed_event}")
            self.action_candidate = self.player_state.update(json.dumps(processed_event))

            return {"type": "none"}

        except BaseException:
            logger.exception(f"Exception in react. Brief info:\n{self.brief_info()}")
            self.status.set_flag(NotificationCode.STATE_TRACKER_ERROR)

        return {"type": "none"}

    # ==========================================================
    # 杠操作相关实现（大明杠、暗杠、加杠）

    def find_daiminkan_candidates(self) -> list[dict]:
        """寻找大明杠候选"""
        current_shanten = calc_shanten(self.tehai)

        candidates = []

        # 检查手牌中是否有 3 张与最后弃牌相同的牌
        target_tile = self.last_kawa_tile
        base_tile = target_tile.replace("r", "")  # 处理赤五

        hand_tiles = self.tehai_mjai
        matching_tiles = [t for t in hand_tiles if t.replace("r", "") == base_tile]

        if len(matching_tiles) >= MahjongConstants.DAIMINKAN_CONSUMED:  # 大明杠需要3张
            consumed = matching_tiles[:3]
            candidates.append(self.__new_kan_candidate(consumed, "daiminkan", current_shanten))

        return candidates

    def find_ankan_candidates(self) -> list[dict]:
        """寻找暗杠候选"""
        candidates = []

        # 暗杠需要手牌中有 4 张相同的牌
        hand_tiles = self.tehai_mjai
        current_shanten = calc_shanten(self.tehai)
        counts = {}
        for t in hand_tiles:
            base = t.replace("r", "")
            if base not in counts:
                counts[base] = []
            counts[base].append(t)

        for tiles in counts.values():
            if len(tiles) == MahjongConstants.ANKAN_TILES:
                consumed = tiles
                candidates.append(self.__new_kan_candidate(consumed, "ankan", current_shanten))

        return candidates

    def find_kakan_candidates(self) -> list[dict]:
        """寻找加杠候选"""
        candidates = []

        # 加杠需要手牌中有一张与已有碰副相同的牌
        events = [ev for ev in self.__call_events if ev.get("actor") == self.player_id]
        pons = [ev for ev in events if ev["type"] == "pon"]
        current_shanten = calc_shanten(self.tehai)

        hand_tiles = self.tehai_mjai
        for pon in pons:
            consumed_base = pon["consumed"][0].replace("r", "")
            matches = [t for t in hand_tiles if t.replace("r", "") == consumed_base]
            if matches:
                candidates.append(self.__new_kan_candidate(matches[:1], "kakan", current_shanten))

        return candidates

    def __new_kan_candidate(self, consumed: list[str], kan_type: str, current_shanten: int = 0) -> dict:
        """创建杠候选字典"""
        new_tehai_mjai = self.tehai_mjai.copy()
        for c in consumed:
            if c in new_tehai_mjai:
                new_tehai_mjai.remove(c)

        event = {}
        if kan_type == "daiminkan":
            event = {
                "type": "daiminkan",
                "consumed": consumed,
                "pai": self.last_kawa_tile,
                "target": self.target_actor,
                "actor": self.player_id,
            }
        elif kan_type == "ankan":
            event = {
                "type": "ankan",
                "consumed": consumed,
                "actor": self.player_id,
            }
        elif kan_type == "kakan":
            event = {
                "type": "kakan",
                "pai": consumed[0],
                "consumed": consumed,
                "actor": self.player_id,
            }

        return {
            "consumed": consumed,
            "event": event,
            "current_shanten": current_shanten,
            "current_ukeire": 0,  # 占位符
            "discard_candidates": [],
            "next_shanten": 0,  # 占位符
            "next_ukeire": 0,  # 占位符
        }
