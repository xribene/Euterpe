/**
 * The live canvas's shared state (gui.liveCanvas): one small SharedArrayBuffer that the page writes (the line's
 * height, drawing mode, the tap key) and the agent's worker reads directly on every tick. Not the parameter ring
 * buffer: that one is polled every 100 ms and drops changes, while the canvas needs the current value at each tick.
 *
 * Layout: Int32 slots 0-7, Float32 slots 8-15 of the same 64-byte buffer.
 */
export const LIVE_CANVAS_BYTES = 64;

const I = {
    ARMED: 0, // 1: the canvas voice plays (the agent writes the user's notes from the line)
    PEN: 1, // 1: drawing mode is on
    KEY_HELD: 2, // 1: the tap key is down
    KEY_DOWNS: 3, // key presses so far
    MODEL: 4, // 0 'rules', 1 'onnx'
    SEQ: 5, // incremented on every write
};
const F = {
    HEIGHT: 8, // the line's height in semitones
};

export const LIVE_CANVAS_MODELS = ['rules', 'onnx'];

/**
 * Accessors over the shared buffer (both sides use the same object).
 * @param {SharedArrayBuffer} [sab] - The buffer; a new one if omitted (the page creates it).
 * @return {Object}
 */
export function liveCanvasState(sab = new SharedArrayBuffer(LIVE_CANVAS_BYTES)) {
    const ints = new Int32Array(sab, 0, 8);
    const floats = new Float32Array(sab, 32, 8);
    const touch = () => Atomics.add(ints, I.SEQ, 1);
    const setInt = (slot, value) => {
        Atomics.store(ints, slot, value);
        touch();
    };
    return {
        sab,
        get armed() {
            return Atomics.load(ints, I.ARMED) === 1;
        },
        set armed(on) {
            setInt(I.ARMED, on ? 1 : 0);
        },
        get pen() {
            return Atomics.load(ints, I.PEN) === 1;
        },
        set pen(on) {
            setInt(I.PEN, on ? 1 : 0);
        },
        get keyHeld() {
            return Atomics.load(ints, I.KEY_HELD) === 1;
        },
        set keyHeld(on) {
            if (on && Atomics.load(ints, I.KEY_HELD) !== 1) Atomics.add(ints, I.KEY_DOWNS, 1);
            setInt(I.KEY_HELD, on ? 1 : 0);
        },
        get keyDowns() {
            return Atomics.load(ints, I.KEY_DOWNS);
        },
        get model() {
            return LIVE_CANVAS_MODELS[Atomics.load(ints, I.MODEL)] ?? 'rules';
        },
        set model(name) {
            setInt(I.MODEL, Math.max(0, LIVE_CANVAS_MODELS.indexOf(name)));
        },
        get height() {
            return floats[F.HEIGHT - 8];
        },
        set height(semitones) {
            floats[F.HEIGHT - 8] = semitones;
            touch();
        },
        get seq() {
            return Atomics.load(ints, I.SEQ);
        },
        /** Everything at once, as plain values. */
        read() {
            return {armed: this.armed, pen: this.pen, keyHeld: this.keyHeld, keyDowns: this.keyDowns,
                model: this.model, height: this.height};
        },
    };
}
