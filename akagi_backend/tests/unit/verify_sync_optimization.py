import json
from unittest.mock import MagicMock

import numpy as np

from akagi_ng.mjai_bot.engine.replay import ReplayEngine
from akagi_ng.mjai_bot.mortal.base import MortalBot


def test_replay_engine_vectorization():
    """验证 ReplayEngine 的向量化处理是否正确"""
    mock_delegate = MagicMock()
    mock_delegate.is_3p = True
    mock_delegate.name = "MockEngine"
    mock_delegate.is_oracle = False
    mock_delegate.version = 1

    engine = ReplayEngine(mock_delegate)
    engine.start_replaying()

    # 模拟 3 个 batch
    obs = np.zeros((3, 93, 34))
    masks = np.zeros((3, 54), dtype=bool)
    # 第一个 batch：只有索引 5 为 True
    masks[0, 5] = True
    # 第二个 batch：只有索引 10 为 True
    masks[1, 10] = True
    # 第三个 batch：全 False

    invisible_obs = np.zeros((3, 93, 34))

    actions, q_out, clean_masks, is_greedy = engine.react_batch(obs, masks, invisible_obs)

    assert actions == [5, 10, 0]
    assert len(q_out) == 3
    assert all(all(q == 0.0 for q in q_row) for q_row in q_out)
    assert clean_masks == masks.tolist()
    assert mock_delegate.react_batch.call_count == 0
    print("✓ ReplayEngine vectorization verified.")


def test_sync_with_real_log_data():
    """使用日志中真实的同步数据验证 MortalBot 的抑制逻辑"""
    # 模拟从日志提取的 57 个 MJAI 事件（简化示例，包含关键标记）
    # 真实场景中，这些事件由 MajsoulBridge._parse_sync_game 产生并带有 sync=True
    real_sync_events = [
        {"type": "system_event", "code": "game_syncing", "sync": True},
        {
            "type": "start_kyoku",
            "bakaze": "E",
            "dora_marker": "8p",
            "kyoku": 1,
            "honba": 0,
            "kyotaku": 0,
            "oya": 0,
            "scores": [35000, 35000, 35000, 0],
            "tehais": [
                ["3p", "4p", "7p", "7p", "8p", "E", "S", "S", "W", "W", "N", "P", "C"],
                ["?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?"],
                ["?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?"],
                ["?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?"],
            ],
            "is_3p": True,
            "sync": True,
        },
        {"type": "tsumo", "actor": 0, "pai": "C", "sync": True},
        {"type": "nukidora", "actor": 0, "pai": "N", "sync": True},
        {"type": "tsumo", "actor": 0, "pai": "E", "sync": True},
        {"type": "dahai", "actor": 0, "pai": "P", "tsumogiri": False, "sync": True},
        # ... 后续 50+ 个事件
    ]
    # 添加剩余的模拟事件以达到较大的数据量
    for i in range(51):
        real_sync_events.append({"type": "none", "sync": True, "id": i})

    mock_engine = MagicMock(spec=ReplayEngine)
    mock_model = MagicMock()
    # 模拟模型在同步期间返回 dummy 响应
    mock_model.react.return_value = json.dumps({"type": "none"})

    bot = MortalBot(is_3p=True)
    bot.model = mock_model
    bot.engine = mock_engine
    bot.player_id = 0

    print(f"Feeding {len(real_sync_events)} real-world sync events to MortalBot...")

    # 执行处理
    bot._process_events(real_sync_events)

    # 验证每一个带有 sync=True 的事件都触发了 start_replaying 和 stop_replaying
    # 在 MortalBot._process_events 中，每个事件都会调用：
    # if is_sync: engine.start_replaying()
    # model.react()
    # if is_sync: engine.stop_replaying()
    assert mock_engine.start_replaying.call_count == len(real_sync_events)
    assert mock_engine.stop_replaying.call_count == len(real_sync_events)

    # 验证 JSON 缓存：由于第 2 个事件 (index=1) 是 start_kyoku，它会重置历史记录
    # 最终长度应该是 len(real_sync_events) - 1 = 56
    assert len(bot.history_json) == 56
    # 验证 model.react 收到的是预序列化的缓存字符串
    last_call_args = mock_model.react.call_args[0][0]
    assert isinstance(last_call_args, str)
    assert last_call_args == bot.history_json[-1]

    print(f"✓ {len(real_sync_events)} events processed with zero redundant inference and full caching.")


if __name__ == "__main__":
    try:
        test_replay_engine_vectorization()
        test_sync_with_real_log_data()
        print("\nAll verification tests with REAL LOG DATA PASSED.")
    except Exception:
        import traceback

        traceback.print_exc()
        exit(1)
