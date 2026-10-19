//! Action indexing shared by extraction, training, and inference.
//!
//! We reuse riichienv-core's canonical action encoding so our labels line up
//! with its legal-action enumeration:
//! - 4-player: 82 ids (`Action::encode`) — 0..=33 discard tile34, 37 riichi,
//!   38/39/40 chi lo/mid/hi, 41 pon, 42..=75 kan (=42+tile34), 79 agari,
//!   80 kyushu, 81 pass.
//! - 3-player: 60 ids (`ActionEncoder::ThreePlayer`) — 0..=26 discard compact,
//!   27 riichi, 28 pon, 29..=55 kan, 56 agari, 57 kyushu, 58 pass, 59 kita.

use std::collections::btree_map::Entry;
use std::collections::BTreeMap;

use riichienv_core::action::{Action, ActionEncoder, ActionType, ACTION_SPACE_3P, ACTION_SPACE_4P};

use crate::tiles::is_aka;

/// Size of the discrete action space for the given player count.
pub fn action_space(num_players: u8) -> usize {
    if num_players == 3 {
        ACTION_SPACE_3P
    } else {
        ACTION_SPACE_4P
    }
}

/// Action id of `Pass` for the given player count (81 for 4p, 58 for 3p).
pub fn pass_index(num_players: u8) -> usize {
    if num_players == 3 {
        58
    } else {
        81
    }
}

/// Index of an action in the mode-appropriate action space, or `None` if the
/// action is invalid for that mode (e.g. chi in sanma).
pub fn action_index(action: &Action, num_players: u8) -> Option<usize> {
    ActionEncoder::from_num_players(num_players)
        .encode(action)
        .ok()
        .map(|i| i as usize)
}

/// Build a legal-action mask (`1` = legal) of length [`action_space`].
pub fn legal_mask(legal: &[Action], num_players: u8) -> Vec<u8> {
    let mut mask = vec![0u8; action_space(num_players)];
    for a in legal {
        if let Some(idx) = action_index(a, num_players) {
            mask[idx] = 1;
        }
    }
    mask
}

/// Whether this action throws a **red five** away. `Action::encode` maps a
/// discard to `tile34 = tid / 4`, so discarding `5mr` (tid 16) and discarding a
/// plain `5m` (tid 17..19) share one action id and therefore one logit. When a
/// hand holds both copies, the model's "discard the five" prediction must not be
/// resolved to the red one — that silently throws away a guaranteed dora.
///
/// Only *discards* matter: a red five consumed into our own pon/chi/kan stays
/// ours and keeps counting as dora, so those need no preference.
fn discards_aka(a: &Action) -> bool {
    a.action_type == ActionType::Discard && a.tile.is_some_and(is_aka)
}

