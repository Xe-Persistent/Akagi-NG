import json

from akagi_ng.mjai_bot.mortal import model
from akagi_ng.mjai_bot.mortal.logger import logger
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

        try:
            return_action = None
            for e in events:
                if e["type"] == "start_game":
                    self.player_id = e["id"]
                    self.model, self.engine = model.load_model(self.player_id)
                    self.history = []  # Reset history on start game
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

                if is_riichi_relevant(self.engine, self.player_id, e, is_3p=False):
                    meta.update(self.engine.last_inference_result)

                    # Check if we should recommend Riichi Discard (Lookahead)
                    from akagi_ng.mjai_bot.utils import meta_to_recommend

                    recommendations = meta_to_recommend(meta, is_3p=False)

                    is_reach_candidate = False
                    top_5_actions = [rec[0] for rec in recommendations[:5]]
                    logger.info(f"Riichi Lookahead: Top 5 actions (helper): {top_5_actions}")

                    if "reach" in top_5_actions:
                        is_reach_candidate = True

                    if is_reach_candidate:
                        logger.info("Riichi Lookahead: Reach is in Top 5 recommendations. Starting simulation.")
                        lookahead_meta = self._run_riichi_lookahead()
                        if lookahead_meta:
                            meta["riichi_lookahead"] = lookahead_meta

                if meta:
                    raw_data["meta"] = meta

                return_action = json.dumps(raw_data, separators=(",", ":"))
                return return_action

        except Exception as e:
            logger.error(f"MortalBot error: {e}")
            import traceback

            logger.error(traceback.format_exc())
            return json.dumps({"type": "none"}, separators=(",", ":"))

    def _run_riichi_lookahead(self):
        """
        Runs Riichi Lookahead simulation using ReplayEngine.
        Returns simulation metadata or None if failed.
        """
        try:
            from akagi_ng.core.lib_loader import libriichi
            from akagi_ng.mjai_bot.engine.replay import ReplayEngine

            # Use ReplayEngine for ALL engines (Online & Local)
            sim_engine = ReplayEngine(self.engine, [None] * len(self.history))
            logger.debug("Riichi Lookahead: Using ReplayEngine for simulation.")

            # Create simulation bot with the appropriate engine
            sim_bot = libriichi.mjai.Bot(sim_engine, self.player_id)

            # Replay history
            logger.debug(f"Riichi Lookahead: Replaying {len(self.history)} events.")
            for h_event in self.history:
                sim_bot.react(json.dumps(h_event, separators=(",", ":")))

            # Stop replay mode to let the real engine handle the Lookahead
            sim_engine.stop_replaying()

            # Apply Reach
            reach_event = {"type": "reach", "actor": self.player_id}
            logger.debug("Riichi Lookahead: Applying generic REACH event.")
            sim_resp = sim_bot.react(json.dumps(reach_event, separators=(",", ":")))

            # Extract the simulation metadata from the RESPONSE
            sim_data = json.loads(sim_resp)
            sim_meta = sim_data.get("meta", {})

            # Log success
            from akagi_ng.mjai_bot.utils import meta_to_recommend

            sim_recs = meta_to_recommend(sim_meta, is_3p=False)
            best_sim_action = sim_recs[0][0] if sim_recs else "none"
            logger.info(f"Riichi Lookahead: Success. Best sim action: {best_sim_action}")

            return sim_meta

        except Exception as lookahead_err:
            logger.error(f"Riichi Lookahead failed: {lookahead_err}")
            import traceback

            logger.error(traceback.format_exc())
            return None
