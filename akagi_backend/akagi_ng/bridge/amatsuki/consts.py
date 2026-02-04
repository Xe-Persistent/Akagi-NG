from enum import StrEnum


class AmatsukiTopic(StrEnum):
    JOIN_DESK_CALLBACK = "/user/topic/callback/joinDesk"
    ROUND_START_PREFIX = "/user/topic/desk/roundStart/"
    SYNC_DORA_PREFIX = "/topic/desk/syncDora/"
    DRAW_PREFIX = "/user/topic/desk/draw/"
    TEHAI_ACTION_PREFIX = "/topic/desk/tehaiAction/"
    RIVER_ACTION_PREFIX = "/topic/desk/riverAction/"
    RON_ACTION_PREFIX = "/topic/desk/ronAction/"
    RYUKYOKU_ACTION_PREFIX = "/topic/desk/ryuukyokuAction/"
    GAME_END_PREFIX = "/user/topic/desk/gameEnd/"


class AmatsukiAction(StrEnum):
    # Tehai Actions
    KIRI = "KIRI"
    ANKAN = "ANNKAN"
    KAKAN = "KAKAN"
    REACH = "REACH"
    WREACH = "WREACH"
    KITA = "KITA"

    # River Actions
    CHII = "CHII"
    PON = "PON"
    MINKAN = "MINKAN"


RED_FIVE_NUM = 5


def _generate_id_to_mjai_pai() -> list[str]:
    pais = []
    # Manzu, Pinzu, Souzu
    for suit in ["m", "p", "s"]:
        for i in range(1, 10):
            if i == RED_FIVE_NUM:
                # Red 5 is first
                pais.extend([f"5{suit}r", f"5{suit}", f"5{suit}", f"5{suit}"])
            else:
                pais.extend([f"{i}{suit}"] * 4)

    for honor in ["E", "S", "W", "N", "P", "F", "C"]:
        pais.extend([honor] * 4)

    return pais


ID_TO_MJAI_PAI: list[str] = _generate_id_to_mjai_pai()

BAKAZE_TO_MJAI_PAI: list[str] = ["E", "S", "W", "N"]
