import json
from unittest.mock import MagicMock, patch

from akagi_ng.bridge.majsoul.catalog_proto import config_pb2, sheets_pb2
from akagi_ng.bridge.majsoul.liqi import MsgType, from_protobuf, to_protobuf
from akagi_ng.bridge.majsoul.modifier import (
    DEFAULT_CHARACTER_ID,
    MajsoulModifier,
    ModCatalog,
    get_default_mod_settings_dict,
    load_mod_settings_dict,
    value_to_dict,
    value_to_list,
    verify_mod_settings_dict,
)


def make_modifier() -> MajsoulModifier:
    with patch.object(MajsoulModifier, "_save_settings"), patch.object(MajsoulModifier, "_refresh_catalog"):
        modifier = MajsoulModifier()
    modifier.catalog_loaded = True
    modifier.catalog = ModCatalog(
        characters=[200001, 200002],
        skins=[400101, 400201],
        titles=[600001],
        items=[305001],
        views=[307001],
        loading_images=[308001],
        emoji={200001: [1, 2]},
        endings=[900001],
    )
    return modifier


def test_to_protobuf_roundtrip():
    blocks = [
        {"id": 1, "type": "varint", "data": 300},
        {"id": 2, "type": "string", "data": b"hello"},
    ]
    assert from_protobuf(to_protobuf(blocks))[0]["data"] == 300
    assert from_protobuf(to_protobuf(blocks))[1]["data"] == b"hello"


def test_config_descriptor_loader_roundtrip():
    tables = config_pb2.ConfigTables(
        version="1",
        header_hash="hash",
        schemas=[config_pb2.TableSchema(name="item_definition")],
    )

    encoded = tables.SerializeToString()
    decoded = config_pb2.ConfigTables()
    decoded.ParseFromString(encoded)

    assert decoded.version == "1"
    assert decoded.header_hash == "hash"
    assert decoded.schemas[0].name == "item_definition"


def test_sheets_descriptor_loader_roundtrip():
    voice_spot = sheets_pb2.VoiceSpot(
        id=1,
        character=200001,
        type=2,
        path="voice/test.ogg",
    )

    encoded = voice_spot.SerializeToString()
    decoded = sheets_pb2.VoiceSpot()
    decoded.ParseFromString(encoded)

    assert decoded.id == 1
    assert decoded.character == 200001
    assert decoded.type == 2
    assert decoded.path == "voice/test.ogg"


def test_modifier_fakes_change_character_skin_request():
    modifier = make_modifier()
    liqi_proto = MagicMock()
    modifier.safe["room_state"] = {
        "owner_id": 12345,
        "robot_count": 0,
        "persons": [{"account_id": 12345, "avatar_id": 400101, "character": {"charid": 200001, "skin": 400101}}],
        "robots": [],
        "positions": [],
        "seq": 1,
    }
    liqi_proto.build_packet.side_effect = [b"notify", b"roomupdate", b"loginbeat"]

    mutation = modifier.process(
        {
            "id": 7,
            "type": MsgType.Req,
            "method": ".lq.Lobby.changeCharacterSkin",
            "data": {"character_id": 200001, "skin": 400101},
        },
        from_client=True,
        raw_content=b"orig",
        liqi_proto=liqi_proto,
    )

    assert mutation.content == b"loginbeat"
    assert mutation.injected_messages == [b"notify", b"roomupdate"]
    liqi_proto.set_pending_response.assert_called_once_with(7, ".lq.Lobby.loginBeat")
    assert modifier.settings["config"]["characters"]["200001"] == 400101


def test_modifier_fakes_save_common_views_request_and_refreshes_room_state():
    modifier = make_modifier()
    liqi_proto = MagicMock()
    modifier.safe["room_state"] = {
        "owner_id": 12345,
        "robot_count": 0,
        "persons": [{"account_id": 12345, "avatar_id": 400101, "character": {"charid": 200001, "skin": 400101}}],
        "robots": [],
        "positions": [],
        "seq": 4,
    }
    liqi_proto.build_packet.side_effect = [b"roomupdate", b"loginbeat"]

    mutation = modifier.process(
        {
            "id": 8,
            "type": MsgType.Req,
            "method": ".lq.Lobby.saveCommonViews",
            "data": {
                "views": [
                    {"slot": 5, "itemId": 30550014, "type": 0, "itemIdList": []},
                    {"slot": 8, "itemIdList": [30700001, 30700002], "type": 1},
                ],
                "save_index": 2,
                "is_use": 1,
            },
        },
        from_client=True,
        raw_content=b"orig",
        liqi_proto=liqi_proto,
    )

    assert mutation.content == b"loginbeat"
    assert mutation.injected_messages == [b"roomupdate"]
    assert modifier.settings["config"]["views_index"] == 2
    assert modifier.settings["config"]["views"]["2"][0] == {"slot": 5, "itemId": 30550014, "type": 0}
    assert modifier.settings["config"]["views"]["2"][1] == {"slot": 8, "itemIdList": [30700001, 30700002], "type": 1}


def test_modifier_fakes_use_common_view_request_and_refreshes_room_state():
    modifier = make_modifier()
    liqi_proto = MagicMock()
    modifier.safe["room_state"] = {
        "owner_id": 12345,
        "robot_count": 0,
        "persons": [{"account_id": 12345, "avatar_id": 400101, "character": {"charid": 200001, "skin": 400101}}],
        "robots": [],
        "positions": [],
        "seq": 9,
    }
    modifier.settings["config"]["views"]["4"] = [{"slot": 5, "itemId": 30550014, "type": 0, "itemIdList": []}]
    liqi_proto.build_packet.side_effect = [b"roomupdate", b"loginbeat"]

    mutation = modifier.process(
        {
            "id": 9,
            "type": MsgType.Req,
            "method": ".lq.Lobby.useCommonView",
            "data": {"index": 4},
        },
        from_client=True,
        raw_content=b"orig",
        liqi_proto=liqi_proto,
    )

    assert mutation.content == b"loginbeat"
    assert mutation.injected_messages == [b"roomupdate"]
    assert modifier.settings["config"]["views_index"] == 4


