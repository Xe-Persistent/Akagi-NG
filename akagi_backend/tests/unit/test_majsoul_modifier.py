from unittest.mock import MagicMock, patch

from akagi_ng.bridge.majsoul.liqi import MsgType, from_protobuf, to_protobuf
from akagi_ng.bridge.majsoul.modifier import MajsoulModifier, ModCatalog


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
