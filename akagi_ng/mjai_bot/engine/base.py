from akagi_ng.settings import local_settings


class BaseEngine:
    def __init__(self, is_3p: bool, version: int, name: str, is_oracle: bool = False):
        self.is_3p = is_3p
        self.version = version
        self.name = name
        self.is_oracle = is_oracle

        # 默认属性，应由子类设置
        self.engine_type = "base"
        self.is_online = False
        self.last_inference_result = None

    @property
    def enable_amp(self) -> bool:
        return local_settings.model_config.enable_amp

    @property
    def enable_rule_based_agari_guard(self) -> bool:
        return local_settings.model_config.rule_based_agari_guard

    @property
    def enable_quick_eval(self) -> bool:
        return local_settings.model_config.enable_quick_eval

    def react_batch(self, obs, masks, invisible_obs):
        raise NotImplementedError

    def get_notification_flags(self) -> dict:
        """
        返回引擎的通知标志。
        子类可重写以提供引擎特定的通知状态。

        Returns:
            通知标志字典
        """
        return {}