def test_modifier_patches_fetch_character_info_response():
    modifier = make_modifier()
    liqi_proto = MagicMock()
    liqi_proto.build_packet.return_value = b"patched"
    modifier.settings["config"]["characters"]["200001"] = 400101
    modifier.settings["config"]["characters"]["200002"] = 400201
    modifier.settings["config"]["character"] = 200002
    modifier.settings["config"]["star_chars"] = [200002]

    mutation = modifier.process(
        {
            "id": 11,
            "type": MsgType.Res,
            "method": ".lq.Lobby.fetchCharacterInfo",
            "data": {
                "main_character_id": 200001,
                "characters": [],
                "skins": [],
                "character_sort": [],
                "hidden_characters": [1],
                "finished_endings": [],
                "rewarded_endings": [],
            },
        },
        from_client=False,
        raw_content=b"orig",
        liqi_proto=liqi_proto,
    )

    assert mutation.content == b"patched"
    patched_data = liqi_proto.build_packet.call_args.args[2]
    assert patched_data["main_character_id"] == 200002
    assert patched_data["skins"] == [400101, 400201]
    assert patched_data["finished_endings"] == [900001]
    assert patched_data["character_sort"] == [200002]
    assert patched_data["characters"][0]["is_upgraded"] is True
    assert patched_data["characters"][0]["rewarded_level"] == [1, 2, 3, 4, 5]


def test_modifier_defaults_enable_full_unlock_behavior():
    modifier = make_modifier()
    liqi_proto = MagicMock()
    liqi_proto.build_packet.return_value = b"patched"

    modifier.settings["config"]["star_chars"] = []

    mutation = modifier.process(
        {
            "id": 12,
            "type": MsgType.Res,
            "method": ".lq.Lobby.fetchCharacterInfo",
            "data": {
                "main_character_id": 200001,
                "characters": [],
                "skins": [],
                "character_sort": [],
                "hidden_characters": [],
                "finished_endings": [],
                "rewarded_endings": [],
            },
        },
        from_client=False,
        raw_content=b"orig",
        liqi_proto=liqi_proto,
    )

    assert mutation.content == b"patched"
    patched_data = liqi_proto.build_packet.call_args.args[2]
    assert patched_data["character_sort"] == [200001, 200002]


def test_modifier_patches_bag_with_items_views_and_loading_images():
    modifier = make_modifier()
    liqi_proto = MagicMock()
    liqi_proto.build_packet.return_value = b"patched"

    mutation = modifier.process(
        {
            "id": 13,
            "type": MsgType.Res,
            "method": ".lq.Lobby.fetchBagInfo",
            "data": {"bag": {"items": [{"item_id": 999999, "stack": 2}]}},
        },
        from_client=False,
        raw_content=b"orig",
        liqi_proto=liqi_proto,
    )

    assert mutation.content == b"patched"
    patched_data = liqi_proto.build_packet.call_args.args[2]
    item_ids = {item["item_id"] for item in patched_data["bag"]["items"]}
    assert 999999 in item_ids
    assert 305001 in item_ids
    assert 307001 in item_ids
    assert 308001 in item_ids


def test_modifier_patches_fetch_account_character_info_response():
    modifier = make_modifier()
    liqi_proto = MagicMock()
    liqi_proto.build_packet.return_value = b"patched"

    mutation = modifier.process(
        {
            "id": 14,
            "type": MsgType.Res,
            "method": ".lq.Lobby.fetchAccountCharacterInfo",
            "data": {"unlock_list": [200001]},
        },
        from_client=False,
        raw_content=b"orig",
        liqi_proto=liqi_proto,
    )

    assert mutation.content == b"patched"
    patched_data = liqi_proto.build_packet.call_args.args[2]
    assert patched_data["unlock_list"] == [200001, 200002]


def test_modifier_rebuilds_account_character_update_notify():
    modifier = make_modifier()
    liqi_proto = MagicMock()
    liqi_proto.build_packet.return_value = b"patched"
    modifier.settings["config"]["character"] = 200002
    modifier.settings["config"]["characters"]["200002"] = 400201

    mutation = modifier.process(
        {
            "id": -1,
            "type": MsgType.Notify,
            "method": ".lq.NotifyAccountUpdate",
            "data": {
                "update": {
                    "character": {
                        "characters": [],
                        "skins": [],
                        "finished_endings": [],
                        "rewarded_endings": [],
                    },
                    "main_character": {"character_id": 200001, "skin_id": 400101},
                }
            },
        },
        from_client=False,
        raw_content=b"orig",
        liqi_proto=liqi_proto,
    )

    assert mutation.content == b"patched"
    patched_data = liqi_proto.build_packet.call_args.args[2]
    assert patched_data["update"]["character"]["skins"] == [400101, 400201]
    assert patched_data["update"]["main_character"]["character_id"] == 200002
    assert patched_data["update"]["main_character"]["skin_id"] == 400201


def test_modifier_patches_room_player_update_notify_with_safe_mode():
    modifier = make_modifier()
    liqi_proto = MagicMock()
    liqi_proto.build_packet.return_value = b"patched"
    modifier.safe["account_id"] = 12345
    modifier.settings["config"]["character"] = 200002
    modifier.settings["config"]["characters"]["200002"] = 400201
    modifier.settings["config"]["safe_mode"] = True

    mutation = modifier.process(
        {
            "id": -1,
            "type": MsgType.Notify,
            "method": ".lq.NotifyRoomPlayerUpdate",
            "data": {
                "owner_id": 12345,
                "robot_count": 1,
                "player_list": [
                    {
                        "account_id": 12345,
                        "avatar_id": 400101,
                        "character": {"charid": 200001, "skin": 400101},
                    }
                ],
                "robots": [{"account_id": 999001, "character": {"charid": 200002, "skin": 400201}}],
                "positions": [],
                "seq": 5,
            },
        },
        from_client=False,
        raw_content=b"orig",
        liqi_proto=liqi_proto,
    )

    assert mutation.content == b"patched"
    patched_data = liqi_proto.build_packet.call_args.args[2]
    assert patched_data["player_list"][0]["character"]["charid"] == 200002
    assert patched_data["robots"][0]["character"]["charid"] == 200001
    assert modifier.safe["room_state"]["seq"] == 5


