from unittest.mock import MagicMock

from akagi_ng.mjai_bot.controller import Controller


def test_controller_lifecycle_replay():
    """验证 Controller 在监听到 start_kyoku 时能正确加载 Bot 并重放 start_game"""
    controller = Controller()

    # 模拟 start_game 事件
    start_game_event = {"type": "start_game", "id": 1, "is_3p": False}
    controller.react(start_game_event)

    # 我们不仅需要实例化 Mock，还需要让这个 Mock 符合协议
    mock_instance = MagicMock()
    mock_instance.react.return_value = {"type": "none"}
    mock_instance.notification_flags = {}

    # 手动替换 available_bots 里的工厂函数/类
    # Controller.available_bots 存储的是类，实例化时调用类(status=self.status)
    # 我们用 lambda 返回 mock_instance
    controller.available_bots[1] = lambda status=None: mock_instance  # mortal3p 是 index 1

    # 【修正】必须通过 start_game 触发 Bot 加载/重放
    # 模拟重连/新对局的 start_game
    new_start_game = {"type": "start_game", "id": 1, "is_3p": True}
    controller.react(new_start_game)

    start_kyoku_event = {"type": "start_kyoku", "scores": [35000, 35000, 35000, 0], "is_3p": True}
    res = controller.react(start_kyoku_event)
    assert res == {"type": "none"}

    # 验证 start_game 被重放给 Bot
    # react.call_count 应为 2 (start_game 和 start_kyoku)
    assert mock_instance.react.call_count == 2
    mock_instance.react.assert_any_call(new_start_game)
    mock_instance.react.assert_any_call(start_kyoku_event)


def test_controller_bot_switching():
    """验证从 4p 切换到 3p 时，新 Bot 也能收到 start_game"""
    controller = Controller()
    start_game_event = {"type": "start_game", "id": 2, "is_3p": False}

    mock_4p = MagicMock()
    mock_4p.react.return_value = {"type": "none"}

    mock_3p = MagicMock()
    mock_3p.react.return_value = {"type": "none"}

    controller.available_bots[0] = lambda status=None: mock_4p
    controller.available_bots[1] = lambda status=None: mock_3p

    controller.react(start_game_event)

    # 1. 激活 4p
    controller.react({"type": "start_kyoku", "scores": [25000] * 4, "is_3p": False})
    assert controller.bot == mock_4p
    mock_4p.react.assert_any_call(start_game_event)

    # 2. 切换到 3p
    controller.react({"type": "start_game", "id": 0, "is_3p": True})
    controller.react({"type": "start_kyoku", "scores": [35000, 35000, 35000, 0], "is_3p": True})
    assert controller.bot == mock_3p
    # mock_3p 收到的是触发它加载的 start_game (即 is_3p=True 的那个)
    mock_3p.react.assert_any_call({"type": "start_game", "id": 0, "is_3p": True})
