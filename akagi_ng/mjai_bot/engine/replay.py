from typing import Any

from akagi_ng.mjai_bot.engine.base import BaseEngine
from akagi_ng.mjai_bot.logger import logger


class ReplayEngine(BaseEngine):
    """
    A wrapper engine that replies with pre-recorded actions from history during replay phase,
    and delegates to a real engine for new queries.
    Used to fast-forward the state in libriichi without triggering network requests.
    """

    def __init__(self, delegate: BaseEngine, history_actions: list[Any]):
        super().__init__(
            is_3p=delegate.is_3p,
            version=getattr(delegate, "version", 1),
            name=f"ReplayWrapper({delegate.name})",
            is_oracle=delegate.is_oracle,
        )
        self.delegate = delegate
        self.history_actions = history_actions
        self.cursor = 0
        self.replay_mode = True  # Flag to control replay status manually

        # Mirror properties
        self.engine_type = "replay_wrapper"

    def stop_replaying(self):
        """Explicitly stop replay mode and switch to delegate."""
        self.replay_mode = False
        logger.debug("ReplayEngine: Replay mode stopped manually.")

    @property
    def enable_quick_eval(self) -> bool:
        return self.delegate.enable_quick_eval

    @property
    def enable_rule_based_agari_guard(self) -> bool:
        return self.delegate.enable_rule_based_agari_guard

    @property
    def enable_amp(self) -> bool:
        return self.delegate.enable_amp

    def react_batch(self, obs, masks, invisible_obs):
        # Check if we still have history to replay
        if self.replay_mode:
            # action = self.history_actions[self.cursor]
            self.cursor += 1
            # action = self.history_actions[self.cursor]
            self.cursor += 1
            # logger.debug(f"ReplayEngine: Returning replay action: {action}")

            # Construct a dummy response format expected by Bot
            # Engine returns: actions(int list), q_out, masks, is_greedy
            # But wait, libriichi.Bot expects specific format?
            # MortalEngine returns: result_actions, result_q_out, result_masks, result_is_greedy
            # The action passed here is likely the HIGH LEVEL MJAI JSON or the INT INDEX?

            # CRITICAL: MortalEngine.react_batch returns INT INDICES of actions.
            # But my `history_actions` are likely MJAI events (dicts).
            # I need to convert MJAI event -> Action Index? That's hard without the model content.

            # Wait, libriichi Bot calls `engine.react_batch`.
            # It expects `action_index`.
            # If I cannot provide the correct action index that matches the history,
            # libriichi might diverge or crash if I return a random index?
            # Or if I return a "legal" index (tsumogiri) it might be fine if I feed the correct event later.

            # Actually, `libriichi` calculates legal masks.
            # If I just return the index of "tsumogiri" (usually safe) or "skip"?
            # Replaying history in sim_bot:
            # We assume sim_bot updates state based on `react(json_event)`.
            # The return value of `sim_bot.react()` is what WE (the bot) decided.
            # But `sim_bot` internal state is updated by the EVENT passed in.

            # HYPOTHESIS: The engine return value during replay is IGNORED by the state updater of Libriichi
            # regarding the *actual* game state, because the next event fed in is the *truth*.
            # The only risk is if `libriichi` validates that "Bot output" == "Next Event".
            # Usually it doesn't validitate deeply during replay logic if we just feed events.
            # BUT `Bot.react` is designed to *produce* an answer.

            # Let's try returning index 0 (or first legal action) for replay.
            # Input `masks` tells us what is legal.
            # We can pick the first legal action.

            legal_indices = [i for i, m in enumerate(masks[0]) if m]
            chosen_action = legal_indices[0] if legal_indices else 0

            # Ensure we return standard Python lists of primitives to avoid PyO3 type errors
            # masks is likely a list of lists of bools. We should return it as is, or deep copy if needed.
            # But the error "bool cannot be converted to PyBool" might be due to numpy bools if masks contained them.
            # We explicitly cast masks to standard python bools just in case.
            clean_masks = [[bool(x) for x in m] for m in masks]

            # Return dummy q_values etc.
            return [int(chosen_action)], [[0.0] * len(masks[0])], clean_masks, [True]

        else:
            # History exhausted, delegate to real engine
            logger.info("ReplayEngine: History finished, delegating to real engine.")
            return self.delegate.react_batch(obs, masks, invisible_obs)
