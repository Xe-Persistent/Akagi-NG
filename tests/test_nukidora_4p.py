"""测试 libriichi (4p) 对 nukidora 的处理"""

import json
import sys

sys.path.insert(0, ".")

from lib import libriichi


class MockEngine:
    name = "mock"
    is_oracle = False
    version = 1
    enable_rule_based_agari_guard = False
    enable_quick_eval = False

    def react_batch(self, obs, masks, invisible_obs):
        return [0], [0], [0], [0]


# 初始化
engine = MockEngine()
bot = libriichi.mjai.Bot(engine, 0)

# start_game
bot.react(json.dumps({"type": "start_game", "id": 0}))
print("start_game OK")

# start_kyoku (4p style)
bot.react(
    json.dumps(
        {
            "type": "start_kyoku",
            "bakaze": "E",
            "kyoku": 1,
            "honba": 0,
            "kyotaku": 0,
            "oya": 0,
            "dora_marker": "1p",
            "tehais": [
                ["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1p", "2p", "3p", "4p"],
                ["1s", "2s", "3s", "4s", "5s", "6s", "7s", "8s", "9s", "E", "S", "W", "N"],
                ["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1p", "2p", "3p", "4p"],
                ["1s", "2s", "3s", "4s", "5s", "6s", "7s", "8s", "9s", "E", "S", "W", "N"],
            ],
            "scores": [25000, 25000, 25000, 25000],
        }
    )
)
print("start_kyoku OK")

# nukidora - 测试 4p libriichi
try:
    result = bot.react(json.dumps({"type": "nukidora", "actor": 0, "pai": "N"}))
    print(f"nukidora OK, result: {result}")
except Exception as e:
    print(f"nukidora FAILED: {e}")
