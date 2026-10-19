//! Test-only helper: build an [`Engine`] from the model weights shipped in the
//! repository (`<repo>/models/akagi{4,3}p.safetensors`).
//!
//! The weights are small (a couple of MB) and the same files the app loads, so
//! the engine tests exercise the real model rather than a fixture.

use std::path::PathBuf;

use anyhow::{Context, Result};

use crate::engine::Engine;

fn model_path(num_players: u8) -> PathBuf {
    let name = if num_players == 3 {
        "akagi3p.safetensors"
    } else {
        "akagi4p.safetensors"
    };
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../models")
        .join(name)
}

/// Loads the bundled weights for `num_players` and seats the engine at `seat`.
pub fn engine(num_players: u8, seat: u8) -> Result<Engine> {
    let path = model_path(num_players);
    let bytes = std::fs::read(&path)
        .with_context(|| format!("bundled weights missing at {}", path.display()))?;
    Engine::new(bytes, num_players, seat)
}
