from akagi_ng.bridge.majsoul import MajsoulBridge


def test_action_prototype_captures_self_operation_list_for_autoplay():
    bridge = MajsoulBridge()
    bridge.seat = 1

    message = {
        "method": ".lq.ActionPrototype",
        "type": 1,
        "data": {
            "step": 18,
            "name": "ActionDealTile",
            "data": {
                "seat": 1,
                "tile": "5m",
                "leftTileCount": 60,
                "operation": {
                    "seat": 1,
                    "operationList": [
                        {"type": 7, "combination": []},
                        {"type": 9, "combination": []},
                    ],
                },
            },
        },
    }

    bridge.parse_liqi(message)

    assert bridge.latest_operation_step == 18
    assert bridge.latest_self_operation_list == [
        {"type": 7, "combination": []},
        {"type": 9, "combination": []},
    ]


def test_action_prototype_clears_self_operation_list_after_self_action_without_operation():
    bridge = MajsoulBridge()
    bridge.seat = 0
    bridge.latest_self_operation_list = [{"type": 7, "combination": []}]
    bridge.latest_operation_step = 11

    message = {
        "method": ".lq.ActionPrototype",
        "type": 1,
        "data": {
            "step": 12,
            "name": "ActionDiscardTile",
            "data": {
                "seat": 0,
                "tile": "3m",
                "isLiqi": False,
                "moqie": False,
            },
        },
    }

    bridge.parse_liqi(message)

    assert bridge.latest_self_operation_list == []
    assert bridge.latest_operation_step is None


def test_action_prototype_clears_stale_self_operation_list_after_other_player_action():
    bridge = MajsoulBridge()
    bridge.seat = 0
    bridge.latest_self_operation_list = [{"type": 0, "combination": []}, {"type": 9, "combination": []}]
    bridge.latest_operation_step = 25

    message = {
        "method": ".lq.ActionPrototype",
        "type": 1,
        "data": {
            "step": 26,
            "name": "ActionDealTile",
            "data": {
                "seat": 1,
                "tile": "5m",
                "leftTileCount": 60,
            },
        },
    }

    bridge.parse_liqi(message)

    assert bridge.latest_self_operation_list == []
    assert bridge.latest_operation_step is None
