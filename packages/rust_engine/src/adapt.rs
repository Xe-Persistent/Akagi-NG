//! Adapters that turn a riichienv-core observation into our [`EncInput`].
//!
//! Used identically by the extractor and by live inference, which is what
//! guarantees train/inference feature parity.
//!
//! ## `last_discard` is read from the state, not the observation
//!
//! `GameState::last_discard` (and its sanma twin) is a `(discarder_pid, tile)`
//! pair, but riichienv-core 0.4.8's `get_observation` destructures it as
//! `(tile, _pid)` — so `Observation::last_discard` actually carries the
//! *discarder's seat*, not the tile. Feeding that into the encoder collapses the
//! "last discard" plane onto tile34 0 (seats 0..3 are tile ids 0..3, all `1m`)
//! and the model never sees which tile it is being asked to call. We therefore
//! read the tile straight off the owning state and pass it in explicitly, the
//! same way `turn_count` and the sanma kita counts are already handled.

use riichienv_core::action::Action;
use riichienv_core::observation::Observation;
use riichienv_core::observation_3p::Observation3P;
use riichienv_core::state::GameState;
use riichienv_core::state_3p::GameState3P;

use crate::obs::{EncInput, SeatFeat};

/// Snapshot `(encoded obs, legal actions)` for `seat` from a 4-player engine.
/// Shared by the extractor and live inference so features always match.
pub fn obs_and_legal_4p(state: &mut GameState, seat: u8) -> (Vec<f32>, Vec<Action>) {
    let turn = state.turn_count;
    // `(discarder_pid, tile)` — see the module docs on why this can't come from
    // `Observation::last_discard`.
    let last_discard = state.last_discard.map(|(_pid, tile)| tile);
    let obs = state.get_observation(seat);
    let legal = obs.legal_actions_method();
    (enc_input_4p(&obs, turn, last_discard).encode(), legal)
}

/// Snapshot `(encoded obs, legal actions)` for `seat` from a 3-player engine.
/// The `Action3P` legal set is unwrapped to plain `Action`s (their inner value).
pub fn obs_and_legal_3p(state: &mut GameState3P, seat: u8) -> (Vec<f32>, Vec<Action>) {
    let turn = state.turn_count;
    let kita: [u8; 3] = std::array::from_fn(|i| state.players[i].kita_tiles.len() as u8);
    let last_discard = state.last_discard.map(|(_pid, tile)| tile);
    let obs = state.get_observation(seat);
    let legal: Vec<Action> = obs
        .legal_actions_method()
        .into_iter()
        .map(|a| a.0)
        .collect();
    (enc_input_3p(&obs, turn, kita, last_discard).encode(), legal)
}

/// Build an [`EncInput`] from a 4-player observation.
///
/// `turn_count` and `last_discard` are read from the owning `GameState` (the
/// former is absent from the observation, the latter is mislabeled there — see
/// the module docs). Seats are placed in relative order (index 0 = deciding
/// player).
pub fn enc_input_4p(obs: &Observation, turn_count: u32, last_discard: Option<u8>) -> EncInput {
    let pid = obs.player_id as usize;
    let oya = obs.oya as usize;

    let seats: Vec<SeatFeat> = (0..4)
        .map(|k| {
            let rel = (pid + k) % 4;
            SeatFeat {
                discards: obs.discards[rel].iter().map(|&t| t as u8).collect(),
                meld_tiles: obs.melds[rel]
                    .iter()
                    .flat_map(|m| m.tiles.iter().copied())
                    .collect(),
                riichi_declared: obs.riichi_declared[rel],
                riichi_tile: obs.riichi_sutehais[rel],
                score: obs.scores[rel],
                kita_count: 0,
            }
        })
        .collect();

    EncInput {
        num_players: 4,
        hand: obs.hands[pid].iter().map(|&t| t as u8).collect(),
        drawn_tile: obs.drawn_tile,
        waits: obs.waits.clone(),
        is_tenpai: obs.is_tenpai,
        dora_indicators: obs.dora_indicators.iter().map(|&t| t as u8).collect(),
        seats,
        last_discard,
        round_wind: obs.round_wind,
        seat_wind: ((pid + 4 - oya) % 4) as u8,
        honba: obs.honba,
        riichi_sticks: obs.riichi_sticks,
        turn_count,
        is_dealer: pid == oya,
        kyoku_index: obs.kyoku_index,
        self_riichi: obs.riichi_declared[pid],
    }
}

