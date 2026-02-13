import base64
from functools import cmp_to_key

from google.protobuf.json_format import MessageToDict

from akagi_ng.bridge.base import BaseBridge
from akagi_ng.bridge.logger import logger
from akagi_ng.bridge.majsoul.consts import OperationAnGangAddGang, OperationChiPengGang
from akagi_ng.bridge.majsoul.liqi import LiqiProto, MsgType
from akagi_ng.bridge.majsoul.tile_mapping import MS_TILE_2_MJAI_TILE, compare_pai
from akagi_ng.schema.constants import MahjongConstants
from akagi_ng.schema.notifications import NotificationCode
from akagi_ng.schema.types import AkagiEvent, MJAIEvent


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

    def parse(self, content: bytes) -> list[AkagiEvent] | None:
        """解析内容并返回 MJAI 指令。

        Args:
            content (bytes): 待解析的内容。

        Returns:
            None | list[MJAIEvent]: MJAI 指令。
        """
        liqi_message = self.liqi_proto.parse(content)
        logger.trace(f"{liqi_message}")
        ret = self.parse_liqi(liqi_message)
        if ret:
            logger.trace(f"-> {ret}")
        return ret

    def _parse_sync_game(self, liqi_message: dict) -> list[MJAIEvent]:
        """处理游戏同步消息（重连后的同步）"""
        self.syncing = True

        # 预扫描模式
        self._pre_scan_mode_from_sync_msg(liqi_message)

        sync_game_msgs = self._parse_sync_game_raw(liqi_message)
        parsed_list: list[MJAIEvent] = [self.make_system_event(code=NotificationCode.GAME_SYNCING)]

        _, action_msgs = self._analyze_sync_game(sync_game_msgs)

        for i, msg in enumerate(action_msgs):
            parsed = self.parse_liqi(msg)
            if parsed:
                # 只有最后一个动作不打 sync 标签，以便触发一次真实推荐展示
                is_last_msg = i == len(action_msgs) - 1
                for event in parsed:
                    if not is_last_msg:
                        event["sync"] = True
                parsed_list.extend(parsed)

        self.syncing = False
        return parsed_list if len(parsed_list) >= 1 else []

    def _parse_enter_game(self, liqi_message: dict) -> list[MJAIEvent]:
        """处理进入对局消息（首次连接，无需同步）"""
        self.syncing = False

        # 预扫描模式
        self._pre_scan_mode_from_sync_msg(liqi_message)

        sync_game_msgs = self._parse_sync_game_raw(liqi_message)
        parsed_list: list[MJAIEvent] = []

        _, action_msgs = self._analyze_sync_game(sync_game_msgs)

        for msg in action_msgs:
            parsed = self.parse_liqi(msg)
            if parsed:
                parsed_list.extend(parsed)

        return parsed_list if len(parsed_list) >= 1 else []

    def _pre_scan_mode_from_sync_msg(self, msg_dict: dict) -> None:
        """从同步/进入房间消息中预扫描游戏模式"""
        try:
            data = msg_dict.get("data", {})
            restore = data.get("gameRestore")
            if not restore:
                return
            snapshot = restore.get("snapshot")
            if not snapshot:
                return
            players = snapshot.get("players", [])
            self.is_3p = len(players) == MahjongConstants.SEATS_3P
            logger.debug(f"[Majsoul] Pre-scanned mode from snapshot: is_3p={self.is_3p}")
        except Exception as e:
            logger.warning(f"Failed to pre-scan mode from sync msg: {e}")

    def _parse_sync_game_raw(self, msg_dict: dict) -> list[dict]:
        """从后端同步字典中解析出原始消息列表"""
        msgs = []
        try:
            data = msg_dict.get("data", {})
            restore = data.get("gameRestore")
            if not restore:
                return []

            actions = restore.get("actions", [])
            for action in actions:
                msgs.append(self._parse_sync_game_action_item(action))

            snapshot = restore.get("snapshot")
            if snapshot:
                msgs.append({"type": "sync_game", "snapshot": snapshot})
        except Exception as e:
            logger.error(f"Error parsing sync game: {e}")
        return msgs

    def _parse_sync_game_action_item(self, action_dict: dict) -> dict:
        """解析同步消息中的单个动作项"""
        msg_cls = self.liqi_proto.get_message_class(action_dict["name"])
        if not msg_cls:
            return {}

        action_dict["data"] = MessageToDict(
            msg_cls.FromString(base64.b64decode(action_dict["data"])),
            always_print_fields_with_no_presence=True,
        )
        return {"id": -1, "type": MsgType.Notify, "method": ".lq.ActionPrototype", "data": action_dict}

    def _analyze_sync_game(self, msgs: list[dict]) -> tuple[dict | None, list[dict]]:
        """分析同步消息列表，分离快照和动作"""
        snapshot_msg = None
        action_msgs = []
        for msg in msgs:
            if not msg:
                continue
            if msg.get("type") == "sync_game":
                snapshot_msg = msg
                continue
            action_msgs.append(msg)
        return snapshot_msg, action_msgs

    def _parse_auth_game_req(self, liqi_message: dict) -> list[MJAIEvent]:
        """处理游戏认证请求"""
        self.reset()
        self.accountId = liqi_message["data"]["accountId"]
        return []

    def _parse_auth_game_res(self, liqi_message: dict) -> list[MJAIEvent]:
        """处理游戏认证响应"""
        self.is_3p = len(liqi_message["data"]["seatList"]) == MahjongConstants.SEATS_3P
        try:
            self.mode_id = liqi_message["data"]["gameConfig"]["meta"]["modeId"]
        except Exception:
            self.mode_id = -1

        seat_list = liqi_message["data"]["seatList"]
        self.seat = seat_list.index(self.accountId)
        return [self.make_start_game(self.seat, is_3p=self.is_3p)]

    def _setup_new_round_tehais(self, tiles: list[str]) -> tuple[list[list[str]], list[str], str | None]:
        """初始化新一局的手牌

        Returns:
            tuple: (tehais_display, my_tehais, my_tsumohai)
        """
        tehais = [["?"] * MahjongConstants.TEHAI_SIZE for _ in range(MahjongConstants.SEATS_4P)]
        my_tehais = ["?"] * MahjongConstants.TEHAI_SIZE
        my_tsumohai = None

        for hai in range(MahjongConstants.TEHAI_SIZE):
            my_tehais[hai] = MS_TILE_2_MJAI_TILE[tiles[hai]]

        if len(tiles) == MahjongConstants.TEHAI_SIZE:
            sorted_tehais = sorted(my_tehais, key=cmp_to_key(compare_pai))
            tehais[self.seat] = list(sorted_tehais)
            my_tehais = sorted_tehais
        elif len(tiles) == MahjongConstants.TSUMO_TEHAI_SIZE:
            # 将14张牌排序后，前13张作为手牌，最后1张作为摸牌
            all_tiles = sorted(
                [*my_tehais, MS_TILE_2_MJAI_TILE[tiles[MahjongConstants.TEHAI_SIZE]]], key=cmp_to_key(compare_pai)
            )
            my_tehais = all_tiles[: MahjongConstants.TEHAI_SIZE]
            my_tsumohai = all_tiles[MahjongConstants.TEHAI_SIZE]
            tehais[self.seat] = list(my_tehais)
        else:
            logger.error(f"Unexpected tile count in ActionNewRound: {len(tiles)}")
            return [], [], None

        return tehais, my_tehais, my_tsumohai

    def _handle_action_new_round(self, action_data: dict) -> list[MJAIEvent]:
        """处理ActionNewRound动作"""
        ret: list[MJAIEvent] = []

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

        tehais, self.my_tehais, self.my_tsumohai = self._setup_new_round_tehais(data["tiles"])
        if not tehais:
            return []

        # 构造 start_kyoku 事件（两种情况都需要）
        ret.append(
            self.make_start_kyoku(
                bakaze=bakaze,
                kyoku=kyoku,
                honba=honba,
                kyotaku=kyotaku,
                oya=oya,
                dora_marker=dora_marker,
                scores=scores,
                tehais=tehais,
            )
        )

        # 如果是 14 张牌，额外添加 tsumo 事件
        if len(data["tiles"]) == MahjongConstants.TSUMO_TEHAI_SIZE:
            ret.append(self.make_tsumo(self.seat, self.my_tsumohai))

        return ret

    def _save_tsumohai_to_hand(self):
        """将摸牌保存到手牌中。

        在执行某些操作（如吃碰杠、拔北）前调用此方法，
        以防止 my_tsumohai 被后续的摸牌事件覆盖而丢失。
        """
        if self.my_tsumohai:
            self.my_tehais.append(self.my_tsumohai)
            self.my_tehais.sort(key=cmp_to_key(compare_pai))
            self.my_tsumohai = None

    def _remove_tile_from_hand(self, tile: str):
        """从手牌中移除指定牌（支持赤宝牌匹配）。

        Args:
            tile: 要移除的牌，如 "5m"、"5mr" 等
        """
        if tile in self.my_tehais:
            self.my_tehais.remove(tile)
        elif tile.replace("r", "") in self.my_tehais:
            self.my_tehais.remove(tile.replace("r", ""))
        elif tile + "r" in self.my_tehais:
            self.my_tehais.remove(tile + "r")

    def _update_hand_discard(self, actor: int, pai: str, tsumogiri: bool):
        """更新打牌后的手牌状态"""
        if actor != self.seat:
            return

        if tsumogiri:
            self.my_tsumohai = None
        else:
            if pai in self.my_tehais:
                self.my_tehais.remove(pai)
            elif self.my_tsumohai == pai:
                self.my_tsumohai = None
            else:
                logger.warning(f"Discarded tile {pai} not found in hand {self.my_tehais}")

            # 手切后，将摸牌移入手牌
            self._save_tsumohai_to_hand()

    def _update_hand_open_meld(self, actor: int, consumed: list[str]):
        """更新吃碰明杠后的手牌状态"""
        if actor != self.seat:
            return

        for t in consumed:
            if t in self.my_tehais:
                self.my_tehais.remove(t)

    def _update_hand_kan(self, actor: int, consumed: list[str], is_kakan: bool, pai: str | None = None):
        """更新暗杠/加杠后的手牌状态"""
        if actor != self.seat:
            return

        if is_kakan:
            # 加杠前，检查 tsumohai 是否为被杠的牌
            if self.my_tsumohai == pai:
                # tsumohai 本身被加杠，直接消耗
                self.my_tsumohai = None
            else:
                # tsumohai 不是被杠的牌，先保存再从手牌中移除被杠的牌
                self._save_tsumohai_to_hand()
                if pai and pai in self.my_tehais:
                    self.my_tehais.remove(pai)
        else:
            # 暗杠：检查 tsumohai 是否参与消耗
            removal_candidates = list(consumed)
            tsumo_consumed = False

            if self.my_tsumohai in removal_candidates:
                removal_candidates.remove(self.my_tsumohai)
                self.my_tsumohai = None
                tsumo_consumed = True

            # tsumohai 未被消耗，保存到手牌以等待岭上牌
            if not tsumo_consumed:
                self._save_tsumohai_to_hand()

            # 从手牌中移除被杠的牌
            for tile in removal_candidates:
                self._remove_tile_from_hand(tile)

    def _handle_action_chi_peng_gang(self, action_data: dict) -> list[MJAIEvent]:
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

        self._update_hand_open_meld(actor, consumed)

        match data["type"]:
            case OperationChiPengGang.Chi:
                assert len(consumed) == MahjongConstants.CHI_CONSUMED
                return [self.make_chi(actor, target, pai, consumed)]
            case OperationChiPengGang.Peng:
                assert len(consumed) == MahjongConstants.PON_CONSUMED
                return [self.make_pon(actor, target, pai, consumed)]
            case OperationChiPengGang.Gang:
                assert len(consumed) == MahjongConstants.DAIMINKAN_CONSUMED
                return [self.make_daiminkan(actor, target, pai, consumed)]
            case _:
                logger.error(f"Unknown ActionChiPengGang type: {data['type']}")
                return []

    def _handle_action_an_gang_add_gang(self, action_data: dict) -> list[MJAIEvent]:
        """处理暗杠/加杠动作"""
        data = action_data["data"]
        actor = data["seat"]

        match data["type"]:
            case OperationAnGangAddGang.AnGang:
                pai = MS_TILE_2_MJAI_TILE[data["tiles"]]
                consumed = [pai.replace("r", "")] * MahjongConstants.ANKAN_TILES
                if pai[0] == "5" and pai[1] != "z":
                    consumed[0] += "r"

                self._update_hand_kan(actor, consumed, is_kakan=False)
                return [self.make_ankan(actor, consumed)]
            case OperationAnGangAddGang.AddGang:
                pai = MS_TILE_2_MJAI_TILE[data["tiles"]]
                consumed = [pai.replace("r", "")] * MahjongConstants.KAKAN_CONSUMED
                if pai[0] == "5" and not pai.endswith("r"):
                    consumed[0] = consumed[0] + "r"

                self._update_hand_kan(actor, consumed, is_kakan=True, pai=pai)
                return [self.make_kakan(actor, pai, consumed)]
        return []

    def _handle_dora_update(self, action_data: dict) -> list[MJAIEvent]:
        """处理宝牌更新"""
        if (
            "data" in action_data
            and "doras" in action_data["data"]
            and len(action_data["data"]["doras"]) > len(self.doras)
        ):
            self.doras = action_data["data"]["doras"]
            return [self.make_dora(MS_TILE_2_MJAI_TILE[action_data["data"]["doras"][-1]])]
        return []

    def _handle_action_deal_tile(self, action_data: dict) -> list[MJAIEvent]:
        """处理 ActionDealTile（摸牌）动作"""
        actor = action_data["data"]["seat"]
        if action_data["data"]["tile"] == "":
            pai = "?"
        else:
            pai = MS_TILE_2_MJAI_TILE[action_data["data"]["tile"]]
            if actor == self.seat:
                self.my_tsumohai = pai
        return [self.make_tsumo(actor, pai)]

    def _handle_action_discard_tile(self, action_data: dict) -> list[MJAIEvent]:
        """处理 ActionDiscardTile（打牌）动作"""
        ret: list[MJAIEvent] = []
        actor = action_data["data"]["seat"]
        self.lastDiscard = actor
        pai = MS_TILE_2_MJAI_TILE[action_data["data"]["tile"]]
        tsumogiri = action_data["data"]["moqie"]
        if action_data["data"]["isLiqi"]:
            ret.append(self.make_reach(actor))
        ret.append(self.make_dahai(actor, pai, tsumogiri))

        self._update_hand_discard(actor, pai, tsumogiri)

        if action_data["data"]["isLiqi"]:
            self.accept_reach = self.make_reach_accepted(actor)
        return ret

    def _handle_action_ba_bei(self, action_data: dict) -> list[MJAIEvent]:
        """处理 ActionBaBei（拔北）动作"""
        actor = action_data["data"]["seat"]

        # 更新手牌：移除北风
        if actor == self.seat:
            if "N" in self.my_tehais:
                self.my_tehais.remove("N")
            elif self.my_tsumohai == "N":
                self.my_tsumohai = None
            else:
                logger.warning(f"Nukidora 'N' not found in hand {self.my_tehais}")

            # 拔北后，保存剩余的 tsumohai 以等待岭上牌
            self._save_tsumohai_to_hand()

        return [self.make_nukidora(actor)]

    def _handle_action_prototype(self, liqi_message: dict) -> list[MJAIEvent]:
        """处理ActionPrototype相关的所有动作"""
        ret: list[MJAIEvent] = []
        action_data = liqi_message["data"]
        action_name = action_data["name"]

        match action_name:
            # 本局开始
            case "ActionNewRound":
                ret.extend(self._handle_action_new_round(action_data))
            # 摸牌
            case "ActionDealTile":
                ret.extend(self._handle_action_deal_tile(action_data))
            # 打牌
            case "ActionDiscardTile":
                ret.extend(self._handle_action_discard_tile(action_data))
            # 吃碰杠
            case "ActionChiPengGang":
                ret.extend(self._handle_action_chi_peng_gang(action_data))
            # 暗杠/加杠
            case "ActionAnGangAddGang":
                ret.extend(self._handle_action_an_gang_add_gang(action_data))
            # 拔北
            case "ActionBaBei":
                ret.extend(self._handle_action_ba_bei(action_data))
            # 本局结束
            case "ActionHule" | "ActionNoTile" | "ActionLiuJu":
                return [self.make_end_kyoku()]

        # 立直确认
        if self.accept_reach is not None:
            ret.append(self.accept_reach)
            self.accept_reach = None

        # 宝牌
        ret.extend(self._handle_dora_update(action_data))

        return ret

    def _handle_game_end(self, data: dict) -> list[MJAIEvent]:
        """处理游戏结束"""
        try:
            for idx, player in enumerate(data["result"]["players"]):
                if player["seat"] == self.seat:
                    self.rank = idx + 1
                    self.score = player["partPoint1"]
        except Exception:
            pass
        self.game_ended = True
        return [self.make_end_game()]

    def _handle_auth_game(self, liqi_message: dict, msg_type: MsgType) -> list[MJAIEvent]:
        """处理游戏认证消息"""
        if msg_type == MsgType.Req:
            return self._parse_auth_game_req(liqi_message)
        if msg_type == MsgType.Res:
            return self._parse_auth_game_res(liqi_message)
        return []

    def parse_liqi(self, liqi_message: dict) -> None | list[MJAIEvent]:
        """解析Liqi协议消息"""
        if not liqi_message:
            return None

        method = liqi_message.get("method")
        msg_type = liqi_message.get("type")
        data = liqi_message.get("data")

        if method is None or msg_type is None or data is None:
            return []

        result: list[MJAIEvent] = []

        match (method, msg_type):
            # 游戏同步（重连）
            case (".lq.FastTest.syncGame", MsgType.Res):
                result = self._parse_sync_game(liqi_message)
            # 进入对局（首次连接）
            case (".lq.FastTest.enterGame", MsgType.Res):
                result = self._parse_enter_game(liqi_message)
            # 游戏认证
            case (".lq.FastTest.authGame", m_type):
                result = self._handle_auth_game(liqi_message, m_type)
            # 游戏动作
            case (".lq.ActionPrototype", _):
                result = self._handle_action_prototype(liqi_message)
            # 游戏结束
            case (".lq.NotifyGameEndResult" | ".lq.NotifyGameTerminate", _):
                result = self._handle_game_end(data)

        return result
