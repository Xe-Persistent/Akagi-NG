//! candle CNN inference. Architecture mirrors `train/train.py` **after** its
//! BatchNorm-folding export, so this side is pure Conv1d + Linear (no BN op).
//!
//! Weights are loaded from a `.safetensors` buffer whose keys are:
//! `conv_in.{weight,bias}`, `res.{i}.conv{1,2}.{weight,bias}`,
//! `fc.{weight,bias}`, `head.{weight,bias}`.

use candle_core::{Device, Result, Tensor};
use candle_nn::{conv1d, linear, Conv1d, Conv1dConfig, Linear, Module, VarBuilder};

use crate::Geometry;

/// Backbone width / depth / head — MUST match `train/train.py`.
pub const CONV: usize = 64;
pub const BLOCKS: usize = 3;
pub const FC: usize = 256;

pub struct Model {
    conv_in: Conv1d,
    res: Vec<(Conv1d, Conv1d)>,
    fc: Linear,
    head: Linear,
    geo: Geometry,
}

impl Model {
    /// Build the model for `num_players` from a safetensors byte buffer.
    pub fn from_safetensors(bytes: Vec<u8>, num_players: u8) -> Result<Self> {
        let dev = Device::Cpu;
        let vb = VarBuilder::from_buffered_safetensors(bytes, candle_core::DType::F32, &dev)?;
        let geo = Geometry::for_players(num_players);
        let cfg = Conv1dConfig {
            padding: 1,
            ..Default::default()
        };

        let conv_in = conv1d(geo.channels, CONV, 3, cfg, vb.pp("conv_in"))?;
        let mut res = Vec::with_capacity(BLOCKS);
        for i in 0..BLOCKS {
            let b = vb.pp(format!("res.{i}"));
            let c1 = conv1d(CONV, CONV, 3, cfg, b.pp("conv1"))?;
            let c2 = conv1d(CONV, CONV, 3, cfg, b.pp("conv2"))?;
            res.push((c1, c2));
        }
        let fc = linear(CONV * geo.tile_dim, FC, vb.pp("fc"))?;
        let head = linear(FC, geo.action_space, vb.pp("head"))?;

        Ok(Self {
            conv_in,
            res,
            fc,
            head,
            geo,
        })
    }

    pub fn geometry(&self) -> Geometry {
        self.geo
    }

    /// Forward one flattened `[C*T]` observation to action logits `[A]`.
    pub fn forward_logits(&self, obs: &[f32]) -> Result<Vec<f32>> {
        let dev = Device::Cpu;
        let x = Tensor::from_vec(
            obs.to_vec(),
            (1, self.geo.channels, self.geo.tile_dim),
            &dev,
        )?;
        let mut x = self.conv_in.forward(&x)?.relu()?;
        for (c1, c2) in &self.res {
            let y = c1.forward(&x)?.relu()?;
            let y = c2.forward(&y)?;
            x = y.add(&x)?.relu()?;
        }
        let x = x.flatten_from(1)?;
        let x = self.fc.forward(&x)?.relu()?;
        let logits = self.head.forward(&x)?;
        logits.squeeze(0)?.to_vec1::<f32>()
    }
}
