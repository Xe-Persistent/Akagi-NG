//! Keep a blood battle (雀魂「修罗之战」) running after one of its mid-hand wins.
//!
//! riichienv-core 0.4.10 treats every win as the end of the hand. The mjai
//! replay path's `Hora` branch — the one Akagi's tracker drives — only sets
//! `is_done` (`state/event_handler.rs`) and ignores the event's `scores` and
//! `deltas`; both `get_legal_actions` entry points return an empty set while
//! `is_done` is set (`state/mod.rs`, `state/legal_actions.rs`), so `decide()`
//! answers `None` for the rest of the hand.
//!
//! That is right for every mode except this one: a blood battle allows up to
//! three seats to win the same hand (a flat check, and each win is settled on
//! the spot), and the players who have not won yet keep playing after the first
//! two. Left alone, the engine goes silent at the first win and stays silent
//! until the next `StartKyoku`.
//!
//! Two things are therefore re-applied after the fact, both driven by the
//! events the bridge emits:
//!
//! * [`resume_after_hora`] clears `is_done` when a win was *not* the hand's last
//!   event. Nothing else needs undoing: the replay path drives turn order,
//!   phase and hands purely from the event stream (`Tsumo` moves
//!   `current_player`/`active_players` to its actor), so a seat that stops
//!   receiving tiles simply stops being anyone's turn — exactly what the server
//!   does to the seats that already won. In particular the dealer not repeating
//!   after winning needs no help: `start_kyoku` carries the next `oya` itself.
//! * [`apply_hora_scores`] copies the table's own post-win scores. Without it
//!   the observation keeps pre-win scores for the rest of the hand, and in this
//!   mode the hand continues after a settlement. `deltas` are deliberately not
//!   the source: they are net of the riichi stick the crate already deducted at
//!   `reach_accepted`, so adding them would charge a declaring player twice.
//!
//! Both helpers are no-ops when a win really did end the hand, so the standard
//! four-player and sanma paths are unaffected. A blood battle has no 3-player
//! variant, so only the 4-player state carries this.

use riichienv_core::replay::MjaiEvent;
use riichienv_core::state::GameState;

/// Whether this event ends (or starts) a hand rather than continuing the one in
/// progress. Anything else after a win means the win was a mid-hand settlement.
pub fn ends_round(ev: &MjaiEvent) -> bool {
    matches!(
        ev,
        MjaiEvent::StartGame { .. }
            | MjaiEvent::StartKyoku { .. }
            | MjaiEvent::Ryukyoku { .. }
            | MjaiEvent::EndKyoku
            | MjaiEvent::EndGame
    )
}

/// Lift the "the hand is over" flag a win sets, so the rest of the blood battle
/// keeps reaching [`crate::engine::Engine::decide`]. Returns whether it did.
pub fn resume_after_hora(state: &mut GameState) -> bool {
    if !state.is_done {
        return false;
    }
    state.is_done = false;
    true
}

/// Copy the settlement's absolute scores into the state. A `hora` without them
/// (some third-party logs) leaves the state as it was.
pub fn apply_hora_scores(state: &mut GameState, scores: Option<&[i32]>) {
    let Some(scores) = scores else {
        return;
    };
    if scores.len() < state.players.len() {
        return;
    }
    for (player, score) in state.players.iter_mut().zip(scores) {
        player.score = *score;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use riichienv_core::rule::GameRule;
    use riichienv_core::state::legal_actions::GameStateLegalActions;

    fn ev(line: &str) -> MjaiEvent {
        serde_json::from_str(line).expect("valid mjai event")
    }

    const HAND: &str = r#"["1m","2m","3m","4m","5m","6m","1p","2p","3p","4p","5p","6p","7p"]"#;
    const JUNK: &str = r#"["1m","9m","1p","9p","1s","9s","1z","2z","3z","4z","5z","6z","7z"]"#;

    /// Seat 0 has just won on its own draw, two seats still to play.
    fn state_after_win() -> GameState {
        let mut state = GameState::new(0, true, None, 0, GameRule::default_tenhou());
        state.apply_mjai_event(ev(r#"{"type":"start_game","names":["a","b","c","d"]}"#));
        state.apply_mjai_event(ev(&format!(
            r#"{{"type":"start_kyoku","bakaze":"E","dora_marker":"2m","kyoku":1,"honba":0,
                 "kyotaku":0,"oya":0,"scores":[25000,25000,25000,25000],
                 "tehais":[{HAND},{JUNK},{JUNK},{JUNK}]}}"#
        )));
        state.apply_mjai_event(ev(r#"{"type":"tsumo","actor":0,"pai":"7p"}"#));
        state.apply_mjai_event(ev(r#"{"type":"hora","actor":0,"target":0,"pai":"7p",
                "scores":[27000,24000,25000,25000],"deltas":[2000,-1000,0,0]}"#));
        state
    }

    #[test]
    fn a_win_stops_the_engine_until_it_is_resumed() {
        let mut state = state_after_win();
        assert!(state.is_done);
        assert!(state._get_legal_actions_internal(0).is_empty());

        assert!(resume_after_hora(&mut state));
        assert!(!state.is_done);
        assert!(!state._get_legal_actions_internal(0).is_empty());
    }

    #[test]
    fn resuming_leaves_a_running_hand_alone() {
        let mut state = GameState::new(0, true, None, 0, GameRule::default_tenhou());
        state.apply_mjai_event(ev(r#"{"type":"start_game","names":["a","b","c","d"]}"#));
        assert!(!resume_after_hora(&mut state));
        assert!(!state.is_done);
    }

    #[test]
    fn mid_hand_settlements_continue_the_round() {
        assert!(!ends_round(&ev(r#"{"type":"tsumo","actor":1,"pai":"5s"}"#)));
        assert!(!ends_round(&ev(
            r#"{"type":"dahai","actor":1,"pai":"5s","tsumogiri":true}"#
        )));
        assert!(!ends_round(&ev(r#"{"type":"dora","dora_marker":"3m"}"#)));
    }

    #[test]
    fn round_endings_do_not_continue_the_round() {
        assert!(ends_round(&ev(r#"{"type":"ryukyoku","deltas":[0,0,0,0]}"#)));
        assert!(ends_round(&ev(r#"{"type":"end_kyoku"}"#)));
        assert!(ends_round(&ev(r#"{"type":"end_game"}"#)));
        assert!(ends_round(&ev(
            r#"{"type":"start_kyoku","bakaze":"E","dora_marker":"2m","kyoku":2,"honba":0,
                "kyotaku":0,"oya":1,"scores":[26000,24000,25000,25000],
                "tehais":[[],[],[],[]]}"#
        )));
    }

    #[test]
    fn scores_follow_the_table() {
        let mut state = state_after_win();
        apply_hora_scores(&mut state, Some(&[27000, 24000, 25000, 25000]));

        let scores: Vec<i32> = state.players.iter().map(|p| p.score).collect();
        assert_eq!(scores, vec![27000, 24000, 25000, 25000]);
    }

    #[test]
    fn scores_are_left_alone_without_a_settlement() {
        let mut state = state_after_win();
        apply_hora_scores(&mut state, None);
        apply_hora_scores(&mut state, Some(&[1000, 2000]));

        let scores: Vec<i32> = state.players.iter().map(|p| p.score).collect();
        assert_eq!(scores, vec![25000, 25000, 25000, 25000]);
    }
}
