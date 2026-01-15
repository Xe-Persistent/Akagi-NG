from functools import cmp_to_key

from akagi_ng.bridge.base import BaseBridge
from akagi_ng.bridge.logger import logger
from akagi_ng.bridge.majsoul.liqi import LiqiProto, MsgType, parse_sync_game
from akagi_ng.bridge.tile_mapping import MS_TILE_2_MJAI_TILE, compare_pai
from akagi_ng.core.constants import MahjongConstants
from akagi_ng.core.notification_codes import NotificationCode


class OperationChiPengGang:
    Chi = 0
    Peng = 1
    Gang = 2


class OperationAnGangAddGang:
    AnGang = 3
    AddGang = 2


class MajsoulBridge(BaseBridge):
    def __init__(self):
        super().__init__()
        self.liqi_proto = LiqiProto()
        self._init_state()

    def _init_state(self):
        """初始化/重置所有游戏状态变量"""
        self.accountId = 0
        self.seat = 0
        self.lastDiscard = None
        self.reach = False
        self.accept_reach = None
        self.operation = {}
        self.AllReady = False
        self.temp = {}
        self.doras = []
        self.my_tehais = ["?"] * MahjongConstants.TEHAI_SIZE
        self.my_tsumohai = "?"
        self.syncing = False

        self.mode_id = -1
        self.rank = -1
        self.score = -1

        self.is_3p = False
        self.game_ended = False

    def reset(self):
        self._init_state()

    def parse(self, content: bytes) -> None | list[dict]:
        """解析内容并返回 MJAI 指令。

        Args:
            content (bytes): 待解析的内容。

        Returns:
            None | list[dict]: MJAI 指令。
        """
        liqi_message = self.liqi_proto.parse(content)
        logger.trace(f"{liqi_message}")
        ret = self.parse_liqi(liqi_message)
        if ret:
            logger.trace(f"-> {ret}")
        return ret

    def _parse_sync_game(self, liqi_message: dict) -> list[dict]:
        """处理游戏同步消息"""
        self.syncing = True
        sync_game_msgs = parse_sync_game(liqi_message)
        parsed_list = [{"type": "system_event", "code": NotificationCode.GAME_SYNCING}]
        for msg in sync_game_msgs:
            parsed = self.parse_liqi(msg)
            if parsed:
                parsed_list.extend(parsed)
        self.syncing = False
        return parsed_list if len(parsed_list) >= 1 else []

    def _parse_auth_game_req(self, liqi_message: dict) -> list[dict]:
        """处理游戏认证请求"""
        self.reset()
        self.accountId = liqi_message["data"]["accountId"]
        return []

    def _parse_auth_game_res(self, liqi_message: dict) -> list[dict]:
        """处理游戏认证响应"""
        self.is_3p = len(liqi_message["data"]["seatList"]) == MahjongConstants.SEATS_3P
        try:
            self.mode_id = liqi_message["data"]["gameConfig"]["meta"]["modeId"]
        except Exception:
            self.mode_id = -1

        seat_list = liqi_message["data"]["seatList"]
        self.seat = seat_list.index(self.accountId)
        return [{"type": "start_game", "id": self.seat}]

    def _handle_action_new_round(self, action_data: dict) -> list[dict]:
        """处理ActionNewRound动作"""
        ret = []
        self.AllReady = False

        data = action_data["data"]
        bakaze = ["E", "S", "W", "N"][data["chang"]]
        dora_marker = MS_TILE_2_MJAI_TILE[data["doras"][0]]
        self.doras = [dora_marker]
        honba = data["ben"]
        oya = data["ju"]
        kyoku = oya + 1
        kyotaku = data["liqibang"]
        scores = data["scores"]
        if self.is_3p:
            scores = [*scores, 0]

        tehais = [["?"] * MahjongConstants.TEHAI_SIZE] * MahjongConstants.SEATS_4P
        my_tehais = ["?"] * MahjongConstants.TEHAI_SIZE
        for hai in range(MahjongConstants.TEHAI_SIZE):
            my_tehais[hai] = MS_TILE_2_MJAI_TILE[data["tiles"][hai]]

        if len(data["tiles"]) == MahjongConstants.TEHAI_SIZE:
            tehais[self.seat] = sorted(my_tehais, key=cmp_to_key(compare_pai))
        elif len(data["tiles"]) == MahjongConstants.TSUMO_TEHAI_SIZE:
            self.my_tsumohai = MS_TILE_2_MJAI_TILE[data["tiles"][MahjongConstants.TEHAI_SIZE]]
            all_tehais = [*my_tehais, self.my_tsumohai]
            all_tehais = sorted(all_tehais, key=cmp_to_key(compare_pai))
            tehais[self.seat] = all_tehais[: MahjongConstants.TEHAI_SIZE]
        else:
            logger.error(f"Unexpected tile count in ActionNewRound: {len(data['tiles'])}")
            return []

        # 构造 start_kyoku 事件（两种情况都需要）
        ret.append(
            {
                "type": "start_kyoku",
                "bakaze": bakaze,
                "dora_marker": dora_marker,
                "honba": honba,
                "kyoku": kyoku,
                "kyotaku": kyotaku,
                "oya": oya,
                "scores": scores,
                "tehais": tehais,
                "is_3p": self.is_3p,
            }
        )

        # 如果是 14 张牌，额外添加 tsumo 事件
        if len(data["tiles"]) == MahjongConstants.TSUMO_TEHAI_SIZE:
            ret.append({"type": "tsumo", "actor": self.seat, "pai": all_tehais[MahjongConstants.TEHAI_SIZE]})

        return ret

    def _handle_action_chi_peng_gang(self, action_data: dict) -> list[dict]:
        """处理吃碰杠动作"""
        data = action_data["data"]
        actor = data["seat"]
        target = actor
        consumed = []
        pai = ""

        for idx, seat in enumerate(data["froms"]):
            if seat != actor:
                target = seat
                pai = MS_TILE_2_MJAI_TILE[data["tiles"][idx]]
            else:
                consumed.append(MS_TILE_2_MJAI_TILE[data["tiles"][idx]])

        assert target != actor
        assert len(consumed) != 0
        assert pai != ""

        match data["type"]:
            case OperationChiPengGang.Chi:
                assert len(consumed) == MahjongConstants.CHI_CONSUMED
                return [{"type": "chi", "actor": actor, "target": target, "pai": pai, "consumed": consumed}]
            case OperationChiPengGang.Peng:
                assert len(consumed) == MahjongConstants.PON_CONSUMED
                return [{"type": "pon", "actor": actor, "target": target, "pai": pai, "consumed": consumed}]
            case OperationChiPengGang.Gang:
                assert len(consumed) == MahjongConstants.DAIMINKAN_CONSUMED
                return [{"type": "daiminkan", "actor": actor, "target": target, "pai": pai, "consumed": consumed}]
            case _:
                logger.error(f"Unknown ActionChiPengGang type: {data['type']}")
                return []

    def _handle_action_an_gang_add_gang(self, action_data: dict) -> list[dict]:
        """处理暗杠/加杠动作"""
        data = action_data["data"]
        actor = data["seat"]

        match data["type"]:
            case OperationAnGangAddGang.AnGang:
                pai = MS_TILE_2_MJAI_TILE[data["tiles"]]
                consumed = [pai.replace("r", "")] * MahjongConstants.ANKAN_TILES
                if pai[0] == "5" and pai[1] != "z":
                    consumed[0] += "r"
                return [{"type": "ankan", "actor": actor, "consumed": consumed}]
            case OperationAnGangAddGang.AddGang:
                pai = MS_TILE_2_MJAI_TILE[data["tiles"]]
                consumed = [pai.replace("r", "")] * MahjongConstants.KAKAN_CONSUMED
                if pai[0] == "5" and not pai.endswith("r"):
                    consumed[0] = consumed[0] + "r"
                return [{"type": "kakan", "actor": actor, "pai": pai, "consumed": consumed}]
        return []

    def _handle_dora_update(self, action_data: dict) -> list[dict]:
        """处理宝牌更新"""
        if (
            "data" in action_data
            and "doras" in action_data["data"]
            and len(action_data["data"]["doras"]) > len(self.doras)
        ):
            self.doras = action_data["data"]["doras"]
            return [{"type": "dora", "dora_marker": MS_TILE_2_MJAI_TILE[action_data["data"]["doras"][-1]]}]
        return []

    def _handle_action_deal_tile(self, action_data: dict) -> list[dict]:
        """处理 ActionDealTile（摸牌）动作"""
        actor = action_data["data"]["seat"]
        if action_data["data"]["tile"] == "":
            pai = "?"
        else:
            pai = MS_TILE_2_MJAI_TILE[action_data["data"]["tile"]]
            self.my_tsumohai = pai
        return [{"type": "tsumo", "actor": actor, "pai": pai}]

    def _handle_action_discard_tile(self, action_data: dict) -> list[dict]:
        """处理 ActionDiscardTile（打牌）动作"""
        ret = []
        actor = action_data["data"]["seat"]
        self.lastDiscard = actor
        pai = MS_TILE_2_MJAI_TILE[action_data["data"]["tile"]]
        tsumogiri = action_data["data"]["moqie"]
        if action_data["data"]["isLiqi"]:
            ret.append({"type": "reach", "actor": actor})
        ret.append({"type": "dahai", "actor": actor, "pai": pai, "tsumogiri": tsumogiri})
        if action_data["data"]["isLiqi"]:
            self.accept_reach = {"type": "reach_accepted", "actor": actor}
        return ret

    def _handle_action_prototype(self, liqi_message: dict) -> list[dict]:
        """处理ActionPrototype相关的所有动作"""
        ret = []
        action_data = liqi_message["data"]
        action_name = action_data["name"]

        # start_kyoku
        if action_name == "ActionNewRound":
            ret.extend(self._handle_action_new_round(action_data))

        # 立直确认
        if self.accept_reach is not None:
            ret.append(self.accept_reach)
            self.accept_reach = None

        # 宝牌
        ret.extend(self._handle_dora_update(action_data))

        # 摸牌
        if action_name == "ActionDealTile":
            ret.extend(self._handle_action_deal_tile(action_data))

        # 打牌
        elif action_name == "ActionDiscardTile":
            ret.extend(self._handle_action_discard_tile(action_data))

        # 吃碰杠
        elif action_name == "ActionChiPengGang":
            ret.extend(self._handle_action_chi_peng_gang(action_data))

        # 暗杠/加杠
        elif action_name == "ActionAnGangAddGang":
            ret.extend(self._handle_action_an_gang_add_gang(action_data))

        # 拔北
        elif action_name == "ActionBaBei":
            actor = action_data["data"]["seat"]
            ret.append({"type": "nukidora", "actor": actor, "pai": "N"})

        # 本局结束
        elif action_name in ["ActionHule", "ActionNoTile", "ActionLiuJu"]:
            return [{"type": "end_kyoku"}]

        return ret

    def _handle_game_end(self, data: dict) -> list[dict]:
        """处理游戏结束"""
        try:
            for idx, player in enumerate(data["result"]["players"]):
                if player["seat"] == self.seat:
                    self.rank = idx + 1
                    self.score = player["partPoint1"]
        except Exception:
            pass
        self.game_ended = True
        return [{"type": "end_game"}]

    def _handle_auth_game(self, liqi_message: dict, msg_type: MsgType) -> list[dict]:
        """处理游戏认证消息"""
        if msg_type == MsgType.Req:
            return self._parse_auth_game_req(liqi_message)
        if msg_type == MsgType.Res:
            return self._parse_auth_game_res(liqi_message)
        return []

    def parse_liqi(self, liqi_message: dict) -> None | list[dict]:
        """解析Liqi协议消息"""
        if not liqi_message:
            return None

        method = liqi_message.get("method")
        msg_type = liqi_message.get("type")
        data = liqi_message.get("data")

        if method is None or msg_type is None or data is None:
            return []

        result = []

        # 游戏同步
        if method in [".lq.FastTest.syncGame", ".lq.FastTest.enterGame"] and msg_type == MsgType.Res:
            result = self._parse_sync_game(liqi_message)

        # 准备完成
        elif method == ".lq.FastTest.fetchGamePlayerState" and msg_type == MsgType.Res:
            self.AllReady = True

        # 游戏认证
        elif method == ".lq.FastTest.authGame":
            result = self._handle_auth_game(liqi_message, msg_type)

        # 游戏动作
        elif method == ".lq.ActionPrototype":
            result = self._handle_action_prototype(liqi_message)

        # 游戏结束
        elif method in [".lq.NotifyGameEndResult", ".lq.NotifyGameTerminate"]:
            result = self._handle_game_end(data)

        return result

    def build(self, command: dict) -> None | bytes:
        pass
