# BRAVE, VampNet, solo-to-accompaniment audio, browser codecs (research, 2026-10-06)

Two web research agents' findings, kept for planning. Check links and licences before relying on them; "unknown" means no source said. Browser speeds are unmeasured for every codec and model here.

## BRAVE (Caspe et al.)

- **Weights:** none released ([issue 3](https://github.com/fcaspe/BRAVE/issues/3): "I dont have any pretrained models available for now"). Trained models (Latin drums, drum set, DX7 piano, vocals, sax, strings; 44.1/48 kHz) exist only compiled into the closed Minifusion Live plugin ([minifusion.live](https://minifusion.live)), whose licence forbids redistribution. Code CC BY-NC 4.0.
- **Architecture:** causal RAVE v1 variant, 44.1 kHz, 16-band PQMF, compression 128, 4.9M params (~20 MB fp32), receptive field ~517 ms, ~10 ms latency ([paper](https://arxiv.org/html/2503.11562v2), [brave.gin](https://github.com/fcaspe/BRAVE/blob/main/configs/brave.gin)). RTF on M1 Pro: Libtorch 1.18 at 128-sample blocks, 0.10 at 2048; RTNeural 0.29.
- **Port:** no ONNX export; upstream RAVE has `export_onnx.py`; streaming needs the conv caches as explicit state. Plausible on WASM with 2048-sample blocks.
- **Cost:** train our own: 1.5M steps per instrument on a GPU (paper: 4.5 h of sax, 2h50m of drums).

## VampNet (Flores García et al., ISMIR 2023) and TRIA

- **VampNet:** masked token infilling (variation, inpainting, continuation, "vamping") over its own DAC-style codec (44.1 kHz, 14 codebooks, 57 Hz) ([paper](https://arxiv.org/abs/2307.04686)). ~3 GB of weights ([HF](https://huggingface.co/hugggof/vampnet)); ~6 s per 10 s on an RTX 3090. Code MIT, weights non-commercial (stated inconsistently). Unloop sends each loop to a GPU server. **Not for the browser**; a Euterpe agent could call a GPU server per loop (latency 1-2 loop lengths).
- **TRIA** ([paper](https://arxiv.org/html/2509.15625v1), [code](https://github.com/interactiveaudiolab/tria)): rhythm prompt (tapping, beatboxing) + timbre prompt → drum audio; 43M params, public DAC 44 kHz codec ([ONNX](https://huggingface.co/onnx-community/dac_44khz-ONNX)); weights CC BY-NC-SA. **Plausible on WebGPU, untested.**

## Solo audio → accompaniment audio

No released model does it live. Most relevant (details and links in the agents' reports, summarised):

| System | In → out | Streaming | Release |
|---|---|---|---|
| [LiveBand](https://arxiv.org/html/2606.03803) (Sony CSL, 2026) | mix audio → one target stem (18 classes) | yes: causal ~150M transformer over a causal codec, RTF 1.1-2.1 on an RTX 3090, ~93 ms anticipation | no code or weights ([demo](https://sonycslparis.github.io/liveband-companion)) |
| [Streaming accompaniment](https://arxiv.org/abs/2510.22105) (Wu, ..., Huang) | stem → accompaniment over causal DAC | yes; shows plain maximum-likelihood training with real-time lookahead collapses to near-random pairing | samples only |
| [Magenta RealTime 2](https://magenta.withgoogle.com/magenta-realtime-2) | text / audio style / **MIDI pianoroll** → music, 40 ms frames, ~200 ms control latency | yes (live audio only as style, live jamming "future work") | code Apache-2.0, weights CC-BY 4.0; small 230M real time on an M1 Air; community browser port ([space](https://huggingface.co/spaces/magenta-community/magenta-rt-web), [ONNX](https://huggingface.co/magenta-community/magenta-rt-onnx-small), unverified) |
| [AnyAccomp](https://arxiv.org/html/2509.14052v1), [FastSAG](https://arxiv.org/html/2405.07682v1), [SingSong](https://ar5iv.labs.arxiv.org/html/2301.12662), [StemGen](https://ar5iv.labs.arxiv.org/html/2312.08723), Diff-A-Riff, JASCO, MusicGen-Stem | solo / vocals → accompaniment | offline (clips) | AnyAccomp weights CC-BY-4.0; others none or non-commercial |

## Codecs for encode + decode in the browser

| Codec | Audio | Frame rate | Params | Causal | Browser | Licence |
|---|---|---|---|---|---|---|
| **SpectroStream** ([paper](https://arxiv.org/html/2508.05207v1)) | 48 kHz stereo, music | 25 Hz, up to 64 RVQ (MRT2 uses 12) | 61M | yes, 80 ms | community ONNX (enc q8 10 MB, dec q8 40 MB, stateful stream) | CC-BY 4.0 |
| Mimi ([HF](https://huggingface.co/kyutai/mimi)) | 24 kHz mono, speech | 12.5 Hz | 96M | yes, 80 ms | Transformers.js, onnx-community | CC-BY 4.0 |
| DAC 44k ([repo](https://github.com/descriptinc/descript-audio-codec)) | 44.1 kHz mono | 86 Hz, 9 codebooks | unknown | no | Transformers.js, onnx-community | MIT |
| SNAC ([repo](https://github.com/hubertsiuzdak/snac)) | 32/44 kHz music | multi-scale 10-115 Hz | 54.5M | not documented | Transformers.js, onnx-community | MIT |

**Pick: SpectroStream** (music, full band, causal, 25 Hz, CC-BY, ONNX exists, shares MRT2's token space).

## Recommendation

1. **Now, low risk: hybrid symbolic + neural rendering.** Audio-to-notes (pitch tracking) → an existing note agent (BachDuet-style, beat-anticipating) → **MRT2-small renders the accompaniment notes as audio** via its pianoroll conditioning, instrumentation from a text/style prompt (piano, strings, pads), in the browser on WebGPU (community port), ~200 ms control latency hidden by beat anticipation. Risks: browser speed unverified, large download (~230 MB+ quantised), WebGPU required.
2. **Research: true audio → audio** in SpectroStream token space: causal 25 Hz transformer conditioned on the solo's embeddings, trained on Demucs-separated stems + Slakh + clean solos, with negative future visibility and a sequence-level / adversarial loss (LiveBand's lesson); budget ~100-250M params on WebGPU, ≤50M on WASM, + ~45M codec; end-to-end ~150-250 ms to be anticipated by the model. Big risk: anticipation / coherence; also speaker bleed (mic hears the output: echo cancellation or headphones).
