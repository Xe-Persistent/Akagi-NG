from akagi_ng.bridge.types import (
    AnkanEvent,
    ChiEvent,
    DahaiEvent,
    DaiminkanEvent,
    DoraEvent,
    EndGameEvent,
    EndKyokuEvent,
    KakanEvent,
    MJAIEvent,
    NukidoraEvent,
    PonEvent,
    ReachAcceptedEvent,
    ReachEvent,
    StartGameEvent,
    StartKyokuEvent,
    SystemEvent,
    TsumoEvent,
)
from akagi_ng.core.notification_codes import NotificationCode


class BaseBridge:
    """
    Bridge 基类。

    提供所有平台通用的状态属性和 MJAI 消息构建器方法。
    各平台继承此类并实现 `parse()` 方法。
    """

    def __init__(self):
        self.seat = 0

    def reset(self):
        """
        重置 Bridge 状态。
        """
        pass

    def parse(self, content: bytes) -> None | list[MJAIEvent]:
        """
        解析平台消息并返回 MJAI 指令列表。

        Args:
            content: 平台原始消息内容

        Returns:
            MJAI 格式消息列表，或 None（如果无法解析/无需返回）
        """
        raise NotImplementedError

    # ===== MJAI 消息构建器 =====

    def make_start_game(self, seat: int | None = None) -> StartGameEvent:
        """构建 start_game（游戏开始）消息"""
        return {"type": "start_game", "id": seat if seat is not None else self.seat}

    def make_start_kyoku(  # noqa: PLR0913
        self,
        bakaze: str,
        kyoku: int,
        honba: int,
        kyotaku: int,
        oya: int,
        dora_marker: str,
        scores: list[int],
        tehais: list[list[str]],
        **kwargs: object,
    ) -> StartKyokuEvent:
        """构建 start_kyoku（本局开始）消息"""
        msg: StartKyokuEvent = {
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
        # 支持额外字段（如 is_3p）
        if kwargs:
            msg.update(kwargs)  # type: ignore
        return msg

    def make_tsumo(self, actor: int, pai: str) -> TsumoEvent:
        """构建 tsumo（摸牌）消息"""
        return {"type": "tsumo", "actor": actor, "pai": pai}

    def make_dahai(self, actor: int, pai: str, tsumogiri: bool) -> DahaiEvent:
        """构建 dahai（弃牌）消息"""
        return {"type": "dahai", "actor": actor, "pai": pai, "tsumogiri": tsumogiri}

    def make_chi(self, actor: int, target: int, pai: str, consumed: list[str]) -> ChiEvent:
        """构建 chi（吃）消息"""
        return {"type": "chi", "actor": actor, "target": target, "pai": pai, "consumed": consumed}

    def make_pon(self, actor: int, target: int, pai: str, consumed: list[str]) -> PonEvent:
        """构建 pon（碰）消息"""
        return {"type": "pon", "actor": actor, "target": target, "pai": pai, "consumed": consumed}

    def make_daiminkan(self, actor: int, target: int, pai: str, consumed: list[str]) -> DaiminkanEvent:
        """构建 daiminkan（大明杠）消息"""
        return {"type": "daiminkan", "actor": actor, "target": target, "pai": pai, "consumed": consumed}

    def make_ankan(self, actor: int, consumed: list[str]) -> AnkanEvent:
        """构建 ankan（暗杠）消息"""
        return {"type": "ankan", "actor": actor, "consumed": consumed}

    def make_kakan(self, actor: int, pai: str, consumed: list[str]) -> KakanEvent:
        """构建 kakan（加杠）消息"""
        return {"type": "kakan", "actor": actor, "pai": pai, "consumed": consumed}

    def make_reach(self, actor: int) -> ReachEvent:
        """构建 reach（立直宣言）消息"""
        return {"type": "reach", "actor": actor}

    def make_reach_accepted(
        self, actor: int, deltas: list[int] | None = None, scores: list[int] | None = None
    ) -> ReachAcceptedEvent:
        """构建 reach_accepted（立直确认）消息"""
        msg: ReachAcceptedEvent = {"type": "reach_accepted", "actor": actor}
        if deltas is not None:
            msg["deltas"] = deltas
        if scores is not None:
            msg["scores"] = scores
        return msg

    def make_dora(self, dora_marker: str) -> DoraEvent:
        """构建 dora（新宝牌）消息"""
        return {"type": "dora", "dora_marker": dora_marker}

    def make_nukidora(self, actor: int) -> NukidoraEvent:
        """构建 nukidora（拔北）消息"""
        return {"type": "nukidora", "actor": actor, "pai": "N"}

    def make_end_kyoku(self) -> EndKyokuEvent:
        """构建 end_kyoku（本局结束）消息"""
        return {"type": "end_kyoku"}

    def make_end_game(self) -> EndGameEvent:
        """构建 end_game（游戏结束）消息"""
        return {"type": "end_game"}

    def make_system_event(self, code: str | NotificationCode, msg: str | None = None) -> SystemEvent:
        """构建 system_event（系统消息）"""
        event: SystemEvent = {"type": "system_event", "code": code}
        if msg is not None:
            event["msg"] = msg
        return event
