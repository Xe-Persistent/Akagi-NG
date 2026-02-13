from akagi_ng.schema.types import (
    EngineAdditionalMeta,
    EngineAdditionalMetaKey,
    EngineType,
    NotificationFlagKey,
    NotificationFlags,
)


class BotStatusContext:
    """
    Bot 状态上下文。
    用于在 Bot 的生命周期内，由各个组件（Bot, Engine, Provider）直接报告状态标志和元数据，
    避免层层传递和聚合。
    """

    def __init__(self):
        self._flags: NotificationFlags = {}
        self._metadata: EngineAdditionalMeta = {}

    def set_flag(self, key: NotificationFlagKey, value: bool = True) -> None:
        """设置通知标志位"""
        self._flags[key] = value

    def update_flags(self, flags: NotificationFlags) -> None:
        """批量更新标志位"""
        self._flags.update(flags)

    def set_metadata(self, key: EngineAdditionalMetaKey, value: EngineType | bool) -> None:
        """设置附加元数据"""
        self._metadata[key] = value

    def update_metadata(self, metadata: EngineAdditionalMeta) -> None:
        """批量更新元数据"""
        self._metadata.update(metadata)

    @property
    def flags(self) -> NotificationFlags:
        """获取所有标志位"""
        return self._flags.copy()

    @property
    def metadata(self) -> EngineAdditionalMeta:
        """获取所有元数据"""
        return self._metadata.copy()

    def clear_flags(self) -> None:
        """清除所有通知标志位"""
        self._flags.clear()

    def clear_metadata(self) -> None:
        """清除所有附加元数据"""
        self._metadata.clear()

    def clear(self) -> None:
        """重置所有状态"""
        self.clear_flags()
        self.clear_metadata()
