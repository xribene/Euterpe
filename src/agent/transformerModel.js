/**
 * BachDuet's causal transformer (bachduet-v2, bdv2/models/transformer.py) running in the agent worker with
 * onnxruntime-web (WASM backend). Exported by bdv2/export_onnx.py in xribene/bachduet-v2 as a decode-step graph
 * with a fixed-size KV cache (the last 255 steps per layer; ALiBi attention over a 256-step window).
 *
 * Unlike the LSTMs it has no recurrent state: a stream's state is the attention cache of its token history
 * (BachDuet's stream and the role-swapped stream, run together as a batch of 2). "Primed" = the history starts
 * with the 4-bar chorale primer for the starting key (primers.json), fed through the model at reset.
 * The step costs ~2 ms in WASM; recomputing the whole 256-step window every tick (what bdv2's eval suite does)
 * would cost ~120 ms. Both are identical for the first 16 bars; after that the cache drifts slightly (see
 * export_onnx.py).
 */
// ORT settings (WASM paths, thread count: 1 unless ?ortThreads=N) are shared with the chord models (ortEnv.js).
// One thread is plenty here: a step is tiny, and TF.js has its own thread pool.
import {ort} from './ortEnv.js';

/**
 * The state of the two streams (row 0: BachDuet, row 1: the role-swapped stream that predicts the user): their
 * attention caches, how many steps they hold, and the token history (the last `window` steps, for inspection).
 */
export class TransformerState {
    constructor(model) {
        const n = model.layers * 2 * model.heads * model.cacheSteps * model.headDim;
        const dims = [model.layers, 2, model.heads, model.cacheSteps, model.headDim];
        this.pastK = new ort.Tensor('float32', new Float32Array(n), dims);
        this.pastV = new ort.Tensor('float32', new Float32Array(n), dims);
        this.length = 0;
        this.history = [];
        this.primed = false;
    }
}

// Copies a state's caches and history into another state (the ort tensors are replaced, not shared)
function copyState(from, to) {
    to.pastK = new ort.Tensor('float32', from.pastK.data.slice(), from.pastK.dims);
    to.pastV = new ort.Tensor('float32', from.pastV.data.slice(), from.pastV.dims);
    to.length = from.length;
    to.history = from.history.map((step) => step.slice());
    to.primed = from.primed;
}

export class TransformerModel {
    /**
     * Loads model.onnx and primers.json from `dir` and warms the session up.
     * @param {string} dir
     * @return {Promise<TransformerModel>}
     */
    static async load(dir) {
        const [session, primers] = await Promise.all([
            ort.InferenceSession.create(`${dir}/model.onnx`, {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all',
            }),
            fetch(`${dir}/primers.json`).then((response) => response.json()),
        ]);
        const model = new TransformerModel(session, primers);
        await model.warmup();
        return model;
    }

    constructor(session, primers) {
        this.session = session;
        this.primers = primers;
        this.window = primers.window;
        this.layers = primers.layers;
        this.heads = primers.heads;
        this.cacheSteps = primers.cacheSteps;
        this.headDim = primers.headDim;
        // runs are serialised (one session; a tick waits for a reset's priming to finish)
        this.busy = Promise.resolve();
    }

    async warmup() {
        const state = new TransformerState(this);
        const rest = [0, 0, 12, 12, 0];
        const times = [];
        for (let i = 0; i < 5; i++) {
            const start = performance.now();
            await this.step(state, rest, rest);
            times.push(performance.now() - start);
        }
        console.log(`Transformer warmup (onnxruntime-web ${ort.env.versions?.web ?? ''} wasm, ` +
            `${ort.env.wasm.numThreads} thread): ` + times.map((t) => t.toFixed(1)).join(', ') + ' ms');
    }

    /**
     * A new state for a starting key, primed in the background (steps queue behind the priming): BachDuet's
     * stream gets the primer for the voice the user starts on, the role-swapped stream the primer for the other
     * voice (the same chorale with the roles swapped). Unknown key -> empty history.
     * @param {string|null} key - canonical key name ('C# major')
     * @param {string} voice - 'upper' or 'lower' (the voice the USER starts on)
     * @return {TransformerState}
     */
    newState(key, voice) {
        const state = new TransformerState(this);
        const find = (v) => this.primers.entries.find((e) => e.key === key && e.voice === v);
        const agent = find(voice);
        const swap = find(voice === 'upper' ? 'lower' : 'upper');
        if (agent && swap && agent.steps.length === swap.steps.length) {
            state.primed = true;
            // a primed state is computed once per key and voice, then copied: a Reset during play (it takes effect
            // on the next downbeat) must not hold that tick up for the ~130 ms of priming
            this.primedCache ??= {};
            const id = `${key}|${voice}`;
            const cached = this.primedCache[id];
            if (cached) {
                copyState(cached, state);
                return state;
            }
            const start = performance.now();
            agent.steps.forEach((step, t) => this.step(state, step, swap.steps[t]));
            this.busy.then(() => {
                const copy = new TransformerState(this);
                copyState(state, copy);
                this.primedCache[id] = copy;
                console.log(`Transformer primed for ${key} ` +
                    `(${agent.steps.length} steps, ${(performance.now() - start).toFixed(0)} ms)`);
            });
        }
        return state;
    }

    /**
     * One step of both streams; updates `state` and resolves to [BachDuet's logits, the swapped stream's logits].
     * @param {TransformerState} state
     * @param {Array<number>} agentStep - [agentTok, userTok, agentPc, userPc, rhythm] for BachDuet's stream
     * @param {Array<number>} swapStep - the same for the role-swapped stream
     * @return {Promise<Array<Float32Array>>}
     */
    step(state, agentStep, swapStep) {
        const result = this.busy.then(() => this._step(state, agentStep, swapStep));
        this.busy = result.catch(() => {});
        return result;
    }

    async _step(state, agentStep, swapStep) {
        const i64 = (k) => new ort.Tensor('int64', BigInt64Array.of(BigInt(agentStep[k]), BigInt(swapStep[k])), [2]);
        const len = BigInt(state.length);
        const out = await this.session.run({
            agent_tok: i64(0), user_tok: i64(1), agent_pc: i64(2), user_pc: i64(3), rhythm: i64(4),
            past_k: state.pastK, past_v: state.pastV,
            past_len: new ort.Tensor('int64', BigInt64Array.of(len, len), [2]),
        });
        state.pastK = out.new_k;
        state.pastV = out.new_v;
        state.length = Math.min(state.length + 1, this.cacheSteps);
        state.history.push(agentStep);
        if (state.history.length > this.window) state.history.shift();
        const V = out.logits.dims[1];
        return [out.logits.data.slice(0, V), out.logits.data.slice(V, 2 * V)];
    }
}
