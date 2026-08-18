//! Replay an mjai game log through the riichienv-core engine and emit
//! `(obs, action, mask)` behavior-cloning samples.
//!
//! One file = one game. We drive the engine exactly like Akagi's live tracker
//! (`apply_mjai_event` for every event) and, **before** applying each event
//! that represents a player's free choice, snapshot `get_observation(actor)` and
//! record the chosen action's id. We also synthesize `Pass` samples: after each
//! discard, every seat that had a legal call but did not claim gets a `Pass`
//! label. Because the same `get_observation` + adapter path is used at inference
//! time, the model always sees identical features.

use riichienv_core::action::{Action, ActionType};
use riichienv_core::parser::mjai_to_tid;
use riichienv_core::replay::MjaiEvent;
use riichienv_core::rule::GameRule;
use riichienv_core::state::GameState;
use riichienv_core::state_3p::GameState3P;

use crate::action_codec::{action_index, pass_index};
use crate::adapt::{obs_and_legal_3p, obs_and_legal_4p};
use crate::mjai_compat::parse_line;

/// Sink for emitted samples: `(encoded obs [C*T] f32, action id, legal mask)`.
pub type Emit<'a> = dyn FnMut(&[f32], u16, &[u8]) + 'a;

enum Engine {
    Four(Box<GameState>),
    Three(Box<GameState3P>),
}

impl Engine {
    fn new(num_players: u8) -> Self {
        let rule = GameRule::default_tenhou();
        if num_players == 3 {
            Engine::Three(Box::new(GameState3P::new(0, true, None, 0, rule)))
        } else {
            Engine::Four(Box::new(GameState::new(0, true, None, 0, rule)))
        }
    }

    fn num_players(&self) -> u8 {
        match self {
            Engine::Four(_) => 4,
            Engine::Three(_) => 3,
        }
    }

    fn apply(&mut self, ev: MjaiEvent) {
        match self {
            Engine::Four(s) => s.apply_mjai_event(ev),
            Engine::Three(s) => s.apply_mjai_event(ev),
        }
    }

    fn active_players(&self) -> Vec<u8> {
        match self {
            Engine::Four(s) => s.active_players.clone(),
            Engine::Three(s) => s.active_players.clone(),
        }
    }

    /// Snapshot `(encoded obs, legal mask)` for `pid` at the current state.
    fn sample_for(&mut self, pid: u8) -> (Vec<f32>, Vec<u8>) {
        let (obs, legal) = match self {
            Engine::Four(s) => obs_and_legal_4p(s, pid),
            Engine::Three(s) => obs_and_legal_3p(s, pid),
        };
        (
            obs,
            crate::action_codec::legal_mask(&legal, self.num_players()),
        )
    }
}

/// The actor + chosen action for events that are a player's free decision.
/// Returns `None` for engine/progression events (tsumo, dora, reach_accepted,
/// start/end, ryukyoku).
fn decision(ev: &MjaiEvent) -> Option<(u8, Action)> {
    let tid = |s: &str| mjai_to_tid(s);
    let tids = |v: &[String]| -> Vec<u8> { v.iter().filter_map(|s| mjai_to_tid(s)).collect() };
    match ev {
        MjaiEvent::Dahai { actor, pai, .. } => Some((
            *actor as u8,
            Action::new(ActionType::Discard, tid(pai), vec![], Some(*actor as u8)),
        )),
        MjaiEvent::Reach { actor } => Some((
            *actor as u8,
            Action::new(ActionType::Riichi, None, vec![], Some(*actor as u8)),
        )),
        MjaiEvent::Pon {
            actor,
            pai,
            consumed,
            ..
        } => Some((
            *actor as u8,
            Action::new(
                ActionType::Pon,
                tid(pai),
                tids(consumed),
                Some(*actor as u8),
            ),
        )),
        MjaiEvent::Chi {
            actor,
            pai,
            consumed,
            ..
        } => Some((
            *actor as u8,
            Action::new(
                ActionType::Chi,
                tid(pai),
                tids(consumed),
                Some(*actor as u8),
            ),
        )),
        MjaiEvent::Kan {
            actor,
            pai,
            consumed,
            ..
        } => Some((
            *actor as u8,
            Action::new(
                ActionType::Daiminkan,
                tid(pai),
                tids(consumed),
                Some(*actor as u8),
            ),
        )),
        MjaiEvent::Kakan { actor, pai } => Some((
            *actor as u8,
            Action::new(
                ActionType::Kakan,
                tid(pai),
                tid(pai).into_iter().collect(),
                Some(*actor as u8),
            ),
        )),
        MjaiEvent::Ankan { actor, consumed } => Some((
            *actor as u8,
            Action::new(ActionType::Ankan, None, tids(consumed), Some(*actor as u8)),
        )),
        MjaiEvent::Hora { actor, target, .. } => Some((
            *actor as u8,
            Action::new(
                if actor == target {
                    ActionType::Tsumo
                } else {
                    ActionType::Ron
                },
                None,
                vec![],
                Some(*actor as u8),
            ),
        )),
        MjaiEvent::Kita { actor } => Some((
            *actor as u8,
            Action::new(ActionType::Kita, None, vec![], Some(*actor as u8)),
        )),
        _ => None,
    }
}