def test_modifier_patches_game_finish_reward_notify():
    modifier = make_modifier()
    liqi_proto = MagicMock()
    liqi_proto.build_packet.return_value = b"patched"

    mutation = modifier.process(
        {
            "id": -1,
            "type": MsgType.Notify,
            "method": ".lq.NotifyGameFinishRewardV2",
            "data": {"main_character": {"add": 5, "exp": 100, "level": 2}},
        },
        from_client=False,
        raw_content=b"orig",
        liqi_proto=liqi_proto,
    )

    assert mutation.content == b"patched"
    patched_data = liqi_proto.build_packet.call_args.args[2]
    assert patched_data["main_character"]["add"] == 0
    assert patched_data["main_character"]["exp"] == 0
    assert patched_data["main_character"]["level"] == 5


def test_modifier_patches_custom_contest_notify_with_server_prefix():
    modifier = make_modifier()
    liqi_proto = MagicMock()
    liqi_proto.build_packet.return_value = b"patched"
    modifier.settings["config"]["show_server"] = True

    mutation = modifier.process(
        {
            "id": -1,
            "type": MsgType.Notify,
            "method": ".lq.NotifyCustomContestSystemMsg",
            "data": {"game_start": {"players": [{"account_id": 1, "nickname": "Tester"}]}},
        },
        from_client=False,
        raw_content=b"orig",
        liqi_proto=liqi_proto,
    )

    assert mutation.content == b"patched"
    patched_data = liqi_proto.build_packet.call_args.args[2]
    assert patched_data["game_start"]["players"][0]["nickname"].startswith("[CN]")


def test_modifier_patches_fetch_account_info_extra_response():
    modifier = make_modifier()
    liqi_proto = MagicMock()
    liqi_proto.build_packet.return_value = b"patched"
    modifier.settings["config"]["character"] = 200002
    modifier.settings["config"]["characters"]["200001"] = 400101
    modifier.settings["config"]["characters"]["200002"] = 400201

    mutation = modifier.process(
        {
            "id": 15,
            "type": MsgType.Res,
            "method": ".lq.Lobby.fetchAccountInfoExtra",
            "data": {
                "account": {"avatar_id": 400101, "title": 0},
                "character_info": {
                    "main_character_id": 200001,
                    "characters": [],
                    "skins": [],
                    "character_sort": [],
                    "hidden_characters": [],
                    "finished_endings": [],
                    "rewarded_endings": [],
                },
                "bag_info": {"bag": {"items": []}},
                "title_list": {"title_list": []},
                "random_character": {"enabled": False, "pool": []},
            },
        },
        from_client=False,
        raw_content=b"orig",
        liqi_proto=liqi_proto,
    )

    assert mutation.content == b"patched"
    patched_data = liqi_proto.build_packet.call_args.args[2]
    assert patched_data["account"]["avatar_id"] == 400201
    assert patched_data["character_info"]["main_character_id"] == 200002
    assert patched_data["character_info"]["skins"] == [400101, 400201]
    assert patched_data["title_list"] == {"title_list": [600001]}
    item_ids = {item["item_id"] for item in patched_data["bag_info"]["bag"]["items"]}
    assert 305001 in item_ids
    assert 307001 in item_ids
    assert 308001 in item_ids


def test_modifier_patches_fetch_account_info_extra_response_with_camel_case_keys():
    modifier = make_modifier()
    liqi_proto = MagicMock()
    liqi_proto.build_packet.return_value = b"patched"
    modifier.settings["config"]["character"] = 200002
    modifier.settings["config"]["characters"]["200001"] = 400101
    modifier.settings["config"]["characters"]["200002"] = 400201

    mutation = modifier.process(
        {
            "id": 16,
            "type": MsgType.Res,
            "method": ".lq.Lobby.fetchAccountInfoExtra",
            "data": {
                "account": {"avatar_id": 400101, "title": 0, "loadingImage": []},
                "characterInfo": {
                    "mainCharacterId": 200001,
                    "characters": [],
                    "skins": [],
                    "characterSort": [],
                    "hiddenCharacters": [],
                    "finishedEndings": [],
                    "rewardedEndings": [],
                },
                "bagInfo": {"bag": {"items": []}},
                "titleList": {"titleList": []},
                "randomCharacter": {"enabled": False, "pool": []},
            },
        },
        from_client=False,
        raw_content=b"orig",
        liqi_proto=liqi_proto,
    )

    assert mutation.content == b"patched"
    patched_data = liqi_proto.build_packet.call_args.args[2]
    assert patched_data["account"]["avatar_id"] == 400201
    assert patched_data["characterInfo"]["mainCharacterId"] == 200002
    assert patched_data["characterInfo"]["skins"] == [400101, 400201]
    assert patched_data["titleList"] == {"title_list": [600001]}


