import torch

from core.lib_loader import libriichi

consts = libriichi.consts

from core.context import get_models_dir
from mjai_bot.controller import Bot
from mjai_bot.model import Brain, DQN, MortalEngine
from settings import local_settings


def load_model(seat: int) -> tuple[Bot, MortalEngine]:
    # check if GPU is available
    # check if GPU is available
    if local_settings.model_config.device == "cuda" and torch.cuda.is_available():
        device = torch.device('cuda')
    elif local_settings.model_config.device == "cpu":
        device = torch.device('cpu')
    elif local_settings.model_config.device == "auto":
        if torch.cuda.is_available():
            device = torch.device('cuda')
        else:
            device = torch.device('cpu')
    else:
        # Fallback
        device = torch.device('cpu')

    # Path to models file
    control_state_file = get_models_dir() / "mortal.pth"

    if not control_state_file.exists():
        raise FileNotFoundError(f"Model file not found at {control_state_file}")

    state = torch.load(control_state_file, map_location=device)

    mortal = Brain(
        obs_shape_func=consts.obs_shape,
        oracle_obs_shape_func=consts.oracle_obs_shape,
        version=state['config']['control']['version'],
        conv_channels=state['config']['resnet']['conv_channels'],
        num_blocks=state['config']['resnet']['num_blocks']
    ).eval()

    dqn = DQN(
        action_space=consts.ACTION_SPACE,
        version=state['config']['control']['version']
    ).eval()
    
    mortal.load_state_dict(state['mortal'])
    dqn.load_state_dict(state['current_dqn'])

    engine = MortalEngine(
        mortal,
        dqn,
        is_oracle=False,
        version=state['config']['control']['version'],
        device=device,
        enable_amp=local_settings.model_config.enable_amp,
        enable_quick_eval=False,
        enable_rule_based_agari_guard=local_settings.model_config.rule_based_agari_guard,
        name='mortal',
        is_3p=False
    )

    # Note: We need to wrap engine with libriichi.mjai.Bot logic
    # But BaseBot expects something that has a react method. 
    # The original code returned `libriichi.mjai.Bot(engine, seat)`

    bot = libriichi.mjai.Bot(engine, seat)
    return bot, engine
