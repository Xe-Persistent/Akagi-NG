import json
from dataclasses import dataclass

from mjai import Bot
from mjai.mlibriichi.state import ActionCandidate, PlayerState  # type: ignore

from .logger import logger


class AkagiBot(Bot):
    """
    This bot is used for tracking the game states, overwriting some of the
    mjai.Bot methods to be compatible with the Akagi application.
    """

    def __init__(self):
        super().__init__()
        self.is_3p = False

    def think(self) -> str:
        """
        tsumogiri
        """
        if self.can_discard:
            tile_str = self.last_self_tsumo
            return self.action_discard(tile_str)
        else:
            return self.action_nothing()

    def react(self, input_str: str = None, input_list: list[dict] = None) -> str:
        try:
            if input_str:
                events = json.loads(input_str)
            elif input_list:
                events = input_list
            else:
                raise ValueError("Empty input")
            if len(events) == 0:
                raise ValueError("Empty events")
            for event in events:
                if event["type"] == "start_game":
                    self.player_id = event["id"]
                    self.player_state = PlayerState(self.player_id)
                    self.is_3p = False
                    self.__discard_events = []
                    self.__call_events = []
                    self.__dora_indicators = []
                if event["type"] == "start_kyoku":
                    if (
                            event["scores"][0] == 35000 and
                            event["scores"][1] == 35000 and
                            event["scores"][2] == 35000 and
                            event["scores"][3] == 0
                    ):
                        self.is_3p = True
                if event["type"] == "start_kyoku" or event["type"] == "dora":
                    self.__dora_indicators.append(event["dora_marker"])
                if event["type"] == "dahai":
                    self.__discard_events.append(event)
                if event["type"] in [
                    "chi",
                    "pon",
                    "daiminkan",
                    "kakan",
                    "ankan",
                ]:
                    self.__call_events.append(event)
                # This is a patch for Three-Player-Mahjong, since the
                # smly/mjai library does not support 3P Mahjong.
                if event["type"] == "nukidora":
                    logger.debug(f"Event: {event}")
                    replace_event = {
                        "type": "dahai",
                        "actor": event["actor"],
                        "pai": "N",
                        "tsumogiri": self.last_self_tsumo == "N" and event["actor"] == self.player_id,
                    }
                    self.__discard_events.append(replace_event)
                    self.action_candidate = self.player_state.update(
                        json.dumps(replace_event)
                    )
                    continue

                logger.debug(f"Event: {event}")
                self.action_candidate = self.player_state.update(
                    json.dumps(event)
                )

            # NOTE: Skip `think()` if the player's riichi is accepted and
            # no call actions are allowed.
            if (
                    self.self_riichi_accepted
                    and not (self.can_agari or self.can_kakan or self.can_ankan)
                    and self.can_discard
            ):
                return self.action_discard(self.last_self_tsumo)

            resp = self.think()
            return resp

        except Exception as e:
            logger.error(f"Exception: {str(e)}")
            logger.error("Brief info:")
            logger.error(self.brief_info())

        return json.dumps({"type": "none"}, separators=(",", ":"))

    # ============================================= #
    #                Custom Methods                 #
    # ============================================= #
    @dataclass
    class ChiCandidates:
        chi_low_meld: tuple[str, tuple[str, str]] = None
        chi_mid_meld: tuple[str, tuple[str, str]] = None
        chi_high_meld: tuple[str, tuple[str, str]] = None

    def find_chi_candidates_simple(self) -> ChiCandidates:
        """

        Examples:
            >>> bot.find_chi_candidates_simple()
        """
        chi_candidates: AkagiBot.ChiCandidates = AkagiBot.ChiCandidates()

        color = self.last_kawa_tile[1]
        chi_num = int(self.last_kawa_tile[0])
        if (
                self.can_chi_high
                and f"{chi_num - 2}{color}r" in self.tehai_mjai
                and f"{chi_num - 1}{color}" in self.tehai_mjai
        ):
            consumed = (f"{chi_num - 2}{color}r", f"{chi_num - 1}{color}")
            chi_candidates.chi_high_meld = (
                self.last_kawa_tile,
                consumed,
            )
        if (
                self.can_chi_high
                and f"{chi_num - 2}{color}" in self.tehai_mjai
                and f"{chi_num - 1}{color}r" in self.tehai_mjai
        ):
            consumed = (f"{chi_num - 2}{color}", f"{chi_num - 1}{color}r")
            chi_candidates.chi_high_meld = (
                self.last_kawa_tile,
                consumed,
            )
        if (
                self.can_chi_high
                and f"{chi_num - 2}{color}" in self.tehai_mjai
                and f"{chi_num - 1}{color}" in self.tehai_mjai
        ):
            consumed = (f"{chi_num - 2}{color}", f"{chi_num - 1}{color}")
            chi_candidates.chi_high_meld = (
                self.last_kawa_tile,
                consumed,
            )
        if (
                self.can_chi_mid
                and f"{chi_num - 1}{color}r" in self.tehai_mjai
                and f"{chi_num + 1}{color}" in self.tehai_mjai
        ):
            consumed = (f"{chi_num - 1}{color}r", f"{chi_num + 1}{color}")
            chi_candidates.chi_mid_meld = (
                self.last_kawa_tile,
                consumed,
            )
        if (
                self.can_chi_mid
                and f"{chi_num - 1}{color}" in self.tehai_mjai
                and f"{chi_num + 1}{color}r" in self.tehai_mjai
        ):
            consumed = (f"{chi_num - 1}{color}", f"{chi_num + 1}{color}r")
            chi_candidates.chi_mid_meld = (
                self.last_kawa_tile,
                consumed,
            )
        if (
                self.can_chi_mid
                and f"{chi_num - 1}{color}" in self.tehai_mjai
                and f"{chi_num + 1}{color}" in self.tehai_mjai
        ):
            consumed = (f"{chi_num - 1}{color}", f"{chi_num + 1}{color}")
            chi_candidates.chi_mid_meld = (
                self.last_kawa_tile,
                consumed,
            )
        if (
                self.can_chi_low
                and f"{chi_num + 1}{color}r" in self.tehai_mjai
                and f"{chi_num + 2}{color}" in self.tehai_mjai
        ):
            consumed = (f"{chi_num + 1}{color}r", f"{chi_num + 2}{color}")
            chi_candidates.chi_low_meld = (
                self.last_kawa_tile,
                consumed,
            )
        if (
                self.can_chi_low
                and f"{chi_num + 1}{color}" in self.tehai_mjai
                and f"{chi_num + 2}{color}r" in self.tehai_mjai
        ):
            consumed = (f"{chi_num + 1}{color}", f"{chi_num + 2}{color}r")
            chi_candidates.chi_low_meld = (
                self.last_kawa_tile,
                consumed,
            )
        if (
                self.can_chi_low
                and f"{chi_num + 1}{color}" in self.tehai_mjai
                and f"{chi_num + 2}{color}" in self.tehai_mjai
        ):
            consumed = (f"{chi_num + 1}{color}", f"{chi_num + 2}{color}")
            chi_candidates.chi_low_meld = (
                self.last_kawa_tile,
                consumed,
            )

        return chi_candidates

    def find_chi_consume_simple(self) -> list[list[str]]:
        """

        Examples:
            >>> bot.find_chi_consume_simple()

        """
        chi_candidates = []

        color = self.last_kawa_tile[1]
        chi_num = int(self.last_kawa_tile[0])
        tehai_mjai = self.tehai_mjai
        if (
                self.can_chi_high
                and f"{chi_num - 2}{color}r" in tehai_mjai
                and f"{chi_num - 1}{color}" in tehai_mjai
        ):
            consumed = [f"{chi_num - 2}{color}r", f"{chi_num - 1}{color}"]
            chi_candidates.append(consumed)
        if (
                self.can_chi_high
                and f"{chi_num - 2}{color}" in tehai_mjai
                and f"{chi_num - 1}{color}r" in tehai_mjai
        ):
            consumed = [f"{chi_num - 2}{color}", f"{chi_num - 1}{color}r"]
            chi_candidates.append(consumed)
        if (
                self.can_chi_high
                and f"{chi_num - 2}{color}" in tehai_mjai
                and f"{chi_num - 1}{color}" in tehai_mjai
        ):
            consumed = [f"{chi_num - 2}{color}", f"{chi_num - 1}{color}"]
            chi_candidates.append(consumed)
        if (
                self.can_chi_mid
                and f"{chi_num - 1}{color}r" in tehai_mjai
                and f"{chi_num + 1}{color}" in tehai_mjai
        ):
            consumed = [f"{chi_num - 1}{color}r", f"{chi_num + 1}{color}"]
            chi_candidates.append(consumed)
        if (
                self.can_chi_mid
                and f"{chi_num - 1}{color}" in tehai_mjai
                and f"{chi_num + 1}{color}r" in tehai_mjai
        ):
            consumed = [f"{chi_num - 1}{color}", f"{chi_num + 1}{color}r"]
            chi_candidates.append(consumed)
        if (
                self.can_chi_mid
                and f"{chi_num - 1}{color}" in tehai_mjai
                and f"{chi_num + 1}{color}" in tehai_mjai
        ):
            consumed = [f"{chi_num - 1}{color}", f"{chi_num + 1}{color}"]
            chi_candidates.append(consumed)
        if (
                self.can_chi_low
                and f"{chi_num + 1}{color}r" in tehai_mjai
                and f"{chi_num + 2}{color}" in tehai_mjai
        ):
            consumed = [f"{chi_num + 1}{color}r", f"{chi_num + 2}{color}"]
            chi_candidates.append(consumed)
        if (
                self.can_chi_low
                and f"{chi_num + 1}{color}" in tehai_mjai
                and f"{chi_num + 2}{color}r" in tehai_mjai
        ):
            consumed = [f"{chi_num + 1}{color}", f"{chi_num + 2}{color}r"]
            chi_candidates.append(consumed)
        if (
                self.can_chi_low
                and f"{chi_num + 1}{color}" in tehai_mjai
                and f"{chi_num + 2}{color}" in tehai_mjai
        ):
            consumed = [f"{chi_num + 1}{color}", f"{chi_num + 2}{color}"]
            chi_candidates.append(consumed)

        return chi_candidates

    def find_pon_consume_simple(self) -> list[list[str]]:
        """
        Example:
            >>> bot.find_pon_consume_simple()
            [
                ["5m", "5m"],
                ["5mr", "5m"],
            ]
        """
        pon_candidates = []
        if self.last_kawa_tile[0] == "5" and self.last_kawa_tile[1] != "z":
            if self.tehai_mjai.count(self.last_kawa_tile[:2]) >= 2:
                consumed = [self.last_kawa_tile[:2], self.last_kawa_tile[:2]]
                pon_candidates.append(consumed)
            if (
                    self.tehai_mjai.count(self.last_kawa_tile[:2]) >= 1 and
                    self.tehai_mjai.count(self.last_kawa_tile[:2] + "r") == 1
            ):
                consumed = [
                    self.last_kawa_tile[:2] + "r",
                    self.last_kawa_tile[:2],
                ]
                pon_candidates.append(consumed)
            return pon_candidates
        else:
            consumed = [
                self.last_kawa_tile,
                self.last_kawa_tile,
            ]
            pon_candidates.append(consumed)
        return pon_candidates

    @property
    def can_act_3p(self) -> bool:
        """
        Check if the bot can act in 3-player mode.
        """
        return (
                self.can_discard or
                self.can_riichi or
                self.can_pon or
                self.can_agari or
                self.can_ryukyoku or
                self.can_kan
            # self.tehai_vec34[9*3+3] > 0 # nukidora
        )