def test_modifier_patches_auth_game_player_with_camel_case_account_id():
    modifier = make_modifier()
    liqi_proto = MagicMock()
    liqi_proto.build_packet.return_value = b"patched"
    modifier.safe["account_id"] = 12345
    modifier.settings["config"]["character"] = 200002
    modifier.settings["config"]["characters"]["200002"] = 400201

    mutation = modifier.process(
        {
            "id": 17,
            "type": MsgType.Res,
            "method": ".lq.FastTest.authGame",
            "data": {
                "players": [
                    {
                        "accountId": 12345,
                        "avatarId": 400101,
                        "character": {"charId": 200001, "skin": 400101},
                    }
                ],
                "robots": [],
                "game_config": {"mode": {"detail_rule": {}}, "meta": {"mode_id": 1}},
            },
        },
        from_client=False,
        raw_content=b"orig",
        liqi_proto=liqi_proto,
    )

    assert mutation.content == b"patched"
    patched_data = liqi_proto.build_packet.call_args.args[2]
    player = patched_data["players"][0]
    assert player["avatarId"] == 400201
    assert player["character"]["charId"] == 200002
    assert player["character"]["skin"] == 400201


def test_modifier_patches_auth_game_player_views_from_camel_case_settings():
    modifier = make_modifier()
    liqi_proto = MagicMock()
    liqi_proto.build_packet.return_value = b"patched"
    modifier.safe["account_id"] = 12345
    modifier.settings["config"]["views_index"] = 0
    modifier.settings["config"]["views"]["0"] = [
        {"slot": 5, "itemId": 30550014, "type": 0, "itemIdList": []},
        {"slot": 8, "itemId": 30700002, "type": 0, "itemIdList": []},
    ]

    mutation = modifier.process(
        {
            "id": 18,
            "type": MsgType.Res,
            "method": ".lq.FastTest.authGame",
            "data": {
                "players": [
                    {
                        "accountId": 12345,
                        "avatarId": 400101,
                        "character": {"charId": 200001, "skin": 400101},
                    }
                ],
                "robots": [],
                "game_config": {"mode": {"detail_rule": {}}, "meta": {"mode_id": 1}},
            },
        },
        from_client=False,
        raw_content=b"orig",
        liqi_proto=liqi_proto,
    )

    assert mutation.content == b"patched"
    patched_data = liqi_proto.build_packet.call_args.args[2]
    player = patched_data["players"][0]
    assert player["avatarFrame"] == 30550014
    assert player["views"] == [
        {"slot": 5, "item_id": 30550014},
        {"slot": 8, "item_id": 30700002},
    ]
    assert player["character"]["views"] == [
        {"slot": 5, "item_id": 30550014},
        {"slot": 8, "item_id": 30700002},
    ]


def test_modifier_patches_join_room_player():
    modifier = make_modifier()
    liqi_proto = MagicMock()
    liqi_proto.build_packet.return_value = b"patched"
    modifier.safe["account_id"] = 12345
    modifier.settings["config"]["character"] = 200002
    modifier.settings["config"]["characters"]["200002"] = 400201

    mutation = modifier.process(
        {
            "id": 19,
            "type": MsgType.Res,
            "method": ".lq.Lobby.joinRoom",
            "data": {
                "room": {
                    "persons": [
                        {
                            "account_id": 12345,
                            "avatar_id": 400101,
                            "character": {"charid": 200001, "skin": 400101},
                        }
                    ],
                    "robots": [],
                }
            },
        },
        from_client=False,
        raw_content=b"orig",
        liqi_proto=liqi_proto,
    )

    assert mutation.content == b"patched"
    patched_data = liqi_proto.build_packet.call_args.args[2]
    player = patched_data["room"]["persons"][0]
    assert player["avatar_id"] == 400201
    assert player["character"]["charid"] == 200002
    assert player["character"]["skin"] == 400201


def test_modifier_patches_fetch_room_and_caches_room_state():
    modifier = make_modifier()
    liqi_proto = MagicMock()
    liqi_proto.build_packet.return_value = b"patched"
    modifier.safe["account_id"] = 12345
    modifier.settings["config"]["character"] = 200002
    modifier.settings["config"]["characters"]["200002"] = 400201
    modifier.settings["config"]["show_server"] = True
    modifier.settings["config"]["safe_mode"] = True

    mutation = modifier.process(
        {
            "id": 20,
            "type": MsgType.Res,
            "method": ".lq.Lobby.fetchRoom",
            "data": {
                "room": {
                    "owner_id": 12345,
                    "robot_count": 1,
                    "persons": [
                        {
                            "account_id": 12345,
                            "avatar_id": 400101,
                            "nickname": "Tester",
                            "character": {"charid": 200001, "skin": 400101},
                        }
                    ],
                    "robots": [{"account_id": 999001, "character": {"charid": 200002, "skin": 400201}}],
                    "positions": [0, 1, 2, 3],
                    "seq": 33,
                }
            },
        },
        from_client=False,
        raw_content=b"orig",
        liqi_proto=liqi_proto,
    )

    assert mutation.content == b"patched"
    patched_data = liqi_proto.build_packet.call_args.args[2]
    player = patched_data["room"]["persons"][0]
    robot = patched_data["room"]["robots"][0]
    assert player["avatar_id"] == 400201
    assert player["character"]["charid"] == 200002
    assert player["nickname"].startswith("[CN]")
    assert robot["character"]["charid"] == 200001
    assert robot["character"]["skin"] == 400101
    assert modifier.safe["room_state"]["seq"] == 33
    assert modifier.safe["room_state"]["persons"][0]["account_id"] == 12345


