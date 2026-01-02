import torch

from core.lib_loader import libriichi

consts = libriichi.consts

from core.context import get_models_dir, ensure_dir
from mjai_bot.controller import Bot
from mjai_bot.model import Brain, DQN, MortalEngine


def load_model(seat: int) -> tuple[Bot, MortalEngine]:
    # check if GPU is available
    if torch.cuda.is_available():
        device = torch.device('cuda')
    else:
        device = torch.device('cpu')

    # Path to models file
    control_state_file = ensure_dir(get_models_dir()) / "mortal_4p.pth"

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
        enable_amp=False,
        enable_quick_eval=False,
        enable_rule_based_agari_guard=True,
        name='mortal',
        is_3p=False
    )

    # Note: We need to wrap engine with libriichi.mjai.Bot logic
    # But BaseBot expects something that has a react method. 
    # The original code returned `libriichi.mjai.Bot(engine, seat)`

    bot = libriichi.mjai.Bot(engine, seat)
    return bot, engine
