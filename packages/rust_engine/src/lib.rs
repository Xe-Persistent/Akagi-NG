#![deny(clippy::all)]

#[macro_use]
extern crate napi_derive;

pub mod action_codec;
pub mod adapt;
pub mod engine;
pub mod mjai_compat;
pub mod model;
pub mod obs;
pub mod replay;
pub mod tiles;

use napi::bindgen_prelude::*;

/// Feature-plane and action-space geometry for a given player count.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Geometry {
    pub num_players: u8,
    pub channels: usize,
    pub tile_dim: usize,
    pub action_space: usize,
}

impl Geometry {
    pub fn for_players(num_players: u8) -> Self {
        Self {
            num_players,
            channels: obs::channels(num_players),
            tile_dim: tiles::tile_dim(num_players),
            action_space: action_codec::action_space(num_players),
        }
    }
}


#[napi(js_name = "AkagiEngine")]
pub struct JsAkagiEngine {
    inner: engine::Engine,
}

#[napi]
impl JsAkagiEngine {
    #[napi(constructor)]
    pub fn new(model_bytes: Buffer, num_players: u8, seat: u8) -> Result<Self> {
        let engine = engine::Engine::new(model_bytes.to_vec(), num_players, seat)
            .map_err(|e| Error::from_reason(format!("Init failed: {}", e)))?;
        Ok(Self { inner: engine })
    }

    #[napi]
    pub fn reset(&mut self) {
        self.inner.reset();
    }

    #[napi]
    pub fn set_seat(&mut self, seat: u8) {
        self.inner.set_seat(seat);
    }

    #[napi]
    pub fn feed_line(&mut self, line: String) -> bool {
        self.inner.feed_line(&line)
    }

    #[napi]
    pub fn decide(&mut self) -> Result<Option<String>> {
        let decision = self.inner.decide()
            .map_err(|e| Error::from_reason(format!("Decide failed: {}", e)))?;
        match decision {
            Some(d) => {
                let s = serde_json::to_string(&d)
                    .map_err(|e| Error::from_reason(format!("Serialize failed: {}", e)))?;
                Ok(Some(s))
            }
            None => Ok(None)
        }
    }
}
