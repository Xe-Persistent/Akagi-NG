import torch

from akagi_ng.core.context import get_models_dir
from akagi_ng.core.lib_loader import libriichi3p
from akagi_ng.mjai_bot.controller import Bot
from akagi_ng.mjai_bot.model import DQN, Brain, MortalEngine, get_inference_device

consts = libriichi3p.consts


def load_model(seat: int) -> tuple[Bot, MortalEngine]:
    # Path to models file
    control_state_file = get_models_dir() / "mortal3p.pth"

    if not control_state_file.exists():
        raise FileNotFoundError(f"Model file not found at {control_state_file}")

    state = torch.load(control_state_file, map_location=get_inference_device())

    mortal = Brain(
        obs_shape_func=consts.obs_shape,
        oracle_obs_shape_func=consts.oracle_obs_shape,
        version=state["config"]["control"]["version"],
        conv_channels=state["config"]["resnet"]["conv_channels"],
        num_blocks=state["config"]["resnet"]["num_blocks"],
    ).eval()

    dqn = DQN(action_space=consts.ACTION_SPACE, version=state["config"]["control"]["version"]).eval()

    mortal.load_state_dict(state["mortal"])
    dqn.load_state_dict(state["current_dqn"])

    engine = MortalEngine(
        mortal,
        dqn,
        is_oracle=False,
        version=state["config"]["control"]["version"],
        name="mortal",
        is_3p=True,
    )

    bot = libriichi3p.mjai.Bot(engine, seat)
    return bot, engine
