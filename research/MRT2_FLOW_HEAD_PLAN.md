# Plan: a one-step continuous head for Magenta RT 2 (to run in real time in Euterpe), then curve control

Draft, 2026-10-07. For a single RTX 3090 Ti. Estimates are marked as such; nothing here has been run yet.

## Why

In Euterpe's agent worker (WebGPU, `apps/mrt2/README.md`) MRT2-small generates at 0.74-0.84x real time. Per 40 ms frame:
the 230M temporal transformer takes ~8 ms; the 12 sequential depth-transformer calls (one RVQ level each) take ~30-35 ms;
SpectroStream decoding is ~90 ms per 0.4 s (fine). The 12 calls are the bottleneck.

SpectroStream's decoder takes a continuous 256-d vector per frame (the sum of the chosen RVQ codebook vectors), not
tokens. So: replace the 12-step depth decoding with a **head that maps the temporal transformer's hidden state h_t to
that 256-d latent z_t in one pass**. Estimated result: ~10 ms per frame, ~2x real time on the same laptop (estimate).

## Model

```text
previous frame ──► MRT2 temporal transformer (frozen at first; later LoRA) ──► h_t (1024-d)
                                        ▲ cross-attention: style (MusicCoCa), notes (pianoroll), drums, CFG, [curve]
h_t + noise ──► head (MLP or small DiT, 5-20M) ──► z_t (256-d) ──► SpectroStream decoder ──► 48 kHz stereo
```

- Target z_t: **the sum of the first 12 RVQ codebook vectors** of the real frame (what the decoder sees today), so the
  decoder stays on its training manifold. Later option: the encoder's pre-quantization latent (more detail, riskier).
- Feedback into the next frame: MRT2 expects the mean of the previous frame's 12 token embeddings. Two options:
  (a) re-quantize z_t to 12 tokens inside the same graph (12 nearest-neighbour searches on residuals: matmuls + argmax,
  one call) and feed tokens as now (no change to the transformer); (b) a small adapter from z_t to the input embedding
  (needs LoRA). Start with (a).

## Steps

### 0. Environment (0.5-1 day)
- PyTorch port of MRT2 with training code: https://github.com/multimodalart/magenta-realtime/tree/pytorch-port
  (`magenta_rt/torch/`: Depthformer `forward(cond, target)`, SpectroStream encoder/decoder, `lora.py`, `finetune.py`).
  Weights: https://huggingface.co/magenta-community/magenta-realtime-2-small (re-keyed Google weights, CC-BY 4.0:
  keep the attribution).
- Check parity once: generate a few seconds with the torch port and with the ONNX graphs (`apps/mrt2`) from the same
  seed/conditioning; listen; compare tokens where possible. The port claims logits within 5.8e-5 of JAX, 60/60 tokens
  identical end to end.

### 1. Data (1 day)
- 100-300 h to start. Openly licensed: Musopen (public-domain orchestral/chamber), MusicNet (34 h classical), the
  MTG-Jamendo CC subset; or your own. Classical music gives the dynamics/tempo variety the curve control needs later.
- Resample to 48 kHz stereo; cut into ~10-20 s clips (MRT2's context: 41-frame windows, ~20 s receptive field).

### 2. Encode with SpectroStream (hours, estimate)
- For each clip: the 12 RVQ codes per frame (int16), and z_t = sum of the 12 codebook vectors (fp16, 256-d).
  300 h x 25 Hz = 27M frames: codes ~650 MB, z ~14 GB in fp16.
- Also store the MusicCoCa style tokens per clip (the port has the text tower; the audio tower is in blanchon's ONNX:
  https://huggingface.co/blanchon/magenta-realtime-2-onnx), so style conditioning survives training.

### 3. Extract the temporal hidden states (hours, estimate)
- Run the frozen temporal transformer teacher-forced over the codes (the port's `forward`), conditioning = style tokens,
  notes/drums = unspecified (-1), CFG tokens sampled as in PR #95 (uniformly). Save h_t (1024-d fp16): 300 h = ~55 GB.
  If disk is tight, extract on the fly instead (one extra forward per batch; 230M fits easily).

### 4. Train the head with flow matching (1-2 days)
- Rectified-flow / conditional flow matching: z_0 ~ N(0, I), z_1 = target; train v(z_s, s, h_t) to predict z_1 - z_0.
- Head: an MLP with AdaLN conditioning on h_t (as in MAR's diffusion head), 5-20M params; batch of frames, not
  sequences (h_t already carries the context), so training is fast (estimate: many epochs per day on the 3090 Ti).
- Sampling for the listening test: 20-50 Euler steps first (quality ceiling), then fewer.

### 5. First listening test (the go / no-go)
- Free generation: temporal transformer + head (+ re-quantization) autoregressively, decode with SpectroStream, listen,
  side by side with MRT2's own 12-step sampling at the same style and seed.
- Measurements: per-level token agreement after re-quantization vs the data (teacher-forced), FAD or a CLAP/MusicCoCa
  style similarity vs MRT2 samples, and a few minutes of listening.
- Main failure mode: "averaged", smeared frames (one-step and few-step heads blur). If so: add an adversarial loss
  (as LiveBand does) or move to step 6 earlier.

### 6. One step (2-4 days)
- Consistency distillation from the 20-50-step head, or shortcut / rectified-flow distillation, or adversarial
  distillation. Target: 1 step, quality close to the multi-step head.

### 7. Curve control (about a week, separate experiment)
- Per frame, from the audio: intensity (RMS loudness + onset density + spectral centroid), register, density,
  brightness; normalized per clip (percentiles), smoothed/noised in training so a hand-drawn line is in distribution.
- Inject through MRT2's native per-frame path: add the curve as an extra conditioning channel in the cross-attention
  "source" (zero-initialised), plus LoRA. Control dropout ~0.15 with contiguous masks, so free generation still works;
  optionally a short look-ahead (the user draws ahead of the playhead).
- Metric: correlation between the drawn curve and the same descriptor measured on the generated audio.

### 8. Export and run in Euterpe (2-3 days)
- ONNX: temporal step (unchanged graph from the community port, plus the curve channel) and head + re-quantization in
  one graph; SpectroStream streaming decoder unchanged. Run as `apps/mrt2` does, with one call per frame.
- Euterpe side: a drawing-canvas widget that streams the curve (aligned to `ctx.audioOut.playTime()`, including what
  is drawn ahead of the playhead).
- Add a limiter: MRT2's output already peaks near or above full scale.

## Risks

- The PyTorch port has one maintainer; parity must be checked (step 0).
- One-step quality (averaging); feedback drift if the transformer sees continuous rather than sampled inputs (option (a)
  avoids it); the decoder's tolerance of off-manifold latents (re-quantization protects).
- MRT2's own training recipe (loss weights, dropout) is not published; we only train new parts at first.
- Browser speed is an estimate until step 8; the laptop showed large run-to-run variance.

## Order of value

Steps 0-5 answer the main question ("does a one-step continuous head sound good?") in about a week. Everything after
depends on that answer.
