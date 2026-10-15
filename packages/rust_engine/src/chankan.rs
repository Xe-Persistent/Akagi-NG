// Ported from Akagi's `native_bot` crate (Apache-2.0), which this engine is
// derived from; keep it in step with upstream — the tests below encode the
// replay-path gaps it works around.
//! Open the chankan (槍槓) ron window on the mjai replay path.
//!
//! riichienv-core 0.4.8 models the chankan window only on its *live action*
//! path: when a kakan is applied there (`state/mod.rs`, `ActionType::Kakan`),
//! the engine checks every other seat for a robable hand and, if one exists,
//! switches to `Phase::WaitResponse` with a `Ron` claim. The mjai *replay*
//! path (`apply_mjai_event`) — the one Akagi's tracker and the native bot's
//! engine drive — applies a kakan by moving straight to `WaitAct` for the
//! declarer and opens nothing.
//!
//! Consequence (observed 2026-08-22, West 1): the server offered our seat a
//! ron on an opponent's added 5p kan, but every consumer of the engine's
//! legal set — the native bot's candidate enumeration, autoplay's Ron-button
//! lookup, its Pass-button gate, the tracker's `can_act` — saw an empty set.
//! The bot answered `none` instantly, autoplay clicked nothing, and the
//! window hung until the human pressed Ron (the server's own timer would
//! otherwise have declined it).
//!
//! The fix is the live path's own check, re-applied after the fact: whenever
//! a replayed kakan by another seat lands, re-run the chankan check for our
//! seat and, when the kan tile completes a yaku-bearing, non-furiten win,
//! open the same `WaitResponse` window the live path would have opened —
//! `Ron` in `current_claims`, our seat in `active_players`, and the robbed
//! tile in `last_discard` (the live path does the same, and it doubles as
//! the hora's target: the kan declarer pays).
//!
//! The window closes itself through the normal event stream: a `Hora` ends
//! the hand, a `Tsumo`/`Dahai` moves the phase on, and the next `Dahai`
//! clears `current_claims`.
//!
//! An ankan can only be robbed for kokushi musou, which riichienv gates on
//! `rule.allows_ron_on_ankan_for_kokushi_musou` (off under the Tenhou
//! defaults Akagi constructs), so ankans intentionally open nothing here.

use riichienv_core::action::{Action, ActionType, Phase};
use riichienv_core::hand_evaluator::HandEvaluator;
use riichienv_core::hand_evaluator_3p::HandEvaluator3P;
use riichienv_core::parser::mjai_to_tid;
use riichienv_core::state::GameState;
use riichienv_core::state_3p::GameState3P;
use riichienv_core::types::{Conditions, Wind};

/// 4-player: open the chankan window for `seat` after `kan_actor` (another
/// seat) declared a kakan on `pai`. Returns whether the window opened —
/// i.e. the robbed tile completes a yaku-bearing, non-furiten win.
pub fn open_on_kakan(state: &mut GameState, kan_actor: u8, pai: &str, seat: u8) -> bool {
    let Some(tile) = mjai_to_tid(pai) else {
        return false;
    };
    if state.is_done || kan_actor == seat || seat >= 4 {
        return false;
    }
    let us = &state.players[seat as usize];
    let calc = HandEvaluator::new(us.hand.clone(), us.melds.clone());
    let waits = calc.get_waits_u8();
    // Own-river furiten only. The live path also consults the missed-agari
    // flags (temporary / riichi furiten), but `apply_mjai_event` never sets
    // them — it only ever *clears* `missed_agari_doujun` — so checking them
    // here would be dead code. The replay path's ordinary discard-ron windows
    // share the blind spot (`_get_claim_actions_for_player` reads the same
    // always-false flags): after a declined ron, the engine may offer a ron
    // the server will not. Autoplay's stray click lands on an empty table and
    // the next event moves the state on, so the cost stays cosmetic.
    let furiten = us.discards.iter().any(|&d| waits.contains(&(d / 4)));
    let win = !furiten && {
        let cond = Conditions {
            tsumo: false,
            riichi: us.riichi_declared,
            double_riichi: us.double_riichi_declared,
            ippatsu: us.ippatsu_cycle,
            player_wind: Wind::from((seat + 4 - state.oya) % 4),
            round_wind: Wind::from(state.round_wind),
            chankan: true,
            riichi_sticks: state.riichi_sticks,
            honba: state.honba as u32,
            ..Default::default()
        };
        let res = calc.calc(tile, state.wall.dora_indicators.clone(), vec![], Some(cond));
        res.is_win && (res.yakuman || res.han >= 1)
    };
    if !win {
        return false;
    }
    // Entry-replace, not push: the live path appends into a freshly-cleared
    // map, but the replay path's map can carry residue for our seat, and
    // stacking a second identical Ron serves nobody.
    //
    // Deliberately NOT the live path's `pending_kan = Some(..)`: on the
    // replay path nothing clears that field before the next start_kyoku, so
    // setting it would tag every later ron of the hand as a chankan in
    // `evaluate_hora`'s score preview. Leaving it unset costs less and stays
    // confined to this window — the preview misses the chankan han itself
    // (see `game_state/score.rs`).
    let ron = Action::new(ActionType::Ron, Some(tile), vec![], Some(seat));
    state.current_claims.insert(seat, vec![ron]);
    state.phase = Phase::WaitResponse;
    state.active_players = vec![seat];
    // The live path's own trick: treat the robbed tile as the last discard,
    // both so the observation shows the tile being claimed and so the ron
    // targets the kan declarer.
    state.last_discard = Some((kan_actor, tile));
    true
}

