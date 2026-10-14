# Audio agents Euterpe could port (research, 2026-10-06)

A web research agent's report on real-time music models with audio input and/or output that could run in the browser (Euterpe's worker, onnxruntime-web / TF.js). Check links and licences before relying on them; "unknown" means no source said.

## Ranked shortlist

| # | Model | Audio in → out | Size, speed, latency | Licence (code / weights) | Browser port | Verdict |
|---|---|---|---|---|---|---|
| 1 | Audio-to-notes front end: [PESTO](https://github.com/SonyCSLParis/pesto), [CREPE](https://github.com/marl/crepe), SPICE ([magenta.js](https://github.com/magenta/magenta-js)), [Basic Pitch](https://github.com/spotify/basic-pitch-ts) | mic → pitch / onsets / notes, feeding the note agents (BachDuet, GAPT, FolkDuet) | PESTO: <30k-130k params, streaming, <10 ms latency, ~12x real time on a CPU ([paper](https://arxiv.org/html/2508.01488v1)), ONNX export ~0.7 ms/frame. CREPE: 10 ms hop, tiny-full. Basic Pitch: <17k params, polyphonic but 2 s windows (not causal) | PESTO LGPL-3.0 (one model, MIR-1K, monophonic); CREPE MIT; magenta.js Apache-2.0; Basic Pitch Apache-2.0 | CREPE in TF.js (ml5), SPICE and Basic Pitch in TF.js, PESTO ONNX | **Easy**: needs resampling (16 / 22.05 kHz, now in Euterpe) and note segmentation |
| 2 | DDSP timbre transfer ([magenta/ddsp](https://github.com/magenta/ddsp)) | voice / instrument → violin, flute, sax, trumpet | 4 TF.js checkpoints ~3.9 MB each ([list](https://github.com/magenta/magenta-js/blob/master/music/checkpoints/README.md)); [DDSP-VST](https://magenta.tensorflow.org/ddsp-vst-blog): ~160k-param CREPE + small RNN at a 20 ms control rate, real time | Apache-2.0 / weights' licence not stated | magenta.js DDSP (whole clips, not streaming) | **Easy-Possible**: rewrite as a per-frame loop (pitch + loudness → one GRU step → harmonic + noise synth in renderAudio) |
| 3 | [BeatNet](https://github.com/mjhydri/BeatNet) online beat / downbeat / tempo / meter | mic → beat phase, tempo | 22.05 kHz, 93 ms window, 46 ms hop; network ~0.01 ms/frame, the particle filter dominates ([paper](https://arxiv.org/abs/2108.03576)); params unknown | CC-BY-4.0 | none | **Possible**: port the particle filter to JS; would let the clock follow the player |
| 4 | [GrooveTransformer](https://github.com/behzadhaki/MonotonicGrooveTransformer) | onsets (16th grid) → drum pattern | light enough for real time on a laptop ([NIME 2024](https://nime.org/proc/nime2024_39/)); size unknown | **no licence file**: ask the author | none (PyTorch, VST3 / Pd) | **Possible**, licence first; with an onset detector it is an audio-to-drums jam partner |
| 5 | [RAVE](https://github.com/acids-ircam/RAVE) | audio → audio (timbre transfer, latent generation) | 17.6M params (v1), ~20x real time at 48 kHz on a laptop CPU ([paper](https://arxiv.org/abs/2111.05011)); 2048-sample compression, ~245-440 ms end to end | CC-BY-NC-4.0 / community weights CC-BY-NC ([IIL](https://huggingface.co/Intelligent-Instruments-Lab/rave-models)) | no browser demo found; cached convolutions need explicit state for ONNX | **Possible with work**; latency and non-commercial licence |
| 6 | [BRAVE](https://github.com/fcaspe/BRAVE) (low-latency RAVE) | audio → audio | 4.9M params, ~10 ms latency, RTF 0.29 on an M1 Pro with 128-sample blocks, 44.1 kHz ([paper](https://arxiv.org/html/2503.11562v2)) | CC-BY-NC-4.0 / no pretrained weights found | weights export as plain .h5 for an RTNeural-style engine | **Possible**: train our own |
| 7 | [LLVC](https://github.com/KoeAI/LLVC) voice conversion | voice → one target voice | <20 ms at 16 kHz, ~2.8x real time on a CPU ([paper](https://arxiv.org/abs/2311.00873)) | MIT, weights included | ONNX export unknown | **Possible**; speech-trained, singing needs retraining |
| 8 | [Magenta RealTime 2](https://huggingface.co/google/magenta-realtime-2) small | text / audio style / MIDI → music | 230M (small) and 2.4B params, 40 ms frames, ~200 ms control latency, 48 kHz stereo, 64 RVQ levels; real time via MLX on Apple Silicon | Apache-2.0 / CC-BY-4.0 | none | **Unlikely in a browser now** (a WebGPU research project); the one to watch |

## Also considered, rejected

- **Magenta RT v1**: 800M params, needs a TPU ([page](https://magenta.tensorflow.org/magenta-realtime)); superseded.
- **Stable Audio Open Small**: 341M, batch text-to-audio, Stability Community Licence.
- **MusicGen**: runs in the browser via Transformers.js ([demo](https://huggingface.co/spaces/Xenova/musicgen-web)) but far from real time, not audio-reactive.
- **Neural codecs (EnCodec, DAC, SNAC, Mimi)**: not generative alone; Mimi streams in Transformers.js (80 ms frames), a possible decoder for a small token model.
- **RVC / so-vits-svc**: 170 ms on a GPU in RVC's own real-time GUI; browser tools only convert to ONNX; voice-rights issues.
- **HS-TasNet source separation**: 23 ms latency, but no official weights.
- **LiveBand (Sony CSL, 2026)**: audio-in/out causal accompaniment in ~93 ms ([arXiv](https://arxiv.org/abs/2606.03803)); no code or weights found.
- **StreamMUSE**: client-server; **ReaLJam**: symbolic (already ported as ReaLchords/GAPT).
- **Neutone**: LGPL-2.1, TorchScript, mostly RAVE models.
- **Essentia.js**: TF.js models and AudioWorklet examples, but analysis only, AGPL-3.0.
- **Neural Amp Modeler**: an effect; its [MIT WASM AudioWorklet runtime](https://github.com/tone-3000/neural-amp-modeler-wasm) shows WaveNet-style audio nets run in real time in a browser.

## Suggested order

1. Audio-to-notes front end (#1), optionally with BeatNet (#3): every existing note agent can then play with an acoustic instrument or a voice.
2. GrooveTransformer drums (#4) on top of it (licence permitting).
3. DDSP (#2) as the first audio-output agent.
4. RAVE / BRAVE with ONNX and explicit convolution-cache state (#5, #6).

Licence flags: RAVE, BRAVE, nn~ non-commercial (CC-BY-NC); PESTO LGPL; GrooveTransformer unlicensed.
