//! Live inference engine: maintains a riichienv-core game state from mjai
//! events and, at our decision points, runs the CNN to pick a **legal** action.
//!
//! Transport-agnostic: it consumes `riichienv_core::replay::MjaiEvent` and
//! returns a schema-agnostic [`BotAction`] (mjai tile strings), which the
//! Akagi-side `NativeBot` maps to Akagi's own mjai event type. This keeps
//! `native_bot` free of any Akagi dependency.
//!
//! `decide()` is read-only with respect to game *state*: our own chosen action
//! is NOT applied here. In Akagi, every action (ours included) echoes back
//! through the mjai bus and is applied via [`Engine::feed`], so applying it in
//! `decide()` too would double-count.

use anyhow::Result;
use riichienv_core::action::{Action, ActionType};
use riichienv_core::parser::tid_to_mjai;
use riichienv_core::replay::MjaiEvent;
use riichienv_core::rule::GameRule;
use riichienv_core::state::GameState;
use riichienv_core::state_3p::GameState3P;

use crate::action_codec::rank_by_logits;
use crate::adapt::{obs_and_legal_3p, obs_and_legal_4p};
use crate::mjai_compat::{parse_line, sanitize_3p};
use crate::model::Model;

/// How many ranked candidates the engine surfaces for the HUD's multi-row
/// recommendation card (top-N by policy probability).
const SHOW_TOP_N: usize = 3;

/// How many riichi-discard candidates the lookahead surfaces. Mirrors the
/// candidate row the HUD renders under a `reach` recommendation.
const LOOKAHEAD_TOP_N: usize = 5;

/// A schema-agnostic bot reply, ready to be mapped to Akagi's `MjaiEvent`.
/// All tiles are mjai strings (e.g. `"5mr"`, `"P"`).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BotAction {
    Dahai {
        pai: String,
        tsumogiri: bool,
    },
    /// Riichi declaration; `pai` is the predicted riichi discard (mjai must
    /// carry it or autoplay stalls). Always non-empty on [`Decision::action`] —
    /// `decide` drops a riichi it can't name a discard for. Runner-up
    /// `candidates` rows carry an empty `pai`: they only decorate the HUD, and
    /// predicting a discard for each would run the model once per row.
    Reach {
        pai: String,
    },
    Pon {
        target: u8,
        pai: String,
        consumed: Vec<String>,
    },
    Chi {
        target: u8,
        pai: String,
        consumed: Vec<String>,
    },
    Daiminkan {
        target: u8,
        pai: String,
        consumed: Vec<String>,
    },
    Ankan {
        consumed: Vec<String>,
    },
    Kakan {
        pai: String,
        consumed: Vec<String>,
    },
    /// Ron or tsumo (both are mjai `hora`); `target` is the loser (self for
    /// tsumo, the discarder for ron).
    Hora {
        target: u8,
    },
    /// Nine-terminals abortive draw (mjai `ryukyoku`).
    Kyushu,
    /// Kita / nukidora (sanma).
    Kita,
    /// No action this turn.
    Pass,
}

/// Our seat's decision at a given point.
#[derive(serde::Serialize)]
pub struct Decision {
    pub action: BotAction,
    /// Top legal actions ranked by policy probability (best first). `action`
    /// is `candidates[0].0`; the rest are the runner-up recommendations the HUD
    /// shows as a top-N card. Probabilities are a softmax over the legal set.
    pub candidates: Vec<(BotAction, f32)>,
    /// Raw action logits (indexed by the mode's action space).
    pub logits: Vec<f32>,
    /// Riichi lookahead: the discards the model would pick right after
    /// declaring riichi, best first. Only filled when riichi is one of
    /// `candidates`, so the extra forward pass is never paid otherwise.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub riichi_lookahead: Vec<LookaheadCandidate>,
}

/// A tile the model would discard if it declared riichi right now.
#[derive(Debug, Clone, serde::Serialize)]
pub struct LookaheadCandidate {
    /// mjai tile string, e.g. `"5mr"`.
    pub pai: String,
    /// Policy probability of that discard, softmaxed over the riichi discards.
    pub prob: f32,
}

