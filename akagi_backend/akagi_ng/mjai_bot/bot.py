import json

from mjai import Bot
from mjai.bot.tools import calc_shanten
from mjai.mlibriichi.state import PlayerState

from akagi_ng.core import NotificationCode
from akagi_ng.core.constants import MahjongConstants
from akagi_ng.mjai_bot.logger import logger
from akagi_ng.mjai_bot.utils import make_error_response


class StateTrackerBot(Bot):
    """
    状态追踪 Bot，用于跟踪游戏状态。
    重写部分 mjai.Bot 方法以兼容 Akagi 应用。
    """

    def __init__(self):
        super().__init__()
        self.is_3p = False
        self.meta = {}
        self.notification_flags = {}  # 系统状态通知标志
        self.__discard_events = []
        self.__call_events = []
        self.__dora_indicators = []

    def think(self) -> str:
        """默认行为：自摸切"""
        if self.can_discard:
            tile_str = self.last_self_tsumo
            return self.action_discard(tile_str)
        return self.action_nothing()

    def react(self, event: dict) -> str:
        try:
            if not event:
                raise ValueError("Empty event")

            if event["type"] == "start_game":
                self.player_id = event["id"]
                self.player_state = PlayerState(self.player_id)
                self.is_3p = False
                self.__discard_events = []
                self.__call_events = []
                self.__dora_indicators = []
            # 使用 Bridge 传递的 is_3p 字段判断游戏是四麻还是三麻对局
            if event["type"] == "start_kyoku":
                self.is_3p = event.get("is_3p")
            if event["type"] == "start_kyoku" or event["type"] == "dora":
                self.__dora_indicators.append(event["dora_marker"])
            if event["type"] == "dahai":
                self.__discard_events.append(event)
            if event["type"] in [
                "chi",
                "pon",
                "daiminkan",
                "kakan",
                "ankan",
            ]:
                self.__call_events.append(event)
            # 三麻兼容：mjai.mlibriichi 状态追踪库不支持 nukidora，转换为 dahai 事件
            if event["type"] == "nukidora":
                logger.debug(f"Event: {event}")
                replace_event = {
                    "type": "dahai",
                    "actor": event["actor"],
                    "pai": "N",
                    "tsumogiri": self.last_self_tsumo == "N" and event["actor"] == self.player_id,
                }
                self.__discard_events.append(replace_event)
                self.action_candidate = self.player_state.update(json.dumps(replace_event))

            else:
                logger.debug(f"Event: {event}")
                self.action_candidate = self.player_state.update(json.dumps(event))

            # 立直后自动摸切（除非可以和牌/暗杠）
            if self.self_riichi_accepted and not (self.can_agari or self.can_ankan) and self.can_discard:
                return self.action_discard(self.last_self_tsumo)

            return self.think()

        except BaseException as e:
            logger.error(f"Exception: {e!s}")
            logger.error("Brief info:")
            logger.error(self.brief_info())
            import traceback

            logger.error(traceback.format_exc())

        return json.dumps(make_error_response(NotificationCode.STATE_TRACKER_ERROR), separators=(",", ":"))

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
