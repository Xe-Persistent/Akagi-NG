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
                # ========== Online Server =========== #
                if self.engine and self.engine.is_online:
                    raw_data = {"type": "none", "meta": {"online": self.engine.is_online}}
                    return_action = json.dumps(raw_data, separators=(",", ":"))
                else:
                    return_action = json.dumps({"type": "none"}, separators=(",", ":"))
                # ==================================== #
                return return_action
            else:
                # ========== Online Server =========== #
                raw_data = json.loads(return_action)
                meta = raw_data.get("meta", {})
                if self.engine and self.engine.is_online:
                    meta["online"] = self.engine.is_online

                if is_riichi_relevant(self.engine, self.player_id, e, is_3p=False):
                    meta.update(self.engine.last_inference_result)

                    # Check if we should recommend Riichi Discard (Lookahead)
                    # If 'reach' is the top action, simulate it to find the best discard.
                    # Check if we should recommend Riichi Discard (Lookahead)
                    # Use helper to get sorted recommendations safely
                    from akagi_ng.mjai_bot.utils import meta_to_recommend

                    recommendations = meta_to_recommend(meta, is_3p=False)

                    is_reach_candidate = False
                    top_5_actions = [rec[0] for rec in recommendations[:5]]
                    logger.info(f"Riichi Lookahead: Top 5 actions (helper): {top_5_actions}")

                    if "reach" in top_5_actions:
                        is_reach_candidate = True

                    if is_reach_candidate:
                        logger.info("Riichi Lookahead: Reach is in Top 5 recommendations. Starting simulation.")
                        # Perform Lookahead
                        try:
                            from akagi_ng.core.lib_loader import libriichi

                            # Create simulation bot
                            sim_bot = libriichi.mjai.Bot(self.engine, self.player_id)

                            # Replay history
                            logger.info(f"Riichi Lookahead: Replaying {len(self.history)} events.")
                            for h_event in self.history:
                                sim_bot.react(json.dumps(h_event, separators=(",", ":")))

                            # Apply Reach
                            reach_event = {"type": "reach", "actor": self.player_id}
                            logger.info("Riichi Lookahead: Applying generic REACH event.")
                            sim_resp = sim_bot.react(json.dumps(reach_event, separators=(",", ":")))

                            # Extract the simulation metadata from the RESPONSE
                            sim_data = json.loads(sim_resp)
                            sim_meta = sim_data.get("meta", {})

                            # Store simulation result in a special field
                            meta["riichi_lookahead"] = sim_meta

                            # Log success
                            sim_recs = meta_to_recommend(sim_meta, is_3p=False)
                            best_sim_action = sim_recs[0][0] if sim_recs else "none"
                            logger.info(f"Riichi Lookahead: Success. Best sim action: {best_sim_action}")

                        except Exception as lookahead_err:
                            logger.error(f"Riichi Lookahead failed: {lookahead_err}")
                            import traceback

                            logger.error(traceback.format_exc())

                if meta:
                    raw_data["meta"] = meta

                return_action = json.dumps(raw_data, separators=(",", ":"))
                return return_action

        except Exception as e:
            logger.error(f"MortalBot error: {e}")
            import traceback

            logger.error(traceback.format_exc())
            return json.dumps({"type": "none"}, separators=(",", ":"))