enum Backend {
    Four {
        state: Box<GameState>,
        model: Model,
    },
    Three {
        state: Box<GameState3P>,
        model: Model,
    },
}

pub struct Engine {
    backend: Backend,
    seat: u8,
    num_players: u8,
}

impl Engine {
    /// Construct for `num_players`, loading weights from a safetensors buffer.
    pub fn new(model_bytes: Vec<u8>, num_players: u8, seat: u8) -> Result<Self> {
        let rule = GameRule::default_tenhou();
        let model = Model::from_safetensors(model_bytes, num_players)?;
        let backend = if num_players == 3 {
            Backend::Three {
                state: Box::new(GameState3P::new(0, true, None, 0, rule)),
                model,
            }
        } else {
            Backend::Four {
                state: Box::new(GameState::new(0, true, None, 0, rule)),
                model,
            }
        };
        Ok(Self {
            backend,
            seat,
            num_players,
        })
    }

    /// Reset to a fresh game while keeping the loaded weights.
    pub fn reset(&mut self) {
        let rule = GameRule::default_tenhou();
        match &mut self.backend {
            Backend::Four { state, .. } => {
                *state = Box::new(GameState::new(0, true, None, 0, rule))
            }
            Backend::Three { state, .. } => {
                *state = Box::new(GameState3P::new(0, true, None, 0, rule))
            }
        }
    }

    pub fn seat(&self) -> u8 {
        self.seat
    }

    pub fn set_seat(&mut self, seat: u8) {
        self.seat = seat;
    }

    pub fn num_players(&self) -> u8 {
        self.num_players
    }

    /// Drive one already-parsed mjai event through the engine.
    ///
    /// Sanma events are sanitized first: Tenhou sanma logs carry 4-element
    /// `scores`/`tehais` arrays that a 3-seat `GameState3P` would index out of
    /// bounds on. Akagi's live bridge builds its events itself and never trips
    /// this, but the extractor's logs do.
    ///
    /// This can only fix what survives parsing. Raw JSONL needs
    /// [`Engine::feed_line`] (or [`crate::mjai_compat::parse_line`]): a sanma
    /// log's `nukidora` has to be renamed to `kita` *before* serde sees it, or
    /// it deserializes into `MjaiEvent::Other` and the event is lost.
    pub fn feed(&mut self, ev: MjaiEvent) {
        match &mut self.backend {
            Backend::Four { state, .. } => state.apply_mjai_event(ev),
            Backend::Three { state, .. } => {
                let mut ev = ev;
                sanitize_3p(&mut ev);
                state.apply_mjai_event(ev)
            }
        }
    }

    /// Drive one raw mjai JSONL line through the engine, applying both
    /// compatibility fixups. Returns `false` for a line the engine doesn't model
    /// (blank, malformed, or an event type riichienv has no variant for), which
    /// callers replaying a log simply skip.
    pub fn feed_line(&mut self, line: &str) -> bool {
        match parse_line(line, self.num_players) {
            Some(ev) => {
                self.feed(ev);
                true
            }
            None => false,
        }
    }