def test_modifier_patches_enter_game_snapshot_account_views():
    modifier = make_modifier()
    liqi_proto = MagicMock()
    liqi_proto.build_packet.return_value = b"patched"
    modifier.safe["account_id"] = 12345
    modifier.settings["config"]["character"] = 200002
    modifier.settings["config"]["characters"]["200002"] = 400201
    modifier.settings["config"]["views"]["0"] = [
        {"slot": 5, "itemId": 30550014, "type": 0, "itemIdList": []},
    ]

    mutation = modifier.process(
        {
            "id": 20,
            "type": MsgType.Res,
            "method": ".lq.FastTest.enterGame",
            "data": {
                "game_restore": {
                    "snapshot": {
                        "account_views": [
                            {
                                "account_id": 12345,
                                "avatar_id": 400101,
                                "character": {"charid": 200001, "skin": 400101},
                            }
                        ],
                        "robot_views": [],
                    }
                }
            },
        },
        from_client=False,
        raw_content=b"orig",
        liqi_proto=liqi_proto,
    )

    assert mutation.content == b"patched"
    patched_data = liqi_proto.build_packet.call_args.args[2]
    player = patched_data["game_restore"]["snapshot"]["account_views"][0]
    assert player["avatar_id"] == 400201
    assert player["avatar_frame"] == 30550014
    assert player["character"]["charid"] == 200002
    assert player["character"]["skin"] == 400201
    assert player["views"] == [{"slot": 5, "item_id": 30550014}]
    assert player["character"]["views"] == [{"slot": 5, "item_id": 30550014}]


def test_modifier_patches_sync_game_snapshot_account_views():
    modifier = make_modifier()
    liqi_proto = MagicMock()
    liqi_proto.build_packet.return_value = b"patched"
    modifier.safe["account_id"] = 12345
    modifier.settings["config"]["character"] = 200002
    modifier.settings["config"]["characters"]["200002"] = 400201
    modifier.settings["config"]["views"]["0"] = [
        {"slot": 5, "itemId": 30550014, "type": 0, "itemIdList": []},
    ]

    mutation = modifier.process(
        {
            "id": 21,
            "type": MsgType.Res,
            "method": ".lq.FastTest.syncGame",
            "data": {
                "game_restore": {
                    "snapshot": {
                        "account_views": [
                            {
                                "account_id": 12345,
                                "avatar_id": 400101,
                                "character": {"charid": 200001, "skin": 400101},
                            }
                        ],
                        "robot_views": [],
                    }
                }
            },
        },
        from_client=False,
        raw_content=b"orig",
        liqi_proto=liqi_proto,
    )

    assert mutation.content == b"patched"
    patched_data = liqi_proto.build_packet.call_args.args[2]
    player = patched_data["game_restore"]["snapshot"]["account_views"][0]
    assert player["avatar_id"] == 400201
    assert player["avatar_frame"] == 30550014
    assert player["character"]["charid"] == 200002
    assert player["views"] == [{"slot": 5, "item_id": 30550014}]


def test_modifier_patches_fetch_title_list_response():
    modifier = make_modifier()
    liqi_proto = MagicMock()
    liqi_proto.build_packet.return_value = b"patched"

    mutation = modifier.process(
        {
            "id": 22,
            "type": MsgType.Res,
            "method": ".lq.Lobby.fetchTitleList",
            "data": {"title_list": [1, 2, 3]},
        },
        from_client=False,
        raw_content=b"orig",
        liqi_proto=liqi_proto,
    )

    assert mutation.content == b"patched"
    patched_data = liqi_proto.build_packet.call_args.args[2]
    assert patched_data["title_list"] == [600001]


def test_modifier_injects_fetch_announcement_once():
    modifier = make_modifier()
    liqi_proto = MagicMock()
    liqi_proto.build_packet.return_value = b"patched"

    mutation = modifier.process(
        {
            "id": 23,
            "type": MsgType.Res,
            "method": ".lq.Lobby.fetchAnnouncement",
            "data": {"announcements": [{"id": 1, "title": "hello"}]},
        },
        from_client=False,
        raw_content=b"orig",
        liqi_proto=liqi_proto,
    )

    assert mutation.content == b"patched"
    patched_data = liqi_proto.build_packet.call_args.args[2]
    announcements = patched_data["announcements"]
    assert announcements[0]["id"] == 666666
    assert announcements[0]["title"] == "Majsoul Mod Loaded"

    mutation = modifier.process(
        {
            "id": 24,
            "type": MsgType.Res,
            "method": ".lq.Lobby.fetchAnnouncement",
            "data": {"announcements": announcements},
        },
        from_client=False,
        raw_content=b"orig",
        liqi_proto=liqi_proto,
    )

    assert mutation.content == b"patched"
    patched_data = liqi_proto.build_packet.call_args.args[2]
    ids = [item["id"] for item in patched_data["announcements"]]
    assert ids.count(666666) == 1


def test_modifier_patches_fetch_random_character_response():
    modifier = make_modifier()
    liqi_proto = MagicMock()
    liqi_proto.build_packet.return_value = b"patched"
    modifier.settings["config"]["random_character"] = {
        "enabled": True,
        "pool": [{"character_id": 200002, "skin_id": 400201}],
    }

    mutation = modifier.process(
        {
            "id": 25,
            "type": MsgType.Res,
            "method": ".lq.Lobby.fetchRandomCharacter",
            "data": {"enabled": False, "pool": []},
        },
        from_client=False,
        raw_content=b"orig",
        liqi_proto=liqi_proto,
    )

    assert mutation.content == b"patched"
    patched_data = liqi_proto.build_packet.call_args.args[2]
    assert patched_data == {
        "enabled": True,
        "pool": [{"character_id": 200002, "skin_id": 400201}],
    }


