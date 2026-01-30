"""测试 Controller 的 Bot 切换逻辑"""

import json
import sys
from unittest.mock import MagicMock, patch

sys.path.insert(0, ".")


def test_bot_switch_scenarios():
    """测试各种 Bot 切换场景"""

    # 创建 mock Bot 类
    class MockMortalBot:
        def __init__(self, *args, **kwargs):
            pass

        def react(self, events: str) -> str:
            return json.dumps({"type": "none"})

    class MockMortal3pBot:
        def __init__(self, *args, **kwargs):
            pass

        def react(self, events: str) -> str:
            return json.dumps({"type": "none"})

    # Patch 在 Controller 导入前替换
    with patch.dict(
        "sys.modules",
        {"akagi_ng.mjai_bot.mortal.bot": MagicMock(MortalBot=MockMortalBot, Mortal3pBot=MockMortal3pBot)},
    ):
        # 重新导入 Controller
        from importlib import reload

        import akagi_ng.mjai_bot.controller as controller_module

        reload(controller_module)
        Controller = controller_module.Controller

        # 手动设置 available_bots（因为 mock 的类和实际类不一样）
        def create_controller():
            c = Controller.__new__(Controller)
            c.available_bots = [MockMortalBot, MockMortal3pBot]
            c.available_bots_names = ["mortal", "mortal3p"]
            c.bot = MockMortalBot()  # 默认四麻
            c.pending_start_game_event = None
            return c

        # 场景 1：正常四麻游戏
        print("=== 场景 1：正常四麻游戏 ===")
        controller = create_controller()
        print(f"初始化后 Bot: {type(controller.bot).__name__}")

        controller.react({"type": "start_game", "id": 0})
        controller.react(
            {
                "type": "start_kyoku",
                "scores": [25000, 25000, 25000, 25000],
                "bakaze": "E",
                "kyoku": 1,
                "honba": 0,
                "kyotaku": 0,
                "oya": 0,
                "dora_marker": "1p",
                "tehais": [["?"] * 13] * 4,
            }
        )
        print(f"start_kyoku 后 Bot: {type(controller.bot).__name__}")
        assert type(controller.bot).__name__ == "MockMortalBot", "四麻应该使用 mortal"
        print("✅ 场景 1 通过\n")

        # 场景 2：正常三麻游戏
        print("=== 场景 2：正常三麻游戏 ===")
        controller2 = create_controller()
        controller2.react({"type": "start_game", "id": 0})
        controller2.react(
            {
                "type": "start_kyoku",
                "scores": [35000, 35000, 35000, 0],
                "bakaze": "E",
                "kyoku": 1,
                "honba": 0,
                "kyotaku": 0,
                "oya": 0,
                "dora_marker": "1p",
                "tehais": [["?"] * 13] * 4,
            }
        )
        print(f"start_kyoku 后 Bot: {type(controller2.bot).__name__}")
        assert type(controller2.bot).__name__ == "MockMortal3pBot", "三麻应该使用 mortal3p"
        print("✅ 场景 2 通过\n")

        # 场景 3：重连场景（无 start_game，直接 start_kyoku）
        print("=== 场景 3：重连场景（无 start_game） ===")
        controller3 = create_controller()
        print(f"初始化后 Bot: {type(controller3.bot).__name__}")
        # 直接发送 start_kyoku（模拟重连，没有 start_game）
        controller3.react(
            {
                "type": "start_kyoku",
                "scores": [35000, 35000, 35000, 0],
                "bakaze": "E",
                "kyoku": 1,
                "honba": 0,
                "kyotaku": 0,
                "oya": 0,
                "dora_marker": "1p",
                "tehais": [["?"] * 13] * 4,
            }
        )
        print(f"重连 start_kyoku 后 Bot: {type(controller3.bot).__name__}")
        assert type(controller3.bot).__name__ == "MockMortal3pBot", "重连三麻应该切换到 mortal3p"
        print("✅ 场景 3 通过\n")

        # 场景 4：nukidora 事件触发切换
        print("=== 场景 4：nukidora 事件触发切换 ===")
        controller4 = create_controller()
        print(f"初始化后 Bot: {type(controller4.bot).__name__}")
        # 直接发送 nukidora（最极端的重连场景）
        controller4.react({"type": "nukidora", "actor": 0, "pai": "N"})
        print(f"nukidora 后 Bot: {type(controller4.bot).__name__}")
        assert type(controller4.bot).__name__ == "MockMortal3pBot", "nukidora 应该触发切换到 mortal3p"
        print("✅ 场景 4 通过\n")

        print("🎉 所有测试通过！")


if __name__ == "__main__":
    test_bot_switch_scenarios()
