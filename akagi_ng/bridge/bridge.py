from functools import cmp_to_key

from .bridge_base import BridgeBase
from .liqi import LiqiProto, MsgType, parse_sync_game
from .logger import logger

MS_TILE_2_MJAI_TILE = {
    '0m': '5mr',
    '1m': '1m',
    '2m': '2m',
    '3m': '3m',
    '4m': '4m',
    '5m': '5m',
    '6m': '6m',
    '7m': '7m',
    '8m': '8m',
    '9m': '9m',
    '0p': '5pr',
    '1p': '1p',
    '2p': '2p',
    '3p': '3p',
    '4p': '4p',
    '5p': '5p',
    '6p': '6p',
    '7p': '7p',
    '8p': '8p',
    '9p': '9p',
    '0s': '5sr',
    '1s': '1s',
    '2s': '2s',
    '3s': '3s',
    '4s': '4s',
    '5s': '5s',
    '6s': '6s',
    '7s': '7s',
    '8s': '8s',
    '9s': '9s',
    '1z': 'E',
    '2z': 'S',
    '3z': 'W',
    '4z': 'N',
    '5z': 'P',
    '6z': 'F',
    '7z': 'C'
}
MJAI_TILE_2_MS_TILE = {
    '5mr': '0m',
    '1m': '1m',
    '2m': '2m',
    '3m': '3m',
    '4m': '4m',
    '5m': '5m',
    '6m': '6m',
    '7m': '7m',
    '8m': '8m',
    '9m': '9m',
    '5pr': '0p',
    '1p': '1p',
    '2p': '2p',
    '3p': '3p',
    '4p': '4p',
    '5p': '5p',
    '6p': '6p',
    '7p': '7p',
    '8p': '8p',
    '9p': '9p',
    '5sr': '0s',
    '1s': '1s',
    '2s': '2s',
    '3s': '3s',
    '4s': '4s',
    '5s': '5s',
    '6s': '6s',
    '7s': '7s',
    '8s': '8s',
    '9s': '9s',
    'E': '1z',
    'S': '2z',
    'W': '3z',
    'N': '4z',
    'P': '5z',
    'F': '6z',
    'C': '7z'
}


class Operation:
    NoEffect = 0
    Discard = 1
    Chi = 2
    Peng = 3
    AnGang = 4
    MingGang = 5
    JiaGang = 6
    Liqi = 7
    Zimo = 8
    Hu = 9
    LiuJu = 10


class OperationChiPengGang:
    Chi = 0
    Peng = 1
    Gang = 2


class OperationAnGangAddGang:
    AnGang = 3
    AddGang = 2