def test_modifier_fakes_misc_requests_and_updates_config():
    modifier = make_modifier()
    liqi_proto = MagicMock()
    liqi_proto.build_packet.return_value = b"loginbeat"

    mutation = modifier.process(
        {
            "id": 26,
            "type": MsgType.Req,
            "method": ".lq.Lobby.updateCharacterSort",
            "data": {"sort": [200002, 200001]},
        },
        from_client=True,
        raw_content=b"orig",
        liqi_proto=liqi_proto,
    )
    assert mutation.content == b"loginbeat"
    assert modifier.settings["config"]["star_chars"] == [200002, 200001]

    mutation = modifier.process(
        {
            "id": 27,
            "type": MsgType.Req,
            "method": ".lq.Lobby.useTitle",
            "data": {"title": 600001},
        },
        from_client=True,
        raw_content=b"orig",
        liqi_proto=liqi_proto,
    )
    assert mutation.content == b"loginbeat"
    assert modifier.settings["config"]["title"] == 600001

    mutation = modifier.process(
        {
            "id": 28,
            "type": MsgType.Req,
            "method": ".lq.Lobby.setLoadingImage",
            "data": {"images": [308001]},
        },
        from_client=True,
        raw_content=b"orig",
        liqi_proto=liqi_proto,
    )
    assert mutation.content == b"loginbeat"
    assert modifier.settings["config"]["loading_image"] == [308001]

    mutation = modifier.process(
        {
            "id": 29,
            "type": MsgType.Req,
            "method": ".lq.Lobby.setRandomCharacter",
            "data": {"enabled": True, "pool": [{"character_id": 200002, "skin_id": 400201}]},
        },
        from_client=True,
        raw_content=b"orig",
        liqi_proto=liqi_proto,
    )
    assert mutation.content == b"loginbeat"
    assert modifier.settings["config"]["random_character"]["enabled"] is True


def test_modifier_handles_drop_and_contract_related_requests():
    modifier = make_modifier()
    liqi_proto = MagicMock()
    liqi_proto.build_packet.return_value = b"loginbeat"

    mutation = modifier.process(
        {
            "id": 30,
            "type": MsgType.Req,
            "method": ".lq.Lobby.addFinishedEnding",
            "data": {},
        },
        from_client=True,
        raw_content=b"orig",
        liqi_proto=liqi_proto,
    )
    assert mutation.drop is True
    liqi_proto.drop_pending_response.assert_called_once_with(30)

    mutation = modifier.process(
        {
            "id": 31,
            "type": MsgType.Req,
            "method": ".lq.Lobby.readAnnouncement",
            "data": {"announcement_id": 666666},
        },
        from_client=True,
        raw_content=b"orig",
        liqi_proto=liqi_proto,
    )
    assert mutation.content == b"loginbeat"

    mutation = modifier.process(
        {
            "id": 32,
            "type": MsgType.Req,
            "method": ".lq.Lobby.receiveCharacterRewards",
            "data": {},
        },
        from_client=True,
        raw_content=b"orig",
        liqi_proto=liqi_proto,
    )
    assert mutation.content == b"loginbeat"

    mutation = modifier.process(
        {
            "id": 33,
            "type": MsgType.Req,
            "method": ".lq.Lobby.loginBeat",
            "data": {"contract": "abc123"},
        },
        from_client=True,
        raw_content=b"orig",
        liqi_proto=liqi_proto,
    )
    assert mutation.content is None
    assert modifier.safe["contract"] == "abc123"


def test_modifier_patches_misc_response_branches():
    modifier = make_modifier()
    liqi_proto = MagicMock()
    liqi_proto.build_packet.return_value = b"patched"
    modifier.safe["account_id"] = 12345
    modifier.settings["config"]["anti_replace_nickname"] = True
    modifier.settings["config"]["views"]["0"] = [{"slot": 5, "itemId": 30550014, "type": 0, "itemIdList": []}]
    modifier.settings["config"]["random_character"] = {
        "enabled": True,
        "pool": [{"character_id": 200002, "skin_id": 400201}],
    }

    mutation = modifier.process(
        {
            "id": 34,
            "type": MsgType.Res,
            "method": ".lq.Lobby.fetchAllCommonViews",
            "data": {"use": 0, "views": []},
        },
        from_client=False,
        raw_content=b"orig",
        liqi_proto=liqi_proto,
    )
    assert mutation.content == b"patched"
    assert liqi_proto.build_packet.call_args.args[2]["views"][0]["index"] == 0

    mutation = modifier.process(
        {
            "id": 35,
            "type": MsgType.Res,
            "method": ".lq.Lobby.fetchServerSettings",
            "data": {"settings": {"nickname_setting": {"enable": 1, "nicknames": ["x"]}}},
        },
        from_client=False,
        raw_content=b"orig",
        liqi_proto=liqi_proto,
    )
    assert mutation.content == b"patched"
    patched_data = liqi_proto.build_packet.call_args.args[2]
    assert patched_data["settings"]["nickname_setting"]["enable"] == 0
    assert patched_data["settings"]["nickname_setting"]["nicknames"] == []

    mutation = modifier.process(
        {
            "id": 36,
            "type": MsgType.Res,
            "method": ".lq.Lobby.fetchGameRecord",
            "data": {
                "head": {
                    "accounts": [
                        {
                            "account_id": 12345,
                            "avatar_id": 400101,
                            "character": {"charid": 200001, "skin": 400101},
                        }
                    ]
                }
            },
        },
        from_client=False,
        raw_content=b"orig",
        liqi_proto=liqi_proto,
    )
    assert mutation.content == b"patched"
    account = liqi_proto.build_packet.call_args.args[2]["head"]["accounts"][0]
    assert account["avatar_id"] == 400201
    assert account["character"]["views"] == [{"slot": 5, "item_id": 30550014}]

    mutation = modifier.process(
        {
            "id": 37,
            "type": MsgType.Res,
            "method": ".lq.Lobby.fetchAccountInfo",
            "data": {"account": {"account_id": 12345, "avatar_id": 400101, "title": 0}},
        },
        from_client=False,
        raw_content=b"orig",
        liqi_proto=liqi_proto,
    )
    assert mutation.content == b"patched"
    assert liqi_proto.build_packet.call_args.args[2]["account"]["title"] == modifier.settings["config"]["title"]

    mutation = modifier.process(
        {
            "id": 38,
            "type": MsgType.Res,
            "method": ".lq.Lobby.login",
            "data": {"account_id": 12345, "account": {"nickname": "Tester", "title": 0, "avatar_id": 400101}},
        },
        from_client=False,
        raw_content=b"orig",
        liqi_proto=liqi_proto,
    )
    assert mutation.content == b"patched"
    assert modifier.safe["account_id"] == 12345