    /// Decide our action at the current state. `None` if we currently have no
    /// legal action (not our turn / nothing to respond to).
    pub fn decide(&mut self) -> Result<Option<Decision>> {
        let seat = self.seat;
        let (mut ranked, logits, last_discarder, drawn, reach_pai, reach_ranked) =
            match &mut self.backend {
                Backend::Four { state, model } => {
                    // `last_discard` is `(discarder_pid, tile)`.
                    let last_discarder = state.last_discard.map(|(pid, _tile)| pid);
                    let drawn = state.drawn_tile;
                    let (obs, legal) = obs_and_legal_4p(state, seat);
                    if legal.is_empty() {
                        return Ok(None);
                    }
                    let logits = model.forward_logits(&obs)?;
                    let ranked = rank_by_logits(&legal, &logits, 4, SHOW_TOP_N);
                    let Some((top, _)) = ranked.first() else {
                        return Ok(None);
                    };
                    let offers_reach = ranked
                        .iter()
                        .any(|(a, _)| a.action_type == ActionType::Riichi);
                    let reach_ranked = if offers_reach {
                        rank_reach_discards(state, model, seat, 4)
                    } else {
                        Vec::new()
                    };
                    let reach_pai = if top.action_type == ActionType::Riichi {
                        reach_ranked.first().map(|(tile, _)| *tile)
                    } else {
                        None
                    };
                    (
                        ranked,
                        logits,
                        last_discarder,
                        drawn,
                        reach_pai,
                        reach_ranked,
                    )
                }
                Backend::Three { state, model } => {
                    let last_discarder = state.last_discard.map(|(pid, _tile)| pid);
                    let drawn = state.drawn_tile;
                    let (obs, legal) = obs_and_legal_3p(state, seat);
                    if legal.is_empty() {
                        return Ok(None);
                    }
                    let logits = model.forward_logits(&obs)?;
                    let ranked = rank_by_logits(&legal, &logits, 3, SHOW_TOP_N);
                    let Some((top, _)) = ranked.first() else {
                        return Ok(None);
                    };
                    let offers_reach = ranked
                        .iter()
                        .any(|(a, _)| a.action_type == ActionType::Riichi);
                    let reach_ranked = if offers_reach {
                        rank_reach_discards_3p(state, model, seat)
                    } else {
                        Vec::new()
                    };
                    let reach_pai = if top.action_type == ActionType::Riichi {
                        reach_ranked.first().map(|(tile, _)| *tile)
                    } else {
                        None
                    };
                    (
                        ranked,
                        logits,
                        last_discarder,
                        drawn,
                        reach_pai,
                        reach_ranked,
                    )
                }
            };

        // An mjai `reach` must name the discard or autoplay stalls (Majsoul fuses
        // declaring and discarding into one click). If the riichi-discard
        // prediction failed, drop riichi from the ranking rather than emit a
        // reach we cannot complete — the next-best action is a plain discard.
        if reach_pai.is_none()
            && matches!(ranked.first(), Some((a, _)) if a.action_type == ActionType::Riichi)
        {
            ranked.retain(|(a, _)| a.action_type != ActionType::Riichi);
        }
        if ranked.is_empty() {
            return Ok(None);
        }

        let candidates = build_candidates(&ranked, seat, last_discarder, drawn, reach_pai);
        let action = candidates[0].0.clone();
        Ok(Some(Decision {
            action,
            candidates,
            logits,
            riichi_lookahead: reach_ranked
                .into_iter()
                .map(|(tile, prob)| LookaheadCandidate {
                    pai: tid_to_mjai(tile),
                    prob,
                })
                .collect(),
        }))
    }

    /// The tile the local model would discard if it declared riichi right now,
    /// as an mjai string. Used by the API-backed runner as a fallback for the
    /// reach two-step (declare → discard) when the remote follow-up call fails.
    /// `None` if there is no riichi-legal discard from the current state.
    pub fn reach_discard(&mut self) -> Option<String> {
        let seat = self.seat;
        match &mut self.backend {
            Backend::Four { state, model } => rank_reach_discards(state, model, seat, 4)
                .first()
                .map(|(tile, _)| tid_to_mjai(*tile)),
            Backend::Three { state, model } => rank_reach_discards_3p(state, model, seat)
                .first()
                .map(|(tile, _)| tid_to_mjai(*tile)),
        }
    }
}

/// Map a ranked `(Action, prob)` list into displayable `(BotAction, prob)`
/// candidates. The riichi-discard prediction is applied only to the top action
/// (index 0) — predicting it for every runner-up would run the model N extra
/// times for tiles that only decorate an alternative row.
fn build_candidates(
    ranked: &[(Action, f32)],
    seat: u8,
    last_discarder: Option<u8>,
    drawn: Option<u8>,
    reach_pai: Option<u8>,
) -> Vec<(BotAction, f32)> {
    ranked
        .iter()
        .enumerate()
        .map(|(i, (a, p))| {
            let rp = if i == 0 { reach_pai } else { None };
            (build_bot_action(a, seat, last_discarder, drawn, rp), *p)
        })
        .collect()
}

