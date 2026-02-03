"""Unit tests for LiqiProto initialization using real protocol data."""

from akagi_ng.bridge.majsoul.liqi import LiqiProto


def test_liqi_proto_real_initialization():
    """验证 LiqiProto 能够成功加载真实的 liqi.json 并构建描述符"""
    lp = LiqiProto()
    assert lp.msg_id == 1
    assert lp.parsed_msg_count == 0

    # 验证关键消息类能够被正常加载
    types_to_check = [
        "ActionNewRound",
        "ActionDiscardTile",
        "ResCommon",
        "ActionPrototype",
        "Wrapper",
    ]
    for t in types_to_check:
        cls = lp.get_message_class(t)
        assert cls is not None, f"Failed to find message class: {t}"


def test_liqi_proto_init_method():
    """测试 init 方法重置状态"""
    lp = LiqiProto()
    lp.msg_id = 100
    lp.res_type[1] = ("test", None)

    lp.init()
    assert lp.msg_id == 1
    assert len(lp.res_type) == 0