def test_modifier_helper_functions_and_validation():
    defaults = get_default_mod_settings_dict()
    assert defaults["config"]["character"] == DEFAULT_CHARACTER_ID
    assert value_to_dict({"a": 1}) == {"a": 1}
    assert value_to_dict([]) is None
    assert value_to_list([1, 2]) == [1, 2]
    assert value_to_list({}) is None
    assert verify_mod_settings_dict({"enabled": True, "config": {}, "resource": {}}) is True
    assert verify_mod_settings_dict({"enabled": "yes"}) is False
    assert verify_mod_settings_dict({"config": []}) is False
    assert verify_mod_settings_dict({"resource": []}) is False


def test_load_mod_settings_dict_migrates_legacy_settings_file():
    legacy_path = MagicMock()
    legacy_path.exists.return_value = True
    legacy_path.name = "settings.json"
    legacy_path.read_text.return_value = json.dumps({"enabled": False, "config": {"nickname": "Legacy"}})

    new_path = MagicMock()
    new_path.exists.return_value = False

    with (
        patch("akagi_ng.bridge.majsoul.modifier.LEGACY_MOD_SETTINGS_PATH", legacy_path),
        patch("akagi_ng.bridge.majsoul.modifier.MOD_SETTINGS_PATH", new_path),
        patch("akagi_ng.bridge.majsoul.modifier.save_mod_settings_dict") as mock_save,
    ):
        settings = load_mod_settings_dict()

    assert settings["enabled"] is False
    assert settings["config"]["nickname"] == "Legacy"
    mock_save.assert_called_once_with(settings)


def test_load_mod_settings_dict_prefers_new_settings_file():
    legacy_path = MagicMock()
    legacy_path.exists.return_value = True
    legacy_path.name = "settings.json"
    legacy_path.read_text.return_value = json.dumps({"enabled": False, "config": {"nickname": "Legacy"}})

    new_path = MagicMock()
    new_path.exists.return_value = True
    new_path.name = "settings.mod.json"
    new_path.read_text.return_value = json.dumps({"enabled": True, "config": {"nickname": "Current"}})

    with (
        patch("akagi_ng.bridge.majsoul.modifier.LEGACY_MOD_SETTINGS_PATH", legacy_path),
        patch("akagi_ng.bridge.majsoul.modifier.MOD_SETTINGS_PATH", new_path),
        patch("akagi_ng.bridge.majsoul.modifier.save_mod_settings_dict") as mock_save,
    ):
        settings = load_mod_settings_dict()

    assert settings["enabled"] is True
    assert settings["config"]["nickname"] == "Current"
    mock_save.assert_not_called()


def test_modifier_process_guard_paths():
    modifier = make_modifier()
    liqi_proto = MagicMock()

    modifier.settings["enabled"] = False
    assert modifier.process({}, from_client=True, raw_content=b"x", liqi_proto=liqi_proto).content is None

    modifier.settings["enabled"] = True
    assert modifier.process({}, from_client=True, raw_content=b"x", liqi_proto=liqi_proto).content is None
    invalid = modifier.process(
        {"type": MsgType.Req, "method": 1, "data": {}},
        from_client=True,
        raw_content=b"x",
        liqi_proto=liqi_proto,
    )
    assert invalid.content is None


def test_modifier_refresh_catalog_local_download_and_failure():
    modifier = make_modifier()
    modifier.catalog_loaded = False
    fake_path = MagicMock()

    with (
        patch("akagi_ng.bridge.majsoul.modifier.RESOURCE_PATH", fake_path),
        patch.object(modifier, "_load_catalog", return_value=ModCatalog(characters=[200001])),
        patch.object(modifier, "_save_settings"),
    ):
        fake_path.exists.return_value = True
        fake_path.read_bytes.return_value = b"abc"
        modifier._refresh_catalog()
        assert modifier.catalog.characters == [200001]

    with (
        patch("akagi_ng.bridge.majsoul.modifier.RESOURCE_PATH", fake_path),
        patch.object(modifier, "_update_resource"),
        patch("akagi_ng.bridge.majsoul.modifier.RESOURCE_PATH.read_bytes", return_value=b"abc"),
        patch.object(modifier, "_load_catalog", return_value=ModCatalog(characters=[200002])),
        patch.object(modifier, "_save_settings"),
    ):
        fake_path.exists.side_effect = [False, True]
        modifier._refresh_catalog()
        assert modifier.catalog.characters == [200002]

    with (
        patch("akagi_ng.bridge.majsoul.modifier.RESOURCE_PATH", fake_path),
        patch.object(modifier, "_save_settings"),
    ):
        fake_path.exists.side_effect = RuntimeError("boom")
        modifier._refresh_catalog()