/// Rank the discards the model would pick **right after declaring riichi**, best
/// first. The reach is applied to a clone, so the live game state is untouched
/// and one forward pass is all this costs — the engine equivalent of Akagi-NG's
/// old LookaheadBot, which forked a bot and replayed the whole hand to get here.
fn rank_reach_discards(state: &GameState, model: &Model, seat: u8, np: u8) -> Vec<(u8, f32)> {
    let mut clone = state.clone();
    clone.apply_mjai_event(MjaiEvent::Reach {
        actor: seat as usize,
    });
    let (obs, legal) = obs_and_legal_4p(&mut clone, seat);
    if legal.is_empty() {
        return Vec::new();
    }
    match model.forward_logits(&obs) {
        Ok(logits) => lookahead_from_ranked(rank_all_legal(&legal, &logits, np)),
        Err(_) => Vec::new(),
    }
}

fn rank_reach_discards_3p(state: &GameState3P, model: &Model, seat: u8) -> Vec<(u8, f32)> {
    let mut clone = state.clone();
    clone.apply_mjai_event(MjaiEvent::Reach {
        actor: seat as usize,
    });
    let (obs, legal) = obs_and_legal_3p(&mut clone, seat);
    if legal.is_empty() {
        return Vec::new();
    }
    match model.forward_logits(&obs) {
        Ok(logits) => lookahead_from_ranked(rank_all_legal(&legal, &logits, 3)),
        Err(_) => Vec::new(),
    }
}

/// Every legal action of the post-reach state, ranked by policy probability.
fn rank_all_legal(legal: &[Action], logits: &[f32], num_players: u8) -> Vec<(Action, f32)> {
    rank_by_logits(legal, logits, num_players, legal.len())
}

/// Keep the actual discards, best first: a riichi turn can also offer a pass or
/// a call in principle, and those are not tiles the HUD can render.
fn lookahead_from_ranked(ranked: Vec<(Action, f32)>) -> Vec<(u8, f32)> {
    ranked
        .into_iter()
        .filter_map(|(a, prob)| match a.action_type {
            ActionType::Discard => a.tile.map(|tile| (tile, prob)),
            _ => None,
        })
        .take(LOOKAHEAD_TOP_N)
        .collect()
}