/// Build an [`EncInput`] from a 3-player (sanma) observation.
///
/// `kita_counts` holds each seat's nukidora (kita) count in **absolute** seat
/// order; it is not carried on the observation, so the caller reads it from the
/// owning `GameState3P`, as it does `turn_count` and `last_discard`.
pub fn enc_input_3p(
    obs: &Observation3P,
    turn_count: u32,
    kita_counts: [u8; 3],
    last_discard: Option<u8>,
) -> EncInput {
    let pid = obs.player_id as usize;
    let oya = obs.oya as usize;

    let seats: Vec<SeatFeat> = (0..3)
        .map(|k| {
            let rel = (pid + k) % 3;
            SeatFeat {
                discards: obs.discards[rel].iter().map(|&t| t as u8).collect(),
                meld_tiles: obs.melds[rel]
                    .iter()
                    .flat_map(|m| m.tiles.iter().copied())
                    .collect(),
                riichi_declared: obs.riichi_declared[rel],
                riichi_tile: obs.riichi_sutehais[rel],
                score: obs.scores[rel],
                kita_count: kita_counts[rel],
            }
        })
        .collect();

    EncInput {
        num_players: 3,
        hand: obs.hands[pid].iter().map(|&t| t as u8).collect(),
        drawn_tile: obs.drawn_tile,
        waits: obs.waits.clone(),
        is_tenpai: obs.is_tenpai,
        dora_indicators: obs.dora_indicators.iter().map(|&t| t as u8).collect(),
        seats,
        last_discard,
        round_wind: obs.round_wind,
        seat_wind: ((pid + 3 - oya) % 3) as u8,
        honba: obs.honba,
        riichi_sticks: obs.riichi_sticks,
        turn_count,
        is_dealer: pid == oya,
        kyoku_index: obs.kyoku_index,
        self_riichi: obs.riichi_declared[pid],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::obs::last_discard_channel;
    use crate::tiles::{tile_dim, tile_index};
    use riichienv_core::replay::MjaiEvent;
    use riichienv_core::rule::GameRule;

    fn ev(line: &str) -> MjaiEvent {
        serde_json::from_str(line).expect("valid mjai event")
    }

    /// Regression: the "last discard" plane must one-hot the **tile that was
    /// discarded**, not the discarder's seat. riichienv-core 0.4.8's
    /// `Observation::last_discard` mislabels the `(pid, tile)` tuple and yields
    /// the pid, which `tile_index` folds onto tile34 0 for every seat — so the
    /// plane lit `1m` on every call decision and the model could never see the
    /// tile it was being asked to pon/chi/ron.
    #[test]
    fn last_discard_plane_holds_the_tile_not_the_discarder_seat() {
        let hand = r#"["1m","2m","3m","4m","5m","6m","7m","8m","9m","1p","2p","3p","4p"]"#;
        let mut state = GameState::new(0, true, None, 0, GameRule::default_tenhou());
        state.apply_mjai_event(ev(r#"{"type":"start_game","names":["a","b","c","d"]}"#));
        state.apply_mjai_event(ev(&format!(
            r#"{{"type":"start_kyoku","bakaze":"E","dora_marker":"2m","kyoku":1,"honba":0,
                 "kyotaku":0,"oya":0,"scores":[25000,25000,25000,25000],
                 "tehais":[{hand},{hand},{hand},{hand}]}}"#
        )));
        // Seat 1 discards 9s (tile34 26) — a tile whose index can never be
        // confused with a seat number.
        state.apply_mjai_event(ev(r#"{"type":"tsumo","actor":1,"pai":"9s"}"#));
        state.apply_mjai_event(ev(
            r#"{"type":"dahai","actor":1,"pai":"9s","tsumogiri":true}"#,
        ));

        let (buf, _legal) = obs_and_legal_4p(&mut state, 0);
        let t = tile_dim(4);
        let base = last_discard_channel(4) * t;
        let nine_sou = tile_index(104, 4).unwrap(); // 9s -> tile34 26

        assert_eq!(buf[base + nine_sou], 1.0, "9s cell must be set");
        assert_eq!(
            buf[base], 0.0,
            "tile34 0 (1m) must be clear — it is what the discarder's pid 1 \
             would have encoded to"
        );
        assert_eq!(
            buf[base..base + t].iter().filter(|v| **v != 0.0).count(),
            1,
            "the plane is a one-hot"
        );
    }

    /// No discard on the table yet (our own draw) ⇒ the plane is all zeros.
    #[test]
    fn last_discard_plane_is_empty_before_any_discard() {
        let hand = r#"["1m","2m","3m","4m","5m","6m","7m","8m","9m","1p","2p","3p","4p"]"#;
        let mut state = GameState::new(0, true, None, 0, GameRule::default_tenhou());
        state.apply_mjai_event(ev(r#"{"type":"start_game","names":["a","b","c","d"]}"#));
        state.apply_mjai_event(ev(&format!(
            r#"{{"type":"start_kyoku","bakaze":"E","dora_marker":"2m","kyoku":1,"honba":0,
                 "kyotaku":0,"oya":0,"scores":[25000,25000,25000,25000],
                 "tehais":[{hand},{hand},{hand},{hand}]}}"#
        )));
        state.apply_mjai_event(ev(r#"{"type":"tsumo","actor":0,"pai":"5p"}"#));

        let (buf, _legal) = obs_and_legal_4p(&mut state, 0);
        let t = tile_dim(4);
        let base = last_discard_channel(4) * t;
        assert!(
            buf[base..base + t].iter().all(|v| *v == 0.0),
            "no discard on the table yet"
        );
    }
}