def test_modifier_load_catalog_extracts_supported_entries():
    modifier = make_modifier()

    character_sheet = config_pb2.SheetData(table="item_definition", sheet="character")
    character_sheet.data.append(sheets_pb2.ItemDefinitionCharacter(id=200001).SerializeToString())
    skin_sheet = config_pb2.SheetData(table="item_definition", sheet="skin")
    skin_sheet.data.append(sheets_pb2.ItemDefinitionSkin(id=400101).SerializeToString())
    title_sheet = config_pb2.SheetData(table="item_definition", sheet="title")
    title_sheet.data.append(sheets_pb2.ItemDefinitionTitle(id=600001).SerializeToString())
    item_sheet = config_pb2.SheetData(table="item_definition", sheet="item")
    item_sheet.data.append(sheets_pb2.ItemDefinitionItem(id=305001, category=5).SerializeToString())
    item_sheet.data.append(sheets_pb2.ItemDefinitionItem(id=308001, category=8).SerializeToString())
    view_sheet = config_pb2.SheetData(table="item_definition", sheet="view")
    view_sheet.data.append(sheets_pb2.ItemDefinitionView(id=307001).SerializeToString())
    loading_sheet = config_pb2.SheetData(table="item_definition", sheet="loading_image")
    loading_sheet.data.append(sheets_pb2.ItemDefinitionLoadingImage(id=308002).SerializeToString())
    emoji_sheet = config_pb2.SheetData(table="character", sheet="emoji")
    emoji_sheet.data.append(sheets_pb2.CharacterEmoji(charid=200001, sub_id=9).SerializeToString())
    reward_sheet = config_pb2.SheetData(table="spot", sheet="rewards")
    reward_sheet.data.append(sheets_pb2.SpotRewards(id=900001).SerializeToString())

    tables = config_pb2.ConfigTables()
    tables.datas.extend(
        [
            character_sheet,
            skin_sheet,
            title_sheet,
            item_sheet,
            view_sheet,
            loading_sheet,
            emoji_sheet,
            reward_sheet,
        ]
    )

    catalog = modifier._load_catalog(tables.SerializeToString())
    assert catalog.characters == [200001]
    assert catalog.skins == [400101]
    assert catalog.titles == [600001]
    assert 305001 in catalog.items
    assert 307001 in catalog.views
    assert 308001 in catalog.loading_images
    assert 308002 in catalog.loading_images
    assert catalog.emoji[200001] == [9]
    assert catalog.endings == [900001]


def test_modifier_build_room_player_update_notify_none_and_safe_mode_robot():
    modifier = make_modifier()
    liqi_proto = MagicMock()

    assert modifier._build_room_player_update_notify(liqi_proto) is None

    modifier.safe["account_id"] = 12345
    modifier.settings["config"]["safe_mode"] = True
    modifier.safe["room_state"] = {
        "owner_id": 12345,
        "robot_count": 1,
        "persons": [{"account_id": 12345, "avatar_id": 400101, "character": {"charid": 200001, "skin": 400101}}],
        "robots": [{"account_id": 999001, "character": {"charid": 200002, "skin": 400201}}],
        "positions": [],
        "seq": 3,
    }
    liqi_proto.build_packet.return_value = b"room"

    payload = modifier._build_room_player_update_notify(liqi_proto)
    assert payload == b"room"
    built_data = liqi_proto.build_packet.call_args.args[2]
    assert built_data["seq"] == 4
    assert built_data["robots"][0]["character"]["charid"] == DEFAULT_CHARACTER_ID


def test_modifier_payload_and_view_helpers():
    modifier = make_modifier()
    modifier.settings["config"]["characters"] = {}
    modifier._ensure_character_skin_mapping([200003])
    assert modifier.settings["config"]["characters"]["200003"] == modifier._default_skin_id(200003)

    assert modifier._current_avatar_frame([{"slot": 1, "item_id": 1}]) is None
    modifier.settings["config"]["views"]["0"] = [
        {"slot": 5, "itemId": 30550014, "type": 0},
        {"slot": 8, "itemIdList": [30700001, 30700002], "type": 1},
    ]
    with patch("random.choice", return_value=30700002):
        resolved = modifier._resolved_views()
    assert resolved[0] == {"slot": 5, "item_id": 30550014}
    assert resolved[1] == {"slot": 8, "item_id": 30700002, "type": 1}
    assert modifier._current_avatar_frame(resolved) == 30550014

    modifier.settings["config"]["random_character"] = {
        "enabled": True,
        "pool": [{"character_id": 200002, "skin_id": 400201}],
    }
    with patch("random.choice", return_value={"character_id": 200002, "skin_id": 400201}):
        assert modifier._choose_character(allow_random=True) == (200002, 400201)

    character_payload = modifier._to_character_payload(
        {
            "charid": "200001",
            "skin": "400101",
            "exp": 0,
            "level": 5,
            "isUpgraded": True,
            "rewardedLevel": [1, "2"],
            "extraEmoji": [1, "2"],
            "views": [{"slot": 5, "itemId": 30550014, "type": "0"}],
        }
    )
    assert character_payload is not None
    assert character_payload["charid"] == 200001
    assert character_payload["extra_emoji"] == [1, 2]
    assert modifier._to_character_payload({"charid": None, "skin": 1}) is None

    player_payload = modifier._to_player_payload(
        {
            "accountId": "12345",
            "avatarId": "400101",
            "avatarFrame": "30550014",
            "nickname": "Tester",
            "title": "600001",
            "verified": "1",
            "character": {"charid": 200001, "skin": 400101},
            "views": [{"slot": 5, "itemId": 30550014}],
        }
    )
    assert player_payload is not None
    assert player_payload["account_id"] == 12345
    assert player_payload["avatar_frame"] == 30550014
    assert modifier._to_player_payload({"accountId": None}) is None

    assert modifier._extract_resolved_views([{"slot": "5", "itemId": "30550014", "type": "1"}]) == [
        {"slot": 5, "item_id": 30550014, "type": 1}
    ]
    assert modifier._extract_resolved_views([{"slot": None, "itemId": 1}]) == []


def test_modifier_prefix_login_account_and_zone_prefixes():
    modifier = make_modifier()
    modifier.settings["config"]["nickname"] = ""
    modifier.settings["config"]["title"] = 600001
    modifier.settings["config"]["verified"] = 1
    modifier.settings["config"]["loading_image"] = [308001]
    account = {"avatarFrame": 0}
    modifier.settings["config"]["views"]["0"] = [{"slot": 5, "itemId": 30550014, "type": 0}]
    modifier._patch_login_account(account)
    assert account["avatar_id"] == modifier._get_character_skin(modifier.settings["config"]["character"])
    assert account["avatarFrame"] == 30550014
    assert account["loading_image"] == [308001]

    player = {"account_id": 9 << 23, "nickname": "Tester"}
    modifier._prefix_server(player)
    assert player["nickname"].startswith("[JP]")
    assert modifier._get_zone_prefix(14 << 23) == "[EN]"
    assert modifier._get_zone_prefix(20 << 23) == "[??]"