/// Legal actions ranked by logit, highest first, **one entry per action id**.
///
/// riichienv enumerates one `Action` per physical tile copy, so several legal
/// actions can share an id (and thus a logit): the red five and its plain twins,
/// or the two ways to pon a tile you hold three of. We collapse them to a single
/// representative — never the red-five discard when a plain copy is available
/// (see [`discards_aka`]) — so:
/// - the chosen move never spends a red five it didn't have to, and
/// - the softmax has one term per *move*, not per physical tile, which is what
///   the HUD's top-N card and the remote API's candidate distribution mean.
///
/// `prob` is the softmax over the deduplicated legal set. Ties break on action
/// id (ascending), which is deterministic and keeps [`pick_by_logits`] in
/// agreement with `rank_by_logits(..)[0]`.
fn rank_all(legal: &[Action], logits: &[f32], num_players: u8) -> Vec<(Action, f32)> {
    // BTreeMap: iteration is by action id, making the tie order deterministic.
    let mut by_id: BTreeMap<usize, &Action> = BTreeMap::new();
    for a in legal {
        let Some(idx) = action_index(a, num_players) else {
            continue;
        };
        match by_id.entry(idx) {
            Entry::Vacant(e) => {
                e.insert(a);
            }
            Entry::Occupied(mut e) => {
                // Same move, different physical tile: prefer the non-red copy.
                if discards_aka(e.get()) && !discards_aka(a) {
                    e.insert(a);
                }
            }
        }
    }
    if by_id.is_empty() {
        return Vec::new();
    }

    let scored: Vec<(&Action, f32)> = by_id
        .into_iter()
        .map(|(idx, a)| (a, logits.get(idx).copied().unwrap_or(f32::NEG_INFINITY)))
        .collect();
    let max_logit = scored
        .iter()
        .map(|(_, l)| *l)
        .fold(f32::NEG_INFINITY, f32::max);
    let exps: Vec<f32> = scored.iter().map(|(_, l)| (l - max_logit).exp()).collect();
    let sum: f32 = exps.iter().sum();

    // Stable sort by logit desc: ties keep the input (action-id) order.
    let mut order: Vec<usize> = (0..scored.len()).collect();
    order.sort_by(|&a, &b| {
        scored[b]
            .1
            .partial_cmp(&scored[a].1)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    order
        .into_iter()
        .map(|i| {
            let prob = if sum > 0.0 { exps[i] / sum } else { 0.0 };
            (scored[i].0.clone(), prob)
        })
        .collect()
}

/// Choose the legal action whose logit is highest.
///
/// `logits` must be indexed by the mode's action space. Illegal indices are
/// never considered, so the returned action is always legal. Returns `None`
/// only if `legal` is empty. Equivalent to `rank_by_logits(..)[0]`, red-five
/// preference included.
pub fn pick_by_logits(legal: &[Action], logits: &[f32], num_players: u8) -> Option<Action> {
    rank_all(legal, logits, num_players)
        .into_iter()
        .next()
        .map(|(a, _)| a)
}

/// Rank legal actions by logit (highest first) and return the top `top_n` as
/// `(action, prob)` pairs, where `prob` is the softmax of the logits taken
/// **over the legal actions only** (same normalization the remote API uses for
/// its candidate distribution). The first element matches [`pick_by_logits`].
pub fn rank_by_logits(
    legal: &[Action],
    logits: &[f32],
    num_players: u8,
    top_n: usize,
) -> Vec<(Action, f32)> {
    let mut ranked = rank_all(legal, logits, num_players);
    ranked.truncate(top_n);
    ranked
}

#[cfg(test)]
mod tests {
    use super::*;
    use riichienv_core::action::{Action, ActionType};

    #[test]
    fn discard_index_is_tile34_4p() {
        // discard 5s (tile id 88 -> tile34 22)
        let a = Action::new(ActionType::Discard, Some(88), vec![], Some(0));
        assert_eq!(action_index(&a, 4), Some(22));
    }

    #[test]
    fn riichi_pon_pass_indices_4p() {
        assert_eq!(
            action_index(&Action::new(ActionType::Riichi, None, vec![], Some(0)), 4),
            Some(37)
        );
        assert_eq!(
            action_index(
                &Action::new(ActionType::Pon, Some(0), vec![1, 2], Some(0)),
                4
            ),
            Some(41)
        );
        assert_eq!(
            action_index(&Action::new(ActionType::Pass, None, vec![], Some(0)), 4),
            Some(81)
        );
    }

    #[test]
    fn discard_index_compact_3p() {
        // discard 1p (tile id 36 -> tile34 9 -> compact 2)
        let a = Action::new(ActionType::Discard, Some(36), vec![], Some(0));
        assert_eq!(action_index(&a, 3), Some(2));
        // chi is invalid in sanma
        let chi = Action::new(ActionType::Chi, Some(0), vec![4, 8], Some(0));
        assert_eq!(action_index(&chi, 3), None);
    }

    #[test]
    fn mask_and_pick() {
        let legal = vec![
            Action::new(ActionType::Discard, Some(0), vec![], Some(0)), // idx 0
            Action::new(ActionType::Pon, Some(4), vec![5, 6], Some(0)), // idx 41
            Action::new(ActionType::Pass, None, vec![], Some(0)),       // idx 81
        ];
        let mask = legal_mask(&legal, 4);
        assert_eq!(mask.len(), 82);
        assert_eq!(mask[0], 1);
        assert_eq!(mask[41], 1);
        assert_eq!(mask[81], 1);
        assert_eq!(mask[1], 0);

        let mut logits = vec![0.0f32; 82];
        logits[41] = 5.0; // prefer pon
        let picked = pick_by_logits(&legal, &logits, 4).unwrap();
        assert_eq!(picked.action_type, ActionType::Pon);
    }

    #[test]
    fn rank_orders_by_logit_and_normalizes_over_legal() {
        let legal = vec![
            Action::new(ActionType::Discard, Some(0), vec![], Some(0)), // idx 0
            Action::new(ActionType::Pon, Some(4), vec![5, 6], Some(0)), // idx 41
            Action::new(ActionType::Pass, None, vec![], Some(0)),       // idx 81
        ];
        let mut logits = vec![0.0f32; 82];
        logits[0] = 1.0;
        logits[41] = 3.0; // highest → ranked first
        logits[81] = 2.0;

        let ranked = rank_by_logits(&legal, &logits, 4, 3);
        assert_eq!(ranked.len(), 3);
        assert_eq!(ranked[0].0.action_type, ActionType::Pon);
        assert_eq!(ranked[1].0.action_type, ActionType::Pass);
        assert_eq!(ranked[2].0.action_type, ActionType::Discard);
        // Probs are a descending softmax that sums to ~1 over the legal set.
        assert!(ranked[0].1 > ranked[1].1 && ranked[1].1 > ranked[2].1);
        let sum: f32 = ranked.iter().map(|(_, p)| p).sum();
        assert!((sum - 1.0).abs() < 1e-5, "probs should sum to 1, got {sum}");
        // The top of the ranking matches pick_by_logits.
        let picked = pick_by_logits(&legal, &logits, 4).unwrap();
        assert_eq!(picked.action_type, ranked[0].0.action_type);
    }

    #[test]
    fn rank_top_n_truncates() {
        let legal = vec![
            Action::new(ActionType::Discard, Some(0), vec![], Some(0)),
            Action::new(ActionType::Discard, Some(4), vec![], Some(0)),
            Action::new(ActionType::Discard, Some(8), vec![], Some(0)),
        ];
        let logits = vec![0.0f32; 82];
        assert_eq!(rank_by_logits(&legal, &logits, 4, 2).len(), 2);
        assert!(rank_by_logits(&[], &logits, 4, 3).is_empty());
    }

    /// Regression: `5mr` (tid 16) and plain `5m` (tid 17..19) encode to the same
    /// action id (4) and therefore carry the same logit. riichienv enumerates the
    /// hand in sorted order, so the red copy came first and the old
    /// "first of an equal score wins" tie-break discarded the red five on every
    /// "cut a 5m" prediction — throwing away a guaranteed dora.
    #[test]
    fn discard_five_prefers_the_plain_copy_over_the_red_one() {
        let aka = Action::new(ActionType::Discard, Some(16), vec![], Some(0)); // 5mr
        let plain = Action::new(ActionType::Discard, Some(17), vec![], Some(0)); // 5m
        let other = Action::new(ActionType::Discard, Some(0), vec![], Some(0)); // 1m
        let mut logits = vec![0.0f32; 82];
        logits[4] = 3.0; // "discard a 5m" is the model's top move
        logits[0] = 1.0;

        // Red copy listed first, exactly as the sorted hand yields it.
        let legal = vec![aka.clone(), plain.clone(), other.clone()];
        let picked = pick_by_logits(&legal, &logits, 4).unwrap();
        assert_eq!(picked.tile, Some(17), "must discard the plain 5m, not 5mr");

        // Order-independent: the plain copy wins whichever way they're listed.
        let legal = vec![plain, aka, other];
        let picked = pick_by_logits(&legal, &logits, 4).unwrap();
        assert_eq!(picked.tile, Some(17));
    }

    /// When the red five is the *only* copy of that tile in hand, it is still a
    /// legal discard and must be chosen — the preference is a tie-break, not a ban.
    #[test]
    fn lone_red_five_is_still_discardable() {
        let legal = vec![
            Action::new(ActionType::Discard, Some(16), vec![], Some(0)), // only 5mr
            Action::new(ActionType::Discard, Some(0), vec![], Some(0)),
        ];
        let mut logits = vec![0.0f32; 82];
        logits[4] = 5.0;
        let picked = pick_by_logits(&legal, &logits, 4).unwrap();
        assert_eq!(picked.tile, Some(16));
    }

    /// Regression: physical tile copies used to each get their own candidate row
    /// and their own softmax term, so a hand holding three East showed "discard
    /// E" three times, each with a third of the tile's true probability.
    #[test]
    fn candidates_are_deduplicated_per_action_id() {
        let east = |tid| Action::new(ActionType::Discard, Some(tid), vec![], Some(0));
        let legal = vec![
            east(108), // E ×3, all action id 27
            east(109),
            east(110),
            Action::new(ActionType::Discard, Some(0), vec![], Some(0)), // 1m, id 0
        ];
        let mut logits = vec![0.0f32; 82];
        logits[27] = 2.0;
        logits[0] = 1.0;

        let ranked = rank_by_logits(&legal, &logits, 4, 3);
        assert_eq!(ranked.len(), 2, "three E copies collapse to one candidate");
        assert_eq!(ranked[0].0.tile, Some(108));
        // Softmax over {E, 1m}: e^2/(e^2+e^1) ≈ 0.731, not split three ways.
        assert!(
            (ranked[0].1 - 0.7310586).abs() < 1e-5,
            "prob must not be split across physical copies, got {}",
            ranked[0].1
        );
        let sum: f32 = ranked.iter().map(|(_, p)| p).sum();
        assert!((sum - 1.0).abs() < 1e-5, "probs sum to 1, got {sum}");
    }

    /// `pick_by_logits` and `rank_by_logits(..)[0]` must never disagree — the
    /// engine uses the first for the reach-discard prediction and the second for
    /// the played move.
    #[test]
    fn pick_agrees_with_rank_head_on_ties() {
        let legal = vec![
            Action::new(ActionType::Pass, None, vec![], Some(0)), // id 81
            Action::new(ActionType::Pon, Some(4), vec![5, 6], Some(0)), // id 41
        ];
        let logits = vec![0.0f32; 82]; // everything tied
        let picked = pick_by_logits(&legal, &logits, 4).unwrap();
        let ranked = rank_by_logits(&legal, &logits, 4, 2);
        assert_eq!(picked.action_type, ranked[0].0.action_type);
        // Lowest action id wins a tie: pon (41) before pass (81).
        assert_eq!(picked.action_type, ActionType::Pon);
    }
}