/// Turn a riichienv `Action` (plus the little bit of table context the reply
/// needs) into a [`BotAction`].
///
/// `last_discarder` is a **seat id**, taken from `GameState::last_discard.0`.
/// It becomes the `target` of every claim (pon/chi/daiminkan) and of a ron —
/// mjai consumers use it to identify the losing seat, so feeding a tile id here
/// produces an out-of-range seat.
fn build_bot_action(
    a: &Action,
    seat: u8,
    last_discarder: Option<u8>,
    drawn: Option<u8>,
    reach_pai: Option<u8>,
) -> BotAction {
    let consumed = |a: &Action| a.consume_tiles.iter().map(|&t| tid_to_mjai(t)).collect();
    let target = last_discarder.unwrap_or(0);
    match a.action_type {
        ActionType::Discard => match a.tile {
            Some(t) => BotAction::Dahai {
                pai: tid_to_mjai(t),
                tsumogiri: drawn == Some(t),
            },
            None => BotAction::Pass,
        },
        ActionType::Riichi => BotAction::Reach {
            pai: reach_pai.map(tid_to_mjai).unwrap_or_default(),
        },
        ActionType::Pon => BotAction::Pon {
            target,
            pai: a.tile.map(tid_to_mjai).unwrap_or_default(),
            consumed: consumed(a),
        },
        ActionType::Chi => BotAction::Chi {
            target,
            pai: a.tile.map(tid_to_mjai).unwrap_or_default(),
            consumed: consumed(a),
        },
        ActionType::Daiminkan => BotAction::Daiminkan {
            target,
            pai: a.tile.map(tid_to_mjai).unwrap_or_default(),
            consumed: consumed(a),
        },
        ActionType::Ankan => BotAction::Ankan {
            consumed: consumed(a),
        },
        ActionType::Kakan => BotAction::Kakan {
            pai: a.tile.map(tid_to_mjai).unwrap_or_default(),
            consumed: consumed(a),
        },
        ActionType::Tsumo => BotAction::Hora { target: seat },
        ActionType::Ron => BotAction::Hora {
            target: last_discarder.unwrap_or(seat),
        },
        ActionType::KyushuKyuhai => BotAction::Kyushu,
        ActionType::Kita => BotAction::Kita,
        ActionType::Pass => BotAction::Pass,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use riichienv_core::replay::MjaiEvent;

    fn ev(line: &str) -> MjaiEvent {
        serde_json::from_str(line).expect("valid mjai event")
    }

    fn act(kind: ActionType, tile: Option<u8>, consumed: Vec<u8>) -> Action {
        Action::new(kind, tile, consumed, Some(0))
    }

    // ---------- `build_bot_action` field mapping (pure) ----------

    /// Every claim and a ron carry the **discarder's seat** as `target`.
    #[test]
    fn claims_and_ron_target_the_discarder_seat() {
        let discarder = Some(3u8);
        let seat = 0u8;

        let pon = build_bot_action(
            &act(ActionType::Pon, Some(4), vec![5, 6]),
            seat,
            discarder,
            None,
            None,
        );
        assert_eq!(
            pon,
            BotAction::Pon {
                target: 3,
                pai: "2m".into(),
                consumed: vec!["2m".into(), "2m".into()],
            }
        );

        let chi = build_bot_action(
            &act(ActionType::Chi, Some(4), vec![8, 12]),
            seat,
            discarder,
            None,
            None,
        );
        assert!(matches!(chi, BotAction::Chi { target: 3, .. }));

        let kan = build_bot_action(
            &act(ActionType::Daiminkan, Some(4), vec![5, 6, 7]),
            seat,
            discarder,
            None,
            None,
        );
        assert!(matches!(kan, BotAction::Daiminkan { target: 3, .. }));

        let ron = build_bot_action(
            &act(ActionType::Ron, None, vec![]),
            seat,
            discarder,
            None,
            None,
        );
        assert_eq!(ron, BotAction::Hora { target: 3 });
    }

    /// A tsumo is a self-target hora; a ron with no recorded discarder degrades
    /// to self rather than an out-of-range seat.
    #[test]
    fn tsumo_targets_self() {
        let seat = 2u8;
        let tsumo = build_bot_action(
            &act(ActionType::Tsumo, None, vec![]),
            seat,
            Some(1),
            None,
            None,
        );
        assert_eq!(tsumo, BotAction::Hora { target: seat });

        let ron_no_discarder =
            build_bot_action(&act(ActionType::Ron, None, vec![]), seat, None, None, None);
        assert_eq!(ron_no_discarder, BotAction::Hora { target: seat });
    }

    #[test]
    fn discard_marks_tsumogiri_only_for_the_drawn_tile() {
        let drawn = Some(88u8); // 5sr
        let a = act(ActionType::Discard, Some(88), vec![]);
        assert_eq!(
            build_bot_action(&a, 0, None, drawn, None),
            BotAction::Dahai {
                pai: "5sr".into(),
                tsumogiri: true
            }
        );
        let a = act(ActionType::Discard, Some(0), vec![]);
        assert_eq!(
            build_bot_action(&a, 0, None, drawn, None),
            BotAction::Dahai {
                pai: "1m".into(),
                tsumogiri: false
            }
        );
    }

    #[test]
    fn closed_calls_and_terminals_map_without_a_target() {
        assert_eq!(
            build_bot_action(
                &act(ActionType::Ankan, None, vec![0, 1, 2, 3]),
                0,
                Some(2),
                None,
                None
            ),
            BotAction::Ankan {
                consumed: vec!["1m".into(), "1m".into(), "1m".into(), "1m".into()],
            }
        );
        assert!(matches!(
            build_bot_action(
                &act(ActionType::Kakan, Some(0), vec![1]),
                0,
                Some(2),
                None,
                None
            ),
            BotAction::Kakan { .. }
        ));
        assert_eq!(
            build_bot_action(
                &act(ActionType::KyushuKyuhai, None, vec![]),
                0,
                None,
                None,
                None
            ),
            BotAction::Kyushu
        );
        assert_eq!(
            build_bot_action(&act(ActionType::Kita, None, vec![]), 0, None, None, None),
            BotAction::Kita
        );
        assert_eq!(
            build_bot_action(&act(ActionType::Pass, None, vec![]), 0, None, None, None),
            BotAction::Pass
        );
    }

    #[test]
    fn riichi_carries_the_predicted_discard() {
        let a = act(ActionType::Riichi, None, vec![]);
        assert_eq!(
            build_bot_action(&a, 0, None, None, Some(36)),
            BotAction::Reach { pai: "1p".into() }
        );
    }

    // ---------- end-to-end: the seat/tile confusion `decide()` used to have ----------

    /// Regression: `GameState::last_discard` is `(discarder_pid, tile)`, but
    /// `decide()` destructured it as `(_, pid)` and handed the **tile id** to
    /// `build_bot_action` as the discarder's seat. Every pon/chi/kan/ron reply
    /// then carried a `target` of 0..=135 instead of a seat number, which lands
    /// straight on Akagi's mjai bus.
    #[test]
    fn claim_target_is_a_seat_not_a_tile_id() {
        // Our seat holds two 9s (tile ids 104..107), so seat 1's 9s discard opens
        // a pon window. 9s is tile34 26 — a tile id far outside the seat range,
        // so a regressed `target` can never coincide with the right answer.
        let ours = r#"["9s","9s","1m","2m","3m","4m","5m","6m","7m","8m","9m","1p","2p"]"#;
        let other = r#"["1m","2m","3m","4m","5m","6m","7m","8m","9m","1p","2p","3p","4p"]"#;
        let mut eng = crate::defaults::engine(4, 0).expect("bundled 4p weights");
        eng.feed(ev(r#"{"type":"start_game","names":["a","b","c","d"]}"#));
        eng.feed(ev(&format!(
            r#"{{"type":"start_kyoku","bakaze":"E","dora_marker":"2m","kyoku":1,"honba":0,
                 "kyotaku":0,"oya":0,"scores":[25000,25000,25000,25000],
                 "tehais":[{ours},{other},{other},{other}]}}"#
        )));
        eng.feed(ev(r#"{"type":"tsumo","actor":1,"pai":"9s"}"#));
        eng.feed(ev(
            r#"{"type":"dahai","actor":1,"pai":"9s","tsumogiri":true}"#,
        ));

        let d = eng
            .decide()
            .expect("forward pass")
            .expect("a pon window is a decision point");

        let mut saw_pon = false;
        for (a, _) in &d.candidates {
            let (action, target) = match a {
                BotAction::Pon { target, .. } => ("pon", *target),
                BotAction::Chi { target, .. } => ("chi", *target),
                BotAction::Daiminkan { target, .. } => ("daiminkan", *target),
                BotAction::Hora { target } => ("hora", *target),
                _ => continue,
            };
            assert_eq!(
                target, 1,
                "{action} target must be the discarder's seat, got {target}"
            );
            saw_pon |= action == "pon";
        }
        assert!(
            saw_pon,
            "fixture invalid: no pon offered on the 9s discard ({:?})",
            d.candidates.iter().map(|(a, _)| a).collect::<Vec<_>>()
        );
    }

    /// Regression: `feed_line` must apply the pre-parse `nukidora`→`kita` rename.
    /// Parsed straight through serde, a Tenhou sanma nukidora becomes
    /// `MjaiEvent::Other` and is dropped — the engine's kita counts would drift
    /// silently away from the real table.
    #[test]
    fn feed_line_applies_the_nukidora_rename() {
        let h = r#"["1m","9m","1p","2p","3p","4p","5p","6p","7p","8p","9p","N","N"]"#;
        let mut eng = crate::defaults::engine(3, 0).expect("bundled 3p weights");
        assert!(eng.feed_line(r#"{"type":"start_game","names":["a","b","c",""]}"#));
        assert!(eng.feed_line(&format!(
            r#"{{"type":"start_kyoku","bakaze":"E","dora_marker":"1s","kyoku":1,"honba":0,
                 "kyotaku":0,"oya":0,"scores":[35000,35000,35000,0],
                 "tehais":[{h},{h},{h},{h}]}}"#
        )));
        assert!(eng.feed_line(r#"{"type":"tsumo","actor":0,"pai":"9p"}"#));
        assert!(
            eng.feed_line(r#"{"type":"nukidora","actor":0}"#),
            "a nukidora must reach the engine, not be skipped as an unknown type"
        );

        // Unmodelled / blank / malformed lines are skipped, not applied.
        assert!(!eng.feed_line(""));
        assert!(!eng.feed_line("{oops"));
        assert!(!eng.feed_line(r#"{"type":"some_future_event"}"#));
    }

    /// A sanma engine must survive a Tenhou-style 4-seat `start_kyoku` (the
    /// extractor sanitizes these; `feed` used to pass them straight through to a
    /// 3-seat state, which indexes out of bounds).
    #[test]
    fn feed_sanitizes_four_seat_sanma_start_kyoku() {
        let h = r#"["1m","9m","1p","2p","3p","4p","5p","6p","7p","8p","9p","1s","2s"]"#;
        let mut eng = crate::defaults::engine(3, 0).expect("bundled 3p weights");
        eng.feed(ev(r#"{"type":"start_game","names":["a","b","c","d"]}"#));
        eng.feed(ev(&format!(
            r#"{{"type":"start_kyoku","bakaze":"E","dora_marker":"1s","kyoku":1,"honba":0,
                 "kyotaku":0,"oya":0,"scores":[35000,35000,35000,0],
                 "tehais":[{h},{h},{h},{h}]}}"#
        )));
        eng.feed(ev(r#"{"type":"tsumo","actor":0,"pai":"9p"}"#));
        let d = eng.decide().expect("forward pass");
        assert!(d.is_some(), "our own draw is a decision point");
    }

    // ---------- riichi lookahead ----------

    /// The lookahead row only ever holds discards, in rank order, capped at
    /// `LOOKAHEAD_TOP_N`: the HUD renders tiles, never passes or calls.
    #[test]
    fn lookahead_keeps_the_best_discards() {
        let ranked = vec![
            (act(ActionType::Discard, Some(4), vec![]), 0.30),
            (act(ActionType::Pass, None, vec![]), 0.20),
            (act(ActionType::Discard, Some(8), vec![]), 0.15),
            (act(ActionType::Ankan, None, vec![0, 1, 2, 3]), 0.10),
            (act(ActionType::Discard, Some(12), vec![]), 0.08),
        ];
        assert_eq!(
            lookahead_from_ranked(ranked),
            vec![(4, 0.30), (8, 0.15), (12, 0.08)]
        );

        let many: Vec<(Action, f32)> = (0..10u8)
            .map(|tile| (act(ActionType::Discard, Some(tile), vec![]), 0.1))
            .collect();
        assert_eq!(lookahead_from_ranked(many).len(), LOOKAHEAD_TOP_N);
    }

    /// Riichi lookahead end to end: when riichi is on offer, the decision also
    /// carries the ranked discards the model would make *after* declaring it —
    /// computed on a state clone, so the live game must stay untouched (applying
    /// the reach for real would corrupt the table).
    #[test]
    fn riichi_lookahead_matches_the_predicted_discard() {
        // 4 sets + tanki on 6p: drawing 9p leaves a hand where riichi is a
        // natural option, and the discard choice is what the lookahead ranks.
        let ours = r#"["1m","2m","3m","4m","5m","6m","7m","8m","9m","2p","3p","4p","6p"]"#;
        let other = r#"["1m","2m","3m","4m","5m","6m","7m","8m","9m","1p","2p","3p","4p"]"#;
        let mut eng = crate::defaults::engine(4, 0).expect("bundled 4p weights");
        eng.feed(ev(r#"{"type":"start_game","names":["a","b","c","d"]}"#));
        eng.feed(ev(&format!(
            r#"{{"type":"start_kyoku","bakaze":"E","dora_marker":"2m","kyoku":1,"honba":0,
                 "kyotaku":0,"oya":1,"scores":[25000,25000,25000,25000],
                 "tehais":[{ours},{other},{other},{other}]}}"#
        )));
        eng.feed(ev(r#"{"type":"tsumo","actor":0,"pai":"9p"}"#));

        let first = eng
            .decide()
            .expect("forward pass")
            .expect("our own draw is a decision point");
        let offers_reach = first
            .candidates
            .iter()
            .any(|(a, _)| matches!(a, BotAction::Reach { .. }));
        assert!(
            offers_reach,
            "fixture invalid: the model offers no riichi here ({:?})",
            first.candidates.iter().map(|(a, _)| a).collect::<Vec<_>>()
        );

        assert!(
            !first.riichi_lookahead.is_empty(),
            "a reach whose discard cannot be named would have been dropped"
        );
        assert!(
            first.riichi_lookahead.len() <= LOOKAHEAD_TOP_N,
            "the lookahead row must respect the HUD's candidate count"
        );
        assert!(
            first
                .riichi_lookahead
                .windows(2)
                .all(|w| w[0].prob >= w[1].prob),
            "lookahead candidates must be ranked by probability: {:?}",
            first.riichi_lookahead
        );
        // Every candidate has to be a tile we actually hold.
        let hand: Vec<String> = serde_json::from_str::<Vec<String>>(ours)
            .expect("valid hand")
            .into_iter()
            .chain(std::iter::once("9p".to_string()))
            .collect();
        for candidate in &first.riichi_lookahead {
            assert!(
                hand.contains(&candidate.pai),
                "lookahead suggests {} which is not in hand {hand:?}",
                candidate.pai
            );
        }

        // A top-ranked reach names the discard the lookahead ranked first.
        if let Some((BotAction::Reach { pai }, _)) = first.candidates.first() {
            assert_eq!(*pai, first.riichi_lookahead[0].pai);
            assert_eq!(eng.reach_discard().as_deref(), Some(pai.as_str()));
        }

        // `decide()` is read-only: simulating the reach on a clone must not have
        // applied it to the live state.
        let second = eng.decide().expect("forward pass").expect("still our turn");
        assert_eq!(second.action, first.action);
        assert_eq!(
            second
                .riichi_lookahead
                .iter()
                .map(|c| c.pai.clone())
                .collect::<Vec<_>>(),
            first
                .riichi_lookahead
                .iter()
                .map(|c| c.pai.clone())
                .collect::<Vec<_>>(),
        );
    }

    /// The lookahead costs a forward pass, so it must stay empty whenever riichi
    /// is not offered — e.g. on an opponent's discard we can only call or pass.
    #[test]
    fn no_lookahead_without_a_reach_candidate() {
        let ours = r#"["9s","9s","1m","2m","3m","4m","5m","6m","7m","8m","9m","1p","2p"]"#;
        let other = r#"["1m","2m","3m","4m","5m","6m","7m","8m","9m","1p","2p","3p","4p"]"#;
        let mut eng = crate::defaults::engine(4, 0).expect("bundled 4p weights");
        eng.feed(ev(r#"{"type":"start_game","names":["a","b","c","d"]}"#));
        eng.feed(ev(&format!(
            r#"{{"type":"start_kyoku","bakaze":"E","dora_marker":"2m","kyoku":1,"honba":0,
                 "kyotaku":0,"oya":0,"scores":[25000,25000,25000,25000],
                 "tehais":[{ours},{other},{other},{other}]}}"#
        )));
        eng.feed(ev(r#"{"type":"tsumo","actor":1,"pai":"9s"}"#));
        eng.feed(ev(
            r#"{"type":"dahai","actor":1,"pai":"9s","tsumogiri":true}"#,
        ));

        let d = eng
            .decide()
            .expect("forward pass")
            .expect("a pon window is a decision point");
        assert!(
            d.riichi_lookahead.is_empty(),
            "no reach on offer, yet the lookahead was computed: {:?}",
            d.riichi_lookahead
        );
    }
}