/// The claiming seat if this event is a discard-response claim (pon/chi/kan/ron).
fn claimer(ev: &MjaiEvent) -> Option<u8> {
    match ev {
        MjaiEvent::Pon { actor, .. }
        | MjaiEvent::Chi { actor, .. }
        | MjaiEvent::Kan { actor, .. }
        | MjaiEvent::Hora { actor, .. } => Some(*actor as u8),
        _ => None,
    }
}

/// The discarding seat if this event is a discard (opens a response window).
fn discarder(ev: &MjaiEvent) -> Option<u8> {
    match ev {
        MjaiEvent::Dahai { actor, .. } => Some(*actor as u8),
        _ => None,
    }
}

/// Replay one game's mjai JSONL `content` and emit samples. Returns the number
/// of samples emitted. Malformed lines are skipped; the caller should guard the
/// whole call with `catch_unwind` for defense against engine panics on rare
/// pathological logs.
pub fn replay_game(content: &str, num_players: u8, emit: &mut Emit) -> usize {
    let mut eng = Engine::new(num_players);
    let np = eng.num_players();
    let pass_idx = pass_index(np) as u16;

    // Responders snapshotted at the last discard, pending a pass/claim decision.
    let mut window: Vec<(u8, Vec<f32>, Vec<u8>)> = Vec::new();
    let mut count = 0usize;
    // Whether the previous event was a `hora` — mjai emits one hora per winner,
    // so a double/triple ron arrives as consecutive hora events.
    let mut prev_was_hora = false;

    for line in content.lines() {
        // Applies the sanma nukidora→kita rename (which must happen before serde
        // sees the line) and the 4-seat array truncation; skips blank, malformed,
        // and unmodelled lines.
        let Some(ev) = parse_line(line, np) else {
            continue;
        };

        let is_hora = matches!(ev, MjaiEvent::Hora { .. });

        // Close the open response window against this event. A seat that
        // claimed never gets a synthesized `Pass`. Pon/chi/kan settle the whole
        // window (everyone else declined), but a hora does **not**: the seats
        // still pending may include a second ron winner, whose hora is the very
        // next event. Keep them open until a non-hora event settles them, or a
        // double ron would label the second winner as having passed.
        if !window.is_empty() {
            if let Some(who) = claimer(&ev) {
                window.retain(|(pid, _, _)| *pid != who);
            }
            if !is_hora {
                for (_pid, obs, mask) in window.drain(..) {
                    emit(&obs, pass_idx, &mask);
                    count += 1;
                }
            }
        }

        // Record the actor's own decision (snapshot BEFORE applying). A hora
        // directly following another hora is a double/triple ron: the engine has
        // already advanced past the first winner, so a snapshot here is not the
        // state this seat decided from — skip it rather than mislabel it.
        if !(is_hora && prev_was_hora) {
            if let Some((actor, action)) = decision(&ev) {
                if let Some(idx) = action_index(&action, np) {
                    let (obs, mask) = eng.sample_for(actor);
                    if mask.get(idx).copied().unwrap_or(0) == 1 {
                        emit(&obs, idx as u16, &mask);
                        count += 1;
                    }
                }
            }
        }

        // Note discard/claim before we move `ev` into `apply`.
        let opened_by = discarder(&ev);

        eng.apply(ev);
        prev_was_hora = is_hora;

        // Open a new response window after a discard: snapshot each responder
        // that actually had a call option (legal action other than Pass).
        if let Some(disc) = opened_by {
            for p in eng.active_players() {
                if p == disc {
                    continue;
                }
                let (obs, mask) = eng.sample_for(p);
                let has_call = mask
                    .iter()
                    .enumerate()
                    .any(|(i, &m)| m == 1 && i != pass_idx as usize);
                if has_call {
                    window.push((p, obs, mask));
                }
            }
        }
    }

    // Any responders still pending at end-of-log passed.
    for (_pid, obs, mask) in window.drain(..) {
        emit(&obs, pass_idx, &mask);
        count += 1;
    }

    count
}

#[cfg(test)]
mod tests {
    use super::*;

    const AGARI_4P: u16 = 79;
    const PASS_4P: u16 = 81;

