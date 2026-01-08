import json

from akagi_ng.mjai_bot.mortal3p import model
from akagi_ng.mjai_bot.mortal3p.logger import logger
from akagi_ng.mjai_bot.utils import is_riichi_relevant


class Bot:
    def __init__(self):
        self.player_id: int = None
        self.model = None
        self.engine = None
        self.history = []

    def react(self, events: str) -> str:
        """
        One `start_game` event must be sent before any other events.
        Once the bot receives a `start_game` event, it will reinitialize itself and set the player_id.

        `start_game` event can be sent any time to reset the bot.
        `end_game` event can be sent to set model to None.

        :param events: JSON string of events
        :return: JSON string of action
        """
        try:
            events = json.loads(events)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse events: {events}, {e}")
            return json.dumps({"type": "none"}, separators=(",", ":"))

        return_action = None
        for e in events:
            if e["type"] == "start_game":
                self.player_id = e["id"]
                self.model, self.engine = model.load_model(self.player_id)
                self.history = []  # Reset history on start game
                self.game_start_event = e
                continue
            if self.model is None or self.player_id is None:
                logger.error("Model is not loaded yet")
                continue

            # Reset history on new round
            if e["type"] == "start_kyoku":
                self.history = []

            self.history.append(e)

            if e["type"] == "end_game":
                self.player_id = None
                self.model = None
                self.engine = None
                self.game_start_event = None
                continue

            return_action = self.model.react(json.dumps(e, separators=(",", ":")))

        if return_action is None:
            # Use engine's additional metadata (e.g. online status)
            meta = self.engine.get_additional_meta() if self.engine else {}
            raw_data = {"type": "none"}
            if meta:
                raw_data["meta"] = meta

            return_action = json.dumps(raw_data, separators=(",", ":"))
            return return_action
        else:
            raw_data = json.loads(return_action)
            meta = raw_data.get("meta", {})

            # Update with engine-specific metadata
            if self.engine:
                meta.update(self.engine.get_additional_meta())

            if is_riichi_relevant(self.engine, self.player_id, e, is_3p=True):
                meta.update(self.engine.last_inference_result)

                # Check if we should recommend Riichi Discard (Lookahead)
                from akagi_ng.mjai_bot.utils import meta_to_recommend

                recommendations = meta_to_recommend(meta, is_3p=True)

                is_reach_candidate = False
                top_5_actions = [rec[0] for rec in recommendations[:5]]
                logger.info(f"Riichi Lookahead (3p): Top 5 actions (helper): {top_5_actions}")

                if "reach" in top_5_actions:
                    is_reach_candidate = True

                if is_reach_candidate:
                    logger.info("Riichi Lookahead (3p): Reach is in Top 5 recommendations. Starting simulation.")
                    lookahead_meta = self._run_riichi_lookahead()
                    if lookahead_meta:
                        meta["riichi_lookahead"] = lookahead_meta

            if meta:
                # If only one action is legal (e.g. forced "none" on opponent turn in 3p),
                # we suppress the recommendation to avoid UI noise.
                mask_bits = meta.get("mask_bits")
                if mask_bits and mask_bits.bit_count() == 1:
                    logger.debug("Bot (3p): Suppressing metadata because only 1 legal action exists (forced move).")
                    if "meta" in raw_data:
                        del raw_data["meta"]
                else:
                    raw_data["meta"] = meta

            return_action = json.dumps(raw_data, separators=(",", ":"))
            # ==================================== #
            # raw_data = json.loads(return_action)
            # del raw_data["meta"]
            # return json.dumps(raw_data, separators=(",", ":"))
            return return_action

    def _run_riichi_lookahead(self):
        """
        Runs Riichi Lookahead simulation using ReplayEngine.
        Returns simulation metadata or None if failed.
        """
        try:
            from akagi_ng.core.lib_loader import libriichi3p
            from akagi_ng.mjai_bot.engine.replay import ReplayEngine

            # Use ReplayEngine for ALL engines (Online & Local)
            sim_engine = ReplayEngine(self.engine, [None] * len(self.history))
            logger.debug("Riichi Lookahead (3p): Using ReplayEngine for simulation.")

            # Create simulation bot
            sim_bot = libriichi3p.mjai.Bot(sim_engine, self.player_id)

            # Replay history
            logger.debug(f"Riichi Lookahead (3p): Replaying {len(self.history)} events.")

            # Replay game start to ensure 3p mode is initialized
            if self.game_start_event:
                sim_bot.react(json.dumps(self.game_start_event, separators=(",", ":")))

            for h_event in self.history:
                sim_bot.react(json.dumps(h_event, separators=(",", ":")))

            # Stop replay mode to let the real engine handle the Lookahead
            sim_engine.stop_replaying()

            # Apply Reach
            reach_event = {"type": "reach", "actor": self.player_id}
            logger.debug("Riichi Lookahead (3p): Applying generic REACH event.")
            sim_resp = sim_bot.react(json.dumps(reach_event, separators=(",", ":")))

            # Extract the simulation metadata from the RESPONSE
            sim_data = json.loads(sim_resp)
            sim_meta = sim_data.get("meta", {})

            # Log success
            from akagi_ng.mjai_bot.utils import meta_to_recommend

            sim_recs = meta_to_recommend(sim_meta, is_3p=True)
            best_sim_action = sim_recs[0][0] if sim_recs else "none"
            logger.info(f"Riichi Lookahead (3p): Success. Best sim action: {best_sim_action}")

            return sim_meta

        except Exception as lookahead_err:
            logger.error(f"Riichi Lookahead (3p) failed: {lookahead_err}")
            import traceback

            logger.error(traceback.format_exc())
            return None
