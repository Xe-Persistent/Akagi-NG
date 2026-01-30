import json

from akagi_ng.core import NotificationCode
from akagi_ng.mjai_bot.logger import logger
from akagi_ng.mjai_bot.protocols import Bot
from akagi_ng.mjai_bot.utils import make_error_response


class Controller:
    def __init__(self):
        self.available_bots: list[type[Bot]] = []
        self.available_bots_names: list[str] = []
        self.bot: Bot | None = None
        self.list_available_bots()
        # Bot 将在收到第一个 start_kyoku 事件时延迟初始化
        self.pending_start_game_event: dict | None = None

    @property
    def notification_flags(self) -> dict:
        """从底层 Bot 获取通知标志"""
        if self.bot and hasattr(self.bot, "notification_flags"):
            return self.bot.notification_flags
        return {}

    def list_available_bots(self) -> list[type[Bot]]:
        from akagi_ng.mjai_bot.mortal import Mortal3pBot, MortalBot

        self.available_bots = [MortalBot, Mortal3pBot]
        self.available_bots_names = ["mortal", "mortal3p"]
        return self.available_bots

    def _handle_nukidora_event(self) -> dict | None:
        """处理 nukidora 事件（三麻特有）"""
        current_bot_name = self._get_current_bot_name()
        if current_bot_name != "mortal3p":
            logger.warning(
                f"Received nukidora event but current bot is '{current_bot_name}'. "
                "Switching to mortal3p (mid-game recovery)."
            )
            if not self._choose_bot_name("mortal3p"):
                logger.error("Failed to switch to mortal3p bot")
                return make_error_response(NotificationCode.BOT_SWITCH_FAILED)
        return None

    def _handle_start_game_event(self, event: dict) -> dict:
        """处理 start_game 事件"""
        self.pending_start_game_event = event
        return {"type": "none"}

    def _handle_start_kyoku_event(self, event: dict) -> dict | None:
        """处理 start_kyoku 事件，负责 Bot 的加载和切换"""
        # 优先使用 Bridge 传递的 is_3p 字段，如果不存在则回退到分数判断
        is_3p = event.get("is_3p", event["scores"][3] == 0)
        target_bot = "mortal3p" if is_3p else "mortal"
        current_bot_name = self._get_current_bot_name()

        # 如果 Bot 未初始化或类型不匹配,则加载/切换到正确的 Bot
        if current_bot_name != target_bot:
            if not self.bot:
                logger.info(f"Loading '{target_bot}' bot")
            else:
                logger.info(f"Switching bot from '{current_bot_name}' to '{target_bot}'")
            if not self._choose_bot_name(target_bot):
                logger.error(f"Failed to load {target_bot} bot")
                return make_error_response(NotificationCode.BOT_SWITCH_FAILED)
        return None

    def _process_bot_reaction(self, event: dict) -> dict:
        """处理 Bot 响应并解析结果"""
        events = [event]
        if self.pending_start_game_event:
            events.insert(0, self.pending_start_game_event)
            self.pending_start_game_event = None

        ans = self.bot.react(json.dumps(events, separators=(",", ":")))
        logger.trace(f"<- {ans}")
        try:
            return json.loads(ans)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse bot response: {e}")
            return make_error_response(NotificationCode.JSON_DECODE_ERROR)

    def react(self, event: dict) -> dict:
        try:
            # 允许在 Bot 未初始化时处理 start_game 和 start_kyoku 事件
            if not self.bot and event["type"] not in ("start_game", "start_kyoku"):
                logger.error("No bot available")
                return make_error_response(NotificationCode.NO_BOT_LOADED)

            result = None

            # 三麻特殊事件检测：nukidora 只存在于三麻中
            if event["type"] == "nukidora":
                result = self._handle_nukidora_event()
                if result:
                    return result

            # start_game 事件
            if event["type"] == "start_game":
                result = self._handle_start_game_event(event)

            # 在 start_kyoku 时根据游戏模式加载或切换 Bot
            elif event["type"] == "start_kyoku":
                result = self._handle_start_kyoku_event(event)
                if result:
                    return result
                result = None  # 重置为 None，继续处理

            # 检查 pending_start_game_event 的一致性
            if result is None and self.pending_start_game_event and event["type"] != "start_kyoku":
                logger.error("Event after start_game is not start_kyoku!")
                logger.error(f"Event: {event}")
                result = {"type": "none"}

            # 处理 Bot 响应
            if result is None:
                result = self._process_bot_reaction(event)

            return result

        except Exception as e:
            logger.exception(f"Controller error: {e}")
            return make_error_response(NotificationCode.BOT_RUNTIME_ERROR)

    def _get_current_bot_name(self) -> str | None:
        if not self.bot:
            return None
        try:
            return self.available_bots_names[self.available_bots.index(type(self.bot))]
        except ValueError:
            return None

    def _choose_bot_index(self, bot_index: int) -> bool:
        if 0 <= bot_index < len(self.available_bots):
            self.bot = self.available_bots[bot_index]()
            return True
        return False

    def _choose_bot_name(self, bot_name: str) -> bool:
        if bot_name in self.available_bots_names:
            index = self.available_bots_names.index(bot_name)
            self.bot = self.available_bots[index]()
            return True
        return False
