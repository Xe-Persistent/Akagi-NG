from akagi_ng.mjai_bot.logger import logger
from akagi_ng.mjai_bot.status import BotStatusContext
from akagi_ng.schema.notifications import NotificationCode
from akagi_ng.schema.protocols import BotProtocol
from akagi_ng.schema.types import (
    AkagiEvent,
    MJAIResponse,
    StartGameEvent,
)


class Controller:
    def __init__(self, status: BotStatusContext | None = None):
        self._bot_registry: dict[str, type[BotProtocol]] = {}
        self.bot: BotProtocol | None = None
        self.status = status or BotStatusContext()
        self._register_bots()
        # Bot 将在收到第一个 start_game 事件时初始化
        self.pending_start_game_event: StartGameEvent | None = None

    def _register_bots(self) -> None:
        from akagi_ng.mjai_bot.mortal import Mortal3pBot, MortalBot

        self._bot_registry = {
            "mortal": MortalBot,
            "mortal3p": Mortal3pBot,
        }

    def react(self, event: AkagiEvent) -> MJAIResponse:
        """
        处理来自 Bridge 的事件序列。
        """
        try:
            # 清除本轮的通知标志
            self.status.clear_flags()
            return self._handle_event(event)

        except Exception as e:
            logger.exception(f"Controller error: {e}")
            return {"type": "none"}

    def _handle_event(self, event: AkagiEvent) -> MJAIResponse:
        """分发单个事件并确保 Bot 已就绪"""
        e_type = event["type"]

        # 1. 拦截并处理特殊的管理事件
        match e_type:
            case "start_game":
                return self._handle_start_game_event(event)
            case "system_event":
                return {"type": "none"}
            case _:
                pass

        # 2. 安全检查：如果从未收到过 start_game 或 bot 激活失败
        if self.bot is None:
            if e_type not in ("start_game", "start_kyoku"):
                logger.error(f"Received event {e_type} before bot activation. Bot is not active.")
            return {"type": "none"}

        # 3. 正常执行决策
        try:
            result = self.bot.react(event)
            if not isinstance(result, dict) or "type" not in result:
                logger.error(f"Bot returned invalid response type: {type(result)}")
                self.status.set_flag(NotificationCode.BOT_RUNTIME_ERROR)
                return {"type": "none"}
            logger.trace(f"<- {result}")
            return result
        except Exception as e:
            logger.exception(f"Error calling bot.react: {e}")
            self.status.set_flag(NotificationCode.BOT_RUNTIME_ERROR)
            return {"type": "none"}

    def _handle_start_game_event(self, event: StartGameEvent) -> MJAIResponse:
        """处理 start_game 事件：重置状态并缓存上下文"""
        self.pending_start_game_event = event
        # 重置当前 Bot
        self.bot = None

        # 模式信息（is_3p）现在是强制的，立即确定并激活 Bot
        is_3p = event["is_3p"]
        logger.info(f"StartGame event mode: is_3p={is_3p}. Activating bot immediately.")
        self._ensure_bot_activated(is_3p)

        return {"type": "none"}

    def _ensure_bot_activated(self, is_3p: bool) -> None:
        """
        确保正确的 Bot 已经加载并完成了初始化（Context Sync）。
        """
        target_name = "mortal3p" if is_3p else "mortal"
        current_name = self._get_current_bot_name()

        if current_name != target_name:
            if not self.bot:
                logger.info(f"Activating {target_name} bot.")
            else:
                logger.info(f"Switching bot from {current_name} to {target_name}.")

            if not self._choose_bot(target_name):
                logger.error(f"Failed to load {target_name} bot")
                self.status.set_flag(NotificationCode.BOT_SWITCH_FAILED)
                return

            if self.pending_start_game_event:
                logger.debug(f"Replaying cached start_game to new {target_name} bot.")
                self.bot.react(self.pending_start_game_event)
            else:
                logger.error(f"No pending start_game event to replay for {target_name} bot activation.")
                self.status.set_flag(NotificationCode.MODEL_LOAD_FAILED)

    def _get_current_bot_name(self) -> str | None:
        if not self.bot:
            return None
        bot_type = type(self.bot)
        for name, cls in self._bot_registry.items():
            if cls is bot_type:
                return name
        return None

    def _choose_bot(self, bot_name: str) -> bool:
        if bot_cls := self._bot_registry.get(bot_name):
            self.bot = bot_cls(status=self.status)
            return True
        return False