/// 3-player twin of [`open_on_kakan`] for the sanma engine.
pub fn open_on_kakan_3p(state: &mut GameState3P, kan_actor: u8, pai: &str, seat: u8) -> bool {
    let Some(tile) = mjai_to_tid(pai) else {
        return false;
    };
    if state.is_done || kan_actor == seat || seat >= 3 {
        return false;
    }
    let us = &state.players[seat as usize];
    let calc = HandEvaluator3P::new(us.hand.clone(), us.melds.clone());
    let waits = calc.get_waits_u8();
    // Own-river furiten only — the missed-agari flags are never set on the
    // replay path; see the note in [`open_on_kakan`].
    let furiten = us.discards.iter().any(|&d| waits.contains(&(d / 4)));
    let win = !furiten && {
        let cond = Conditions {
            tsumo: false,
            riichi: us.riichi_declared,
            double_riichi: us.double_riichi_declared,
            ippatsu: us.ippatsu_cycle,
            player_wind: Wind::from((seat + 3 - state.oya) % 3),
            round_wind: Wind::from(state.round_wind),
            chankan: true,
            riichi_sticks: state.riichi_sticks,
            honba: state.honba as u32,
            is_sanma: true,
            num_players: 3,
            ..Default::default()
        };
        let res = calc.calc(tile, state.wall.dora_indicators.clone(), vec![], Some(cond));
        res.is_win && (res.yakuman || res.han >= 1)
    };
    if !win {
        return false;
    }
    // Entry-replace, not push; `pending_kan` stays unset — same rationale as
    // the 4p path above.
    let ron = Action::new(ActionType::Ron, Some(tile), vec![], Some(seat));
    state.current_claims.insert(seat, vec![ron]);
    state.phase = Phase::WaitResponse;
    state.active_players = vec![seat];
    state.last_discard = Some((kan_actor, tile));
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use riichienv_core::replay::MjaiEvent;
    use riichienv_core::rule::GameRule;
    use riichienv_core::state::legal_actions::GameStateLegalActions;

    fn ev(line: &str) -> MjaiEvent {
        serde_json::from_str(line).expect("valid mjai event")
    }

    /// Menzen tanyao hand waiting on 5s (`234m 567m 234p 567p 5s`) — robbing
    /// a 5s kakan is a valid ron without riichi.
    const OUR_HAND: &str = r#"["2m","3m","4m","5m","6m","7m","2p","3p","4p","5p","6p","7p","5s"]"#;
    /// Same shape but waiting on 8s — nothing to do with a 5s kan.
    const UNRELATED_HAND: &str =
        r#"["2m","3m","4m","5m","6m","7m","2p","3p","4p","5p","6p","7p","8s"]"#;
    /// Seat 0 holds two 5s to pon the third with, plus filler.
    const KAN_SEAT_HAND: &str =
        r#"["5s","5s","1p","2p","3p","7p","8p","9p","1z","2z","3z","4z","5z"]"#;
    const JUNK: &str = r#"["1m","9m","1p","9p","1s","9s","1z","2z","3z","4z","5z","6z","7z"]"#;

    /// Drive a 4p game to just after seat 0 kakans a 5s (pon'd from seat 2
    /// earlier, fourth copy drawn). `our_hand` seeds seat 1.
    fn game_at_kakan(our_hand: &str) -> GameState {
        let mut state = GameState::new(0, true, None, 0, GameRule::default_tenhou());
        state.apply_mjai_event(ev(r#"{"type":"start_game","names":["a","b","c","d"]}"#));
        state.apply_mjai_event(ev(&format!(
            r#"{{"type":"start_kyoku","bakaze":"E","dora_marker":"2m","kyoku":1,"honba":0,
                 "kyotaku":0,"oya":0,"scores":[25000,25000,25000,25000],
                 "tehais":[{KAN_SEAT_HAND},{our_hand},{JUNK},{JUNK}]}}"#
        )));
        // Seat 2 throws the third 5s; seat 0 pons it.
        state.apply_mjai_event(ev(r#"{"type":"tsumo","actor":2,"pai":"5s"}"#));
        state.apply_mjai_event(ev(
            r#"{"type":"dahai","actor":2,"pai":"5s","tsumogiri":true}"#,
        ));
        state.apply_mjai_event(ev(
            r#"{"type":"pon","actor":0,"target":2,"pai":"5s","consumed":["5s","5s"]}"#,
        ));
        // Turn order reaches seat 0 again; it draws the last 5s and kakans.
        for (actor, pai) in [(0u8, "1z"), (1, "2z"), (2, "3z"), (3, "4z")] {
            state.apply_mjai_event(ev(&format!(
                r#"{{"type":"tsumo","actor":{actor},"pai":"{pai}"}}"#
            )));
            state.apply_mjai_event(ev(&format!(
                r#"{{"type":"dahai","actor":{actor},"pai":"{pai}","tsumogiri":true}}"#
            )));
        }
        state.apply_mjai_event(ev(r#"{"type":"tsumo","actor":0,"pai":"5s"}"#));
        state.apply_mjai_event(ev(r#"{"type":"kakan","actor":0,"pai":"5s"}"#));
        state
    }

    #[test]
    fn robable_kakan_opens_a_ron_pass_window() {
        let mut state = game_at_kakan(OUR_HAND);
        assert!(open_on_kakan(&mut state, 0, "5s", 1));

        assert_eq!(state.phase, Phase::WaitResponse);
        assert_eq!(state.active_players, vec![1]);
        // The robbed tile is the "discard": the obs's last-discard plane and
        // the hora's target both read it.
        let five_s = mjai_to_tid("5s").unwrap();
        assert_eq!(state.last_discard, Some((0, five_s)));

        let legal = state._get_legal_actions_internal(1);
        assert!(legal
            .iter()
            .any(|a| a.action_type == ActionType::Ron && a.tile == Some(five_s)));
        assert!(legal.iter().any(|a| a.action_type == ActionType::Pass));
        // And nobody else was granted a claim — WaitResponse hands every
        // seat the ubiquitous lone Pass, but no other Ron.
        assert!(state
            ._get_legal_actions_internal(2)
            .iter()
            .all(|a| a.action_type == ActionType::Pass));
    }

    #[test]
    fn kakan_we_cannot_robe_opens_nothing() {
        let mut state = game_at_kakan(UNRELATED_HAND);
        assert!(!open_on_kakan(&mut state, 0, "5s", 1));
        assert_eq!(state.phase, Phase::WaitAct);
        assert!(state._get_legal_actions_internal(1).is_empty());
    }

    #[test]
    fn own_kakan_opens_nothing() {
        let mut state = game_at_kakan(OUR_HAND);
        assert!(!open_on_kakan(&mut state, 0, "5s", 0));
    }

    #[test]
    fn own_river_furiten_blocks_the_window() {
        let mut state = game_at_kakan(OUR_HAND);
        // A 5s in our own river makes the wait furiten.
        state.players[1].discards.push(mjai_to_tid("5s").unwrap());
        assert!(!open_on_kakan(&mut state, 0, "5s", 1));
    }

    /// Characterization, not aspiration: the missed-agari flags are dead on
    /// the replay path (`apply_mjai_event` never sets them), so the helper
    /// deliberately ignores them and the window opens anyway. If Akagi ever
    /// starts maintaining the flags — an ippatsu-patch-style fixup in the
    /// tracker, or an upstream riichienv fix — flip this test and put the
    /// flag checks back into the furiten test above.
    #[test]
    fn missed_agari_flags_are_ignored_by_design() {
        let mut state = game_at_kakan(OUR_HAND);
        state.players[1].missed_agari_doujun = true;
        state.players[1].missed_agari_riichi = true;
        assert!(open_on_kakan(&mut state, 0, "5s", 1));
    }

    /// The window must not linger: the rinshan draw after a passed chankan
    /// moves the engine on, and the next discard clears the claims.
    #[test]
    fn window_closes_through_the_normal_event_stream() {
        let mut state = game_at_kakan(OUR_HAND);
        assert!(open_on_kakan(&mut state, 0, "5s", 1));
        // We pass; seat 0 draws its rinshan replacement.
        state.apply_mjai_event(ev(r#"{"type":"tsumo","actor":0,"pai":"6z"}"#));
        assert_eq!(state.phase, Phase::WaitAct);
        assert!(state._get_legal_actions_internal(1).is_empty());
        state.apply_mjai_event(ev(
            r#"{"type":"dahai","actor":0,"pai":"6z","tsumogiri":true}"#,
        ));
        assert!(!state
            ._get_legal_actions_internal(1)
            .iter()
            .any(|a| a.action_type == ActionType::Ron));
    }

    /// Sanma twin of [`robable_kakan_opens_a_ron_pass_window`]: same tanyao
    /// shape, three seats.
    #[test]
    fn sanma_robable_kakan_opens_a_ron_pass_window() {
        use riichienv_core::state_3p::legal_actions::GameState3PLegalActions;
        let sanma_hand = OUR_HAND; // 234m 567m 234p 567p 5s — tanyao works in sanma
        let mut state = GameState3P::new(0, true, None, 0, GameRule::default_tenhou());
        state.apply_mjai_event(ev(r#"{"type":"start_game","names":["a","b","c"]}"#));
        state.apply_mjai_event(ev(&format!(
            r#"{{"type":"start_kyoku","bakaze":"E","dora_marker":"2m","kyoku":1,"honba":0,
                 "kyotaku":0,"oya":0,"scores":[35000,35000,35000],
                 "tehais":[{KAN_SEAT_HAND},{sanma_hand},{JUNK}]}}"#
        )));
        state.apply_mjai_event(ev(r#"{"type":"tsumo","actor":2,"pai":"5s"}"#));
        state.apply_mjai_event(ev(
            r#"{"type":"dahai","actor":2,"pai":"5s","tsumogiri":true}"#,
        ));
        state.apply_mjai_event(ev(
            r#"{"type":"pon","actor":0,"target":2,"pai":"5s","consumed":["5s","5s"]}"#,
        ));
        for (actor, pai) in [(0u8, "1z"), (1, "2z"), (2, "3z")] {
            state.apply_mjai_event(ev(&format!(
                r#"{{"type":"tsumo","actor":{actor},"pai":"{pai}"}}"#
            )));
            state.apply_mjai_event(ev(&format!(
                r#"{{"type":"dahai","actor":{actor},"pai":"{pai}","tsumogiri":true}}"#
            )));
        }
        state.apply_mjai_event(ev(r#"{"type":"tsumo","actor":0,"pai":"5s"}"#));
        state.apply_mjai_event(ev(r#"{"type":"kakan","actor":0,"pai":"5s"}"#));

        assert!(open_on_kakan_3p(&mut state, 0, "5s", 1));
        assert_eq!(state.phase, Phase::WaitResponse);
        let legal = state._get_legal_actions_internal(1);
        assert!(legal.iter().any(|a| a.action_type == ActionType::Ron));
        assert!(legal.iter().any(|a| a.action_type == ActionType::Pass));
    }
}
