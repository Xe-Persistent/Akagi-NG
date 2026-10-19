//! End-to-end numeric parity: the candle loader must reproduce the PyTorch
//! (folded) reference logits for a deterministic input, so the `models/*.safetensors`
//! shipped with the app are provably the ones this engine evaluates.
//!
//! Ported from Akagi's `native_bot/tests/parity.rs` (Apache-2.0); the fixtures in
//! `tests/fixtures/` are the reference JSONs `train/parity_check.py` writes next
//! to those weights upstream.

use std::fs;
use std::path::Path;

use rust_engine::model::Model;

fn floats(v: &serde_json::Value) -> Vec<f32> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|x| x.as_f64().unwrap() as f32)
        .collect()
}

fn argmax(v: &[f32]) -> usize {
    v.iter()
        .enumerate()
        .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
        .unwrap()
        .0
}

fn check(model_file: &str, parity_file: &str, num_players: u8) {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let bytes = fs::read(root.join("models").join(model_file)).expect("bundled weights present");
    let model = Model::from_safetensors(bytes, num_players).expect("load model");

    let json: serde_json::Value = serde_json::from_slice(
        &fs::read(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("tests/fixtures")
                .join(parity_file),
        )
        .expect("parity fixture present"),
    )
    .unwrap();
    let input = floats(&json["input"]);
    let reference = floats(&json["logits"]);

    let got = model.forward_logits(&input).expect("forward");
    assert_eq!(got.len(), reference.len(), "logit length mismatch");

    let max_diff = got
        .iter()
        .zip(&reference)
        .map(|(a, b)| (a - b).abs())
        .fold(0.0f32, f32::max);
    assert_eq!(
        argmax(&got),
        json["argmax"].as_u64().unwrap() as usize,
        "candle argmax differs from PyTorch"
    );
    assert!(
        max_diff < 2e-3,
        "candle vs PyTorch logit diff too large: {max_diff}"
    );
    eprintln!("{model_file}: candle/PyTorch max|diff| = {max_diff:.2e}, argmax matches");
}

#[test]
fn parity_4p() {
    check("akagi4p.safetensors", "parity_4p.json", 4);
}

#[test]
fn parity_3p() {
    check("akagi3p.safetensors", "parity_3p.json", 3);
}
