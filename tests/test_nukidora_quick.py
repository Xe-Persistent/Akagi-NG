"""快速测试 nukidora 事件的处理"""

import json
import sys

sys.path.insert(0, ".")

from lib import libriichi3p


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
bot = libriichi3p.mjai.Bot(engine, 0)

# start_game
bot.react(json.dumps({"type": "start_game", "id": 0}))
print("start_game OK")

# start_kyoku
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
            "tehais": [["1m"] * 13, ["2m"] * 13, ["3m"] * 13, ["?"] * 13],
            "scores": [35000, 35000, 35000, 0],
        }
    )
)
print("start_kyoku OK")

# nukidora - 关键测试（不先 tsumo）
try:
    result = bot.react(json.dumps({"type": "nukidora", "actor": 0, "pai": "N"}))
    print(f"nukidora OK, result: {result}")
except Exception as e:
    print(f"nukidora FAILED: {e}")
