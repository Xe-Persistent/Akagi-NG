from functools import cmp_to_key

from akagi_ng.bridge.base import BaseBridge
from akagi_ng.bridge.logger import logger
from akagi_ng.bridge.majsoul.consts import OperationAnGangAddGang, OperationChiPengGang
from akagi_ng.bridge.majsoul.liqi import LiqiProto, MsgType, parse_sync_game
from akagi_ng.bridge.majsoul.tile_mapping import MS_TILE_2_MJAI_TILE, compare_pai
from akagi_ng.core import NotificationCode
from akagi_ng.core.constants import MahjongConstants


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
        return [self.make_start_game()]

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
            tehais[self.seat] = sorted(my_tehais, key=cmp_to_key(compare_pai))
            my_tehais = sorted(my_tehais, key=cmp_to_key(compare_pai))
        elif len(tiles) == MahjongConstants.TSUMO_TEHAI_SIZE:
            my_tsumohai = MS_TILE_2_MJAI_TILE[tiles[MahjongConstants.TEHAI_SIZE]]
            all_tehais = [*my_tehais, my_tsumohai]
            all_tehais = sorted(all_tehais, key=cmp_to_key(compare_pai))
            tehais[self.seat] = all_tehais[: MahjongConstants.TEHAI_SIZE]
            my_tehais = sorted(my_tehais, key=cmp_to_key(compare_pai))
        else:
            logger.error(f"Unexpected tile count in ActionNewRound: {len(tiles)}")
            return [], [], None

        return tehais, my_tehais, my_tsumohai

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
                is_3p=self.is_3p,
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

        # 吃碰杠前，先将 tsumohai 保存到手牌，防止后续摸牌覆盖
        self._save_tsumohai_to_hand()

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

    def _handle_dora_update(self, action_data: dict) -> list[dict]:
        """处理宝牌更新"""
        if (
            "data" in action_data
            and "doras" in action_data["data"]
            and len(action_data["data"]["doras"]) > len(self.doras)
        ):
            self.doras = action_data["data"]["doras"]
            return [self.make_dora(MS_TILE_2_MJAI_TILE[action_data["data"]["doras"][-1]])]
        return []

    def _handle_action_deal_tile(self, action_data: dict) -> list[dict]:
        """处理 ActionDealTile（摸牌）动作"""
        actor = action_data["data"]["seat"]
        if action_data["data"]["tile"] == "":
            pai = "?"
        else:
            pai = MS_TILE_2_MJAI_TILE[action_data["data"]["tile"]]
            if actor == self.seat:
                self.my_tsumohai = pai
        return [self.make_tsumo(actor, pai)]

    def _handle_action_discard_tile(self, action_data: dict) -> list[dict]:
        """处理 ActionDiscardTile（打牌）动作"""
        ret = []
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

    def _handle_action_ba_bei(self, action_data: dict) -> list[dict]:
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

    def _handle_action_prototype(self, liqi_message: dict) -> list[dict]:
        """处理ActionPrototype相关的所有动作"""
        ret = []
        action_data = liqi_message["data"]
        action_name = action_data["name"]

        # 本局开始
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
            ret.extend(self._handle_action_ba_bei(action_data))

        # 本局结束
        elif action_name in ["ActionHule", "ActionNoTile", "ActionLiuJu"]:
            return [self.make_end_kyoku()]

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
        return [self.make_end_game()]

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