    /// Chinitsu tenpai waiting on 1p (`123p + 456p + 789p + 789p + 55p`).
    /// Guaranteed yaku, so riichienv offers Ron on a 1p discard.
    const RON_ON_1P: &str = r#"["2p","3p","4p","5p","6p","7p","8p","9p","7p","8p","9p","5p","5p"]"#;
    /// Holds 1p to discard it; nothing else claimable.
    const DISCARDS_1P: &str = r#"["1p","1m","9m","1s","9s","E","S","W","N","P","F","C","1m"]"#;
    /// Holds two 1p, so a 1p discard gives it a pon option it declines.
    const CAN_PON_1P: &str =
        r#"["1p","1p","2m","3m","4m","5m","6m","7m","8m","9m","1s","2s","3s"]"#;

    fn game(seat_hands: [&str; 4], tail: &str) -> String {
        let [s0, s1, s2, s3] = seat_hands;
        format!(
            concat!(
                r#"{{"type":"start_game","names":["a","b","c","d"]}}"#,
                "\n",
                r#"{{"type":"start_kyoku","bakaze":"E","dora_marker":"2m","kyoku":1,"honba":0,"#,
                r#""kyotaku":0,"oya":0,"scores":[25000,25000,25000,25000],"#,
                r#""tehais":[{s0},{s1},{s2},{s3}]}}"#,
                "\n",
                r#"{{"type":"tsumo","actor":0,"pai":"9s"}}"#,
                "\n",
                r#"{{"type":"dahai","actor":0,"pai":"1p","tsumogiri":false}}"#,
                "\n{tail}\n",
                r#"{{"type":"end_kyoku"}}"#,
            ),
            s0 = s0,
            s1 = s1,
            s2 = s2,
            s3 = s3,
            tail = tail,
        )
    }

    /// Replay `content` and tally the emitted action labels.
    fn labels(content: &str) -> Vec<u16> {
        let mut out = Vec::new();
        {
            let mut emit = |_obs: &[f32], act: u16, _mask: &[u8]| out.push(act);
            replay_game(content, 4, &mut emit);
        }
        out
    }

    /// Regression: on a double ron, mjai emits one `hora` per winner. The
    /// response window used to be drained by the **first** hora, synthesizing a
    /// `Pass` label for the second winner — a training sample that says "this
    /// seat declined" about a seat that actually won. Only the seat that neither
    /// ron'd nor called (seat 3, holding a pon option) may be labeled Pass.
    #[test]
    fn double_ron_does_not_label_the_second_winner_as_pass() {
        let content = game(
            [DISCARDS_1P, RON_ON_1P, RON_ON_1P, CAN_PON_1P],
            concat!(
                r#"{"type":"hora","actor":1,"target":0,"pai":"1p"}"#,
                "\n",
                r#"{"type":"hora","actor":2,"target":0,"pai":"1p"}"#,
            ),
        );
        let acts = labels(&content);

        let agari = acts.iter().filter(|&&a| a == AGARI_4P).count();
        let passes = acts.iter().filter(|&&a| a == PASS_4P).count();

        // The fixture must really offer Ron, or this test proves nothing.
        assert!(
            agari >= 1,
            "fixture invalid: no agari-labeled sample emitted (labels: {acts:?})"
        );
        assert_eq!(
            passes, 1,
            "exactly one seat (the pon-declining seat 3) may be labeled Pass; \
             pre-fix the second ron winner was labeled Pass too (labels: {acts:?})"
        );
    }

    /// The complement: a pon **does** settle the window for everyone else, so
    /// both remaining responders are labeled Pass. Guards the claim/hora split
    /// in the window-closing logic from collapsing back into "never drain".
    #[test]
    fn pon_claim_settles_the_window_for_other_responders() {
        // Seats 1 and 2 hold a ron; seat 3 pons instead. Seats 1 and 2 declined.
        let content = game(
            [DISCARDS_1P, RON_ON_1P, RON_ON_1P, CAN_PON_1P],
            r#"{"type":"pon","actor":3,"target":0,"pai":"1p","consumed":["1p","1p"]}"#,
        );
        let acts = labels(&content);
        let passes = acts.iter().filter(|&&a| a == PASS_4P).count();
        assert_eq!(
            passes, 2,
            "both declining ron seats must be labeled Pass (labels: {acts:?})"
        );
    }

    /// A single ron still labels the other responders as passing — the window is
    /// settled by the following non-hora event (here `end_kyoku`).
    #[test]
    fn single_ron_still_passes_the_remaining_responders() {
        let content = game(
            [DISCARDS_1P, RON_ON_1P, CAN_PON_1P, CAN_PON_1P],
            r#"{"type":"hora","actor":1,"target":0,"pai":"1p"}"#,
        );
        let acts = labels(&content);
        let passes = acts.iter().filter(|&&a| a == PASS_4P).count();
        assert_eq!(
            passes, 2,
            "seats 2 and 3 declined their pon (labels: {acts:?})"
        );
    }
}
