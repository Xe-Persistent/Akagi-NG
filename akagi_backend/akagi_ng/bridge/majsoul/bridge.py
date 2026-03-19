import base64
import contextlib
from functools import cmp_to_key

from akagi_ng.bridge.base import BaseBridge
from akagi_ng.bridge.logger import logger
from akagi_ng.bridge.majsoul.consts import OperationAnGangAddGang, OperationChiPengGang
from akagi_ng.bridge.majsoul.liqi import LiqiProto, MsgType
from akagi_ng.bridge.majsoul.modifier import MajsoulModifier, PacketMutation
from akagi_ng.bridge.majsoul.tile_mapping import MS_TILE_2_MJAI_TILE, compare_pai
from akagi_ng.schema.constants import MahjongConstants
from akagi_ng.schema.notifications import NotificationCode
from akagi_ng.schema.types import AkagiEvent, MJAIEvent


class MajsoulBridge(BaseBridge):
    def __init__(self):
        super().__init__()
        self.liqi_proto = LiqiProto()
        self.modifier = MajsoulModifier()
        self._logged_first_frame = False
        self._logged_first_parsed_message = False
        self._logged_first_unparsed_frame = False
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

    def parse(self, content: bytes) -> list[AkagiEvent]:
        """解析内容并返回 MJAI 指令。

        Args:
            content (bytes): 待解析的内容。

        Returns:
            list[AkagiEvent]: MJAI 指令。
        """
        try:
            liqi_message = self.liqi_proto.parse(content)
            parsed = self.parse_liqi(liqi_message)

            if parsed:
                logger.trace(f"<- {liqi_message}")
                logger.trace(f"-> {parsed}")

            return parsed
        except Exception as e:
            logger.error(f"Error parsing Majsoul message: {e}")
            return [self.make_system_event(NotificationCode.PARSE_ERROR)]

    def process_message(self, content: bytes, *, from_client: bool) -> tuple[list[AkagiEvent], PacketMutation]:
        """Parse MJAI events and optionally mutate the original websocket packet."""
        try:
            if not self._logged_first_frame:
                self._logged_first_frame = True
                logger.info(f"[MajsoulBridge] First websocket frame received from_client={from_client}")
            liqi_message = self.liqi_proto.parse(content)
            if liqi_message and not self._logged_first_parsed_message:
                self._logged_first_parsed_message = True
                logger.info(
                    f"[MajsoulBridge] First parsed liqi message: "
                    f"type={liqi_message.get('type')} method={liqi_message.get('method')}"
                )
            if not liqi_message and not self._logged_first_unparsed_frame:
                self._logged_first_unparsed_frame = True
                logger.warning("[MajsoulBridge] Received websocket frame but failed to parse liqi message")
            mutation = self.modifier.process(
                liqi_message,
                from_client=from_client,
                raw_content=content,
                liqi_proto=self.liqi_proto,
            )
            parsed = self.parse_liqi(liqi_message)

            if parsed:
                logger.trace(f"<- {liqi_message}")
                logger.trace(f"-> {parsed}")

            return parsed, mutation
        except Exception as e:
            logger.error(f"Error processing Majsoul message: {e}")
            return [self.make_system_event(NotificationCode.PARSE_ERROR)], PacketMutation()

    def _parse_sync_game(self, liqi_message: dict) -> list[AkagiEvent]:
        """处理游戏同步消息（重连后的同步）"""
        self._pre_scan_mode_from_sync_msg(liqi_message)

        sync_game_msgs = self._parse_sync_game_raw(liqi_message)
        parsed_list: list[AkagiEvent] = [self.make_system_event(NotificationCode.GAME_SYNCING)]

        try:
            for i, msg in enumerate(sync_game_msgs):
                # 只有最后一个动作不打 sync 标签，以便触发一次真实推荐展示
                is_last_msg = i == len(sync_game_msgs) - 1
                self.syncing = not is_last_msg
                parsed = self._handle_action_prototype(msg)
                if parsed:
                    parsed_list.extend(parsed)
        finally:
            self.syncing = False

        return parsed_list

    def _parse_enter_game(self, liqi_message: dict) -> list[AkagiEvent]:
        """处理进入对局消息（首次连接，无需同步）"""
        self.syncing = False
        self._pre_scan_mode_from_sync_msg(liqi_message)

        sync_game_msgs = self._parse_sync_game_raw(liqi_message)
        parsed_list: list[AkagiEvent] = []

        for msg in sync_game_msgs:
            parsed = self._handle_action_prototype(msg)
            if parsed:
                parsed_list.extend(parsed)

        return parsed_list

    def _pre_scan_mode_from_sync_msg(self, msg_dict: dict):
        """从同步/进入房间消息中预扫描游戏模式"""
        match msg_dict:
            case {"data": {"gameRestore": {"snapshot": {"players": players}}}}:
                self.is_3p = len(players) == MahjongConstants.SEATS_3P
                logger.debug(f"Pre-scanned mode from snapshot: is_3p={self.is_3p}")
            case _:
                pass

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
                if item := self._parse_sync_game_action_item(action):
                    msgs.append(item)
        except Exception as e:
            logger.error(f"Error parsing sync game: {e}")
        return msgs

    def _parse_sync_game_action_item(self, action_dict: dict) -> dict:
        """解析同步消息中的单个动作项"""
        inner_name = action_dict["name"]
        # 同步消息中的 data 为 base64 字符串，且由于是历史录像数据，不经过 XOR 加密。
        raw_data = base64.b64decode(action_dict["data"])
        inner_dict = self.liqi_proto.parse_wrapper(inner_name, raw_data, use_xor=False)

        if inner_dict is None:
            return {}

        action_dict["data"] = inner_dict
        return {"id": -1, "type": MsgType.Notify, "method": ".lq.ActionPrototype", "data": action_dict}

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
        except (KeyError, TypeError):
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

        # 构造 start_kyoku 事件
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
        优先移除完全匹配的牌，否则移除基础相同的牌。
        """
        if tile in self.my_tehais:
            self.my_tehais.remove(tile)
            return

        # 尝试基础牌名匹配（处理赤 5 / 普通 5 的交叉移除情况）
        base = tile.rstrip("r")
        for h in self.my_tehais:
            if h.rstrip("r") == base:
                self.my_tehais.remove(h)
                break

    def _update_hand_discard(self, actor: int, pai: str, tsumogiri: bool):
        """更新打牌后的手牌状态"""
        if actor != self.seat:
            return

        if tsumogiri:
            self.my_tsumohai = None
        elif pai in self.my_tehais:
            self.my_tehais.remove(pai)
        elif self.my_tsumohai == pai:
            self.my_tsumohai = None
        else:
            logger.warning(f"Discarded tile {pai} not found in hand {self.my_tehais}")

        # 手切后，将当前的摸牌移入手牌
        self._save_tsumohai_to_hand()

    def _update_hand_open_meld(self, actor: int, consumed: list[str]):
        """更新吃碰明杠后的手牌状态"""
        if actor != self.seat:
            return

        for t in consumed:
            self._remove_tile_from_hand(t)

    def _update_hand_kan(self, actor: int, consumed: list[str], is_kakan: bool, pai: str | None = None):
        """更新暗杠/加杠后的手牌状态。统一通过先存入手牌再统一移除的方式确保红黑匹配健壮性。"""
        if actor != self.seat:
            return

        # 先将摸牌存入手牌，然后统一从手中移除
        self._save_tsumohai_to_hand()

        match is_kakan:
            case True:
                # 加杠逻辑：从手牌中扣除被加杠的那张牌
                if pai:
                    self._remove_tile_from_hand(pai)
            case False:
                # 暗杠逻辑：从手牌中扣除被暗杠的 4 张牌
                for tile in consumed:
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

        if target == actor or not consumed or not pai:
            raise ValueError(f"Invalid Chi/Peng/Gang format: target={target}, consumed={consumed}, pai='{pai}'")

        self._update_hand_open_meld(actor, consumed)

        op_map = {
            OperationChiPengGang.Chi: (MahjongConstants.CHI_CONSUMED, self.make_chi, "Chi"),
            OperationChiPengGang.Peng: (MahjongConstants.PON_CONSUMED, self.make_pon, "Peng"),
            OperationChiPengGang.Gang: (MahjongConstants.DAIMINKAN_CONSUMED, self.make_daiminkan, "Daiminkan"),
        }

        op_type = data["type"]
        if op_type not in op_map:
            logger.error(f"Unknown ActionChiPengGang type: {op_type}")
            return []

        expected_len, make_func, op_name = op_map[op_type]
        if len(consumed) != expected_len:
            raise ValueError(f"Invalid consumed count for {op_name}: {len(consumed)}")

        return [make_func(actor, target, pai, consumed)]

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
        if "data" in action_data and (doras := action_data["data"].get("doras")) and len(doras) > len(self.doras):
            self.doras = doras
            return [self.make_dora(MS_TILE_2_MJAI_TILE[doras[-1]])]
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
        if accept_reach := self.accept_reach:
            ret.append(accept_reach)
            self.accept_reach = None

        # 宝牌
        ret.extend(self._handle_dora_update(action_data))

        return ret

    def _handle_game_end(self, data: dict) -> list[MJAIEvent]:
        """处理游戏结束"""
        with contextlib.suppress(Exception):
            for idx, player in enumerate(data["result"]["players"]):
                if player["seat"] == self.seat:
                    self.rank = idx + 1
                    self.score = player["partPoint1"]
        self.game_ended = True
        return [self.make_end_game()]

    def _handle_auth_game(self, liqi_message: dict, msg_type: MsgType) -> list[MJAIEvent]:
        """处理游戏认证消息"""
        if msg_type == MsgType.Req:
            return self._parse_auth_game_req(liqi_message)
        if msg_type == MsgType.Res:
            return self._parse_auth_game_res(liqi_message)
        return []

    def parse_liqi(self, liqi_message: dict) -> list[MJAIEvent]:
        """解析Liqi协议消息"""
        if not liqi_message:
            return []

        match liqi_message:
            case {"method": method, "type": msg_type, "data": data}:
                pass
            case _:
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