class MajsoulBridge(BridgeBase):
    def __init__(self):
        super().__init__()
        self.liqi_proto = LiqiProto()

        self.accountId = 0
        self.seat = 0
        self.lastDiscard = None
        self.reach = False
        self.accept_reach = None
        self.operation = {}
        self.AllReady = False
        self.temp = {}
        self.doras = []
        self.my_tehais = ["?"] * 13
        self.my_tsumohai = "?"
        self.syncing = False

        self.mode_id = -1
        self.rank = -1
        self.score = -1

        self.is_3p = False

    def reset(self):
        super().__init__()

        self.accountId = 0
        self.seat = 0
        self.lastDiscard = None
        self.reach = False
        self.accept_reach = None
        self.operation = {}
        self.AllReady = False
        self.temp = {}
        self.doras = []
        self.my_tehais = ["?"] * 13
        self.my_tsumohai = "?"
        self.syncing = False

        self.mode_id = -1
        self.rank = -1
        self.score = -1

        self.is_3p = False

    def parse(self, content: bytes) -> None | list[dict]:
        """Parses the content and returns MJAI command.

        Args:
            content (bytes): Content to be parsed.

        Returns:
            None | list[dict]: MJAI command.
        """
        liqi_message = self.liqi_proto.parse(content)
        logger.trace(f"{liqi_message}")
        ret = self.parse_liqi(liqi_message)
        logger.trace(f"-> {ret}")
        return ret

    def parse_liqi(self, liqi_message: dict) -> None | list[dict]:
        ret = []

        if not liqi_message:
            return None

        method = liqi_message.get("method")
        msg_type = liqi_message.get("type")
        data = liqi_message.get("data")

        if method is None or msg_type is None or data is None:
            return ret

        # Sync Game
        if ((liqi_message['method'] == '.lq.FastTest.syncGame' or liqi_message['method'] == '.lq.FastTest.enterGame')
                and liqi_message['type'] == MsgType.Res):
            self.syncing = True
            sync_game_msgs = parse_sync_game(liqi_message)
            parsed_list = []
            for msg in sync_game_msgs:
                parsed = self.parse_liqi(msg)
                if parsed:
                    parsed_list.extend(parsed)
            self.syncing = False
            if len(parsed_list) >= 1:
                return parsed_list
            else:
                ret = []
                return ret

        # ready
        if liqi_message['method'] == '.lq.FastTest.fetchGamePlayerState' and liqi_message['type'] == MsgType.Res:
            self.AllReady = True
            return ret
        # start_game
        if liqi_message['method'] == '.lq.FastTest.authGame' and liqi_message['type'] == MsgType.Req:
            self.reset()
            self.accountId = liqi_message['data']['accountId']
            return ret
        if liqi_message['method'] == '.lq.FastTest.authGame' and liqi_message['type'] == MsgType.Res:
            self.is_3p = len(liqi_message['data']['seatList']) == 3
            try:
                self.mode_id = liqi_message['data']['gameConfig']['meta']['modeId']
            except:
                self.mode_id = -1

            seat_list = liqi_message['data']['seatList']
            self.seat = seat_list.index(self.accountId)
            ret.append({
                'type': 'start_game',
                'id': self.seat
            })
            return ret
        if liqi_message['method'] == '.lq.ActionPrototype':
            # start_kyoku
            if liqi_message['data']['name'] == 'ActionNewRound':
                self.AllReady = False
                bakaze = ['E', 'S', 'W', 'N'][liqi_message['data']['data']['chang']]
                dora_marker = MS_TILE_2_MJAI_TILE[liqi_message['data']['data']['doras'][0]]
                self.doras = [dora_marker]
                honba = liqi_message['data']['data']['ben']
                oya = liqi_message['data']['data']['ju']
                kyoku = oya + 1
                kyotaku = liqi_message['data']['data']['liqibang']
                scores = liqi_message['data']['data']['scores']
                if self.is_3p:
                    scores = scores + [0]
                tehais = [['?'] * 13] * 4
                my_tehais = ['?'] * 13
                for hai in range(13):
                    my_tehais[hai] = MS_TILE_2_MJAI_TILE[liqi_message['data']['data']['tiles'][hai]]
                if len(liqi_message['data']['data']['tiles']) == 13:
                    tehais[self.seat] = sorted(my_tehais, key=cmp_to_key(compare_pai))
                    ret.append(
                        {
                            'type': 'start_kyoku',
                            'bakaze': bakaze,
                            'dora_marker': dora_marker,
                            'honba': honba,
                            'kyoku': kyoku,
                            'kyotaku': kyotaku,
                            'oya': oya,
                            'scores': scores,
                            'tehais': tehais
                        }
                    )
                elif len(liqi_message['data']['data']['tiles']) == 14:
                    self.my_tsumohai = MS_TILE_2_MJAI_TILE[liqi_message['data']['data']['tiles'][13]]
                    all_tehais = my_tehais + [self.my_tsumohai]
                    all_tehais = sorted(all_tehais, key=cmp_to_key(compare_pai))
                    tehais[self.seat] = all_tehais[:13]
                    ret.append(
                        {
                            'type': 'start_kyoku',
                            'bakaze': bakaze,
                            'dora_marker': dora_marker,
                            'honba': honba,
                            'kyoku': kyoku,
                            'kyotaku': kyotaku,
                            'oya': oya,
                            'scores': scores,
                            'tehais': tehais
                        }
                    )
                    ret.append(
                        {
                            'type': 'tsumo',
                            'actor': self.seat,
                            'pai': all_tehais[13]
                        }
                    )
                else:
                    raise

            if self.accept_reach is not None:
                ret.append(self.accept_reach)
                self.accept_reach = None

            # According to mjai.app, in the case of an ankan, the dora event comes first, followed by the tsumo event.
            if 'data' in liqi_message['data']:
                if 'doras' in liqi_message['data']['data']:
                    if len(liqi_message['data']['data']['doras']) > len(self.doras):
                        ret.append(
                            {
                                'type': 'dora',
                                'dora_marker': MS_TILE_2_MJAI_TILE[liqi_message['data']['data']['doras'][-1]]
                            }
                        )
                        self.doras = liqi_message['data']['data']['doras']

            # tsumo
            if liqi_message['data']['name'] == 'ActionDealTile':
                actor = liqi_message['data']['data']['seat']
                if liqi_message['data']['data']['tile'] == '':
                    pai = '?'
                else:
                    pai = MS_TILE_2_MJAI_TILE[liqi_message['data']['data']['tile']]
                    self.my_tsumohai = pai
                ret.append(
                    {
                        'type': 'tsumo',
                        'actor': actor,
                        'pai': pai
                    }
                )
            # dahai
            if liqi_message['data']['name'] == 'ActionDiscardTile':
                actor = liqi_message['data']['data']['seat']
                self.lastDiscard = actor
                pai = MS_TILE_2_MJAI_TILE[liqi_message['data']['data']['tile']]
                tsumogiri = liqi_message['data']['data']['moqie']
                if liqi_message['data']['data']['isLiqi']:
                    ret.append(
                        {
                            'type': 'reach',
                            'actor': actor
                        }
                    )
                ret.append(
                    {
                        'type': 'dahai',
                        'actor': actor,
                        'pai': pai,
                        'tsumogiri': tsumogiri
                    }
                )
                if liqi_message['data']['data']['isLiqi']:
                    self.accept_reach = {
                        'type': 'reach_accepted',
                        'actor': actor
                    }
            # Riichi
            if liqi_message['data']['name'] == 'ActionReach':
                # bridge.py handles Server -> Client messages.
                # When ActionReach (or ActionDiscardTile with isLiqi) is received, the Riichi action is already completed and confirmed.
                # Our "Riichi Recommendation" feature is based on Q-Values (last_inference_result) exposed by the Bot
                # during its current turn's thinking phase (after State update, before Action).
                # Therefore, how Bridge parses the "Riichi Confirmation" message is irrelevant to the "what to discard for Riichi"
                # feature which happens *before* the decision.
                # The original logic (synthesizing reach event in ActionDiscardTile by checking isLiqi) is sufficient
                # and robust for maintaining Bot state.
                pass
            # ChiPonKan
            if liqi_message['data']['name'] == 'ActionChiPengGang':
                actor = liqi_message['data']['data']['seat']
                target = actor
                consumed = []
                pai = ''
                for idx, seat in enumerate(liqi_message['data']['data']['froms']):
                    if seat != actor:
                        target = seat
                        pai = MS_TILE_2_MJAI_TILE[liqi_message['data']['data']['tiles'][idx]]
                    else:
                        consumed.append(MS_TILE_2_MJAI_TILE[liqi_message['data']['data']['tiles'][idx]])
                assert target != actor
                assert len(consumed) != 0
                assert pai != ''
                match liqi_message['data']['data']['type']:
                    case OperationChiPengGang.Chi:
                        assert len(consumed) == 2
                        ret.append(
                            {
                                'type': 'chi',
                                'actor': actor,
                                'target': target,
                                'pai': pai,
                                'consumed': consumed
                            }
                        )
                        pass
                    case OperationChiPengGang.Peng:
                        assert len(consumed) == 2
                        ret.append(
                            {
                                'type': 'pon',
                                'actor': actor,
                                'target': target,
                                'pai': pai,
                                'consumed': consumed
                            }
                        )
                    case OperationChiPengGang.Gang:
                        assert len(consumed) == 3
                        ret.append(
                            {
                                'type': 'daiminkan',
                                'actor': actor,
                                'target': target,
                                'pai': pai,
                                'consumed': consumed
                            }
                        )
                        pass
                    case _:
                        raise
            # AnkanKakan
            if liqi_message['data']['name'] == 'ActionAnGangAddGang':
                actor = liqi_message['data']['data']['seat']
                match liqi_message['data']['data']['type']:
                    case OperationAnGangAddGang.AnGang:
                        pai = MS_TILE_2_MJAI_TILE[liqi_message['data']['data']['tiles']]
                        consumed = [pai.replace("r", "")] * 4
                        if pai[0] == '5' and pai[1] != 'z':
                            consumed[0] += 'r'
                        ret.append(
                            {
                                'type': 'ankan',
                                'actor': actor,
                                'consumed': consumed
                            }
                        )
                    case OperationAnGangAddGang.AddGang:
                        pai = MS_TILE_2_MJAI_TILE[liqi_message['data']['data']['tiles']]
                        consumed = [pai.replace("r", "")] * 3
                        if pai[0] == "5" and not pai.endswith("r"):
                            consumed[0] = consumed[0] + "r"
                        ret.append(
                            {
                                'type': 'kakan',
                                'actor': actor,
                                'pai': pai,
                                'consumed': consumed
                            }
                        )
            # nukidora
            if liqi_message['data']['name'] == 'ActionBaBei':
                actor = liqi_message['data']['data']['seat']
                ret.append(
                    {
                        'type': 'nukidora',
                        'actor': actor,
                        'pai': 'N'
                    }
                )
            # End of Kyoku (Hora, NoTile, Ryukyoku)
            if liqi_message['data']['name'] in ['ActionHule', 'ActionNoTile', 'ActionLiuJu']:
                # Simplify logic: For AI purposes, we only need to know the round ended.
                # Detailed result parsing (who won, points, etc.) is complex (multiplex/double ron) 
                # and unnecessary because the next 'start_kyoku' will synchronize the full score state.
                ret = [{
                    'type': 'end_kyoku'
                }]
                return ret
            if 'data' in liqi_message['data']:
                if 'operation' in liqi_message['data']['data']:
                    return ret
        # end_game
        if liqi_message['method'] == '.lq.NotifyGameEndResult' or liqi_message['method'] == '.lq.NotifyGameTerminate':
            try:
                for idx, player in enumerate(liqi_message['data']['result']['players']):
                    if player['seat'] == self.seat:
                        self.rank = idx + 1
                        self.score = player['partPoint1']
            except:
                pass
            ret.append(
                {
                    'type': 'end_game'
                }
            )
            return ret
        return ret

    def build(self, command: dict) -> None | bytes:
        pass


def compare_pai(pai1: str, pai2: str):
    # Smallest
    # 1m~4m, 5mr, 5m~9m,
    # 1p~4p, 5pr, 5p~9p,
    # 1s~4s, 5sr, 5s~9s,
    # E, S, W, N, P, F, C, ?
    # Biggest
    pai_order = [
        '1m', '2m', '3m', '4m', '5mr', '5m', '6m', '7m', '8m', '9m',
        '1p', '2p', '3p', '4p', '5pr', '5p', '6p', '7p', '8p', '9p',
        '1s', '2s', '3s', '4s', '5sr', '5s', '6s', '7s', '8s', '9s',
        'E', 'S', 'W', 'N', 'P', 'F', 'C', '?'
    ]
    idx1 = pai_order.index(pai1)
    idx2 = pai_order.index(pai2)
    if idx1 > idx2:
        return 1
    elif idx1 == idx2:
        return 0
    else:
        return -1
