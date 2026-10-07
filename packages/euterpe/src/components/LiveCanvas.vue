<template>
    <div class="liveCanvas" ref="wrapper" data-testid="euterpe-live-canvas"
        :style="{width: options.width + 'px'}" @mousedown="startDrag">
        <div class="lcHeader">
            <span class="lcTitle">Live canvas</span>
            <label class="lcControl" title="The canvas plays your part">
                <input type="checkbox" v-model="armed" data-testid="euterpe-live-canvas-arm"
                    @change="controller.setArmed(armed)" @keydown.stop>
                voice
            </label>
            <label class="lcControl">
                model
                <select v-model="model" data-testid="euterpe-live-canvas-model"
                    @change="controller.setModel(model)" @keydown.stop>
                    <option value="rules">rules</option>
                    <option value="onnx">Draw &amp; Listen</option>
                </select>
            </label>
            <span class="lcStatus" data-testid="euterpe-live-canvas-status">{{ status }}</span>
        </div>
        <div class="lcStage" :style="{height: options.height + 'px'}">
            <canvas ref="canvas" :width="options.width" :height="options.height"></canvas>
            <button class="lcPen" :class="{on: pen}" data-testid="euterpe-live-canvas-pen"
                :title="pen ? 'Click or Esc to stop drawing' : 'Draw: move the mouse up and down'"
                @click.stop="togglePen" @mousedown.stop>
                {{ pen ? 'drawing' : 'draw' }}
            </button>
        </div>
        <div class="lcHint">
            Click <b>draw</b>, then move the mouse up and down (click or Esc to stop).
            Hold <b>{{ tapKeyLabel }}</b> to play a note now.
        </div>
    </div>
</template>

<script>
/**
 * The live canvas (gui.liveCanvas): the line scrolls right to left past the "now" marker in time with the clock,
 * with the beats and bars; the user's canvas notes and the agent's notes are drawn behind it. State and timing are
 * in utils/liveCanvas.js (the controller).
 */
import '../css/variables.css';

export default {
    name: 'LiveCanvas',
    props: {
        controller: {type: Object, required: true},
    },
    data() {
        return {
            options: this.controller.options,
            pen: false,
            armed: this.controller.options.armed,
            model: this.controller.options.model,
            status: '',
        };
    },
    computed: {
        tapKeyLabel() {
            return String(this.options.tapKey).toUpperCase();
        },
    },
    mounted() {
        this.ctx2d = this.$refs.canvas.getContext('2d');
        this.onMouseMove = (e) => {
            if (this.pen) this.controller.move(e.movementY);
        };
        this.onLockChange = () => {
            const locked = document.pointerLockElement === this.$refs.canvas;
            if (this.wasLocked && !locked) this.setPen(false);
            this.wasLocked = locked;
        };
        this.onMouseDown = () => {
            // a click while drawing (pointer locked) ends it
            if (this.pen && document.pointerLockElement === this.$refs.canvas) this.setPen(false);
        };
        this.onKeyDown = (e) => {
            if (e.key === 'Escape' && this.pen) this.setPen(false);
        };
        document.addEventListener('mousemove', this.onMouseMove);
        document.addEventListener('pointerlockchange', this.onLockChange);
        document.addEventListener('mousedown', this.onMouseDown);
        document.addEventListener('keydown', this.onKeyDown);
        this.raf = requestAnimationFrame(this.draw);
    },
    beforeDestroy() {
        cancelAnimationFrame(this.raf);
        if (document.pointerLockElement === this.$refs.canvas) document.exitPointerLock();
        document.removeEventListener('mousemove', this.onMouseMove);
        document.removeEventListener('pointerlockchange', this.onLockChange);
        document.removeEventListener('mousedown', this.onMouseDown);
        document.removeEventListener('keydown', this.onKeyDown);
    },
    methods: {
        togglePen() {
            this.setPen(!this.pen);
        },
        setPen(on) {
            this.pen = on;
            this.controller.setPen(on);
            const canvas = this.$refs.canvas;
            if (on) {
                // only vertical movement counts; without the lock (refused), movement over the page still does
                try {
                    const request = canvas.requestPointerLock?.();
                    request?.catch?.(() => {});
                } catch (error) {
                    // drawing goes on without the lock
                }
            } else if (document.pointerLockElement === canvas) {
                document.exitPointerLock();
            }
        },
        // the widget can be dragged by its title bar (like the TextBox)
        startDrag(event) {
            if (!event.target.classList?.contains('lcTitle')) return;
            const box = this.$refs.wrapper.getBoundingClientRect();
            const dx = event.clientX - box.left;
            const dy = event.clientY - box.top;
            const move = (e) => {
                this.$refs.wrapper.style.left = `${e.clientX - dx}px`;
                this.$refs.wrapper.style.top = `${e.clientY - dy}px`;
                this.$refs.wrapper.style.bottom = 'auto';
                this.$refs.wrapper.style.right = 'auto';
            };
            const up = () => {
                window.removeEventListener('mousemove', move);
                window.removeEventListener('mouseup', up);
            };
            window.addEventListener('mousemove', move);
            window.addEventListener('mouseup', up);
        },
        draw() {
            this.raf = requestAnimationFrame(this.draw);
            const c = this.controller;
            c.frame();
            // (changed by the test hook too)
            if (this.pen !== c.shared.pen) this.pen = c.shared.pen;
            if (this.armed !== c.shared.armed) this.armed = c.shared.armed;
            if (this.model !== c.shared.model) this.model = c.shared.model;
            const g = this.ctx2d;
            const W = this.options.width;
            const H = this.options.height;
            const [lo, hi] = this.options.range;
            const now = performance.now();
            const tickMs = c.tickMs;
            const nowX = Math.round(W * 0.75);
            const pxPerMs = nowX / (this.options.ticksShown * tickMs);
            const xAt = (time) => nowX + (time - now) * pxPerMs;
            const yAt = (h) => H - (h - lo) / (hi - lo) * H;

            g.fillStyle = '#1d2a1b';
            g.fillRect(0, 0, W, H);
            // semitone and octave lines
            for (let h = Math.ceil(lo); h <= hi; h++) {
                const octave = (h - lo) % 12 === 0;
                g.strokeStyle = octave ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.05)';
                g.beginPath();
                g.moveTo(0, yAt(h) + 0.5);
                g.lineTo(W, yAt(h) + 0.5);
                g.stroke();
            }
            // ticks, beats and bars, from the last tick's time
            const last = c.lastTick;
            if (last) {
                const ticksPerBeat = this.$store.getters.getTicksPerBeat;
                const ticksPerMeasure = this.$store.getters.getTicksPerMeasure;
                const first = -Math.ceil((now - last.time) / tickMs) - this.options.ticksShown - 1;
                for (let k = first; k < first + this.options.ticksShown + 32; k++) {
                    const x = Math.round(xAt(last.time + k * tickMs)) + 0.5;
                    if (x < 0 || x > W) continue;
                    const local = (((last.local ?? last.tick) + k) % ticksPerMeasure + ticksPerMeasure) % ticksPerMeasure;
                    g.strokeStyle = local === 0 ? 'rgba(230,161,0,0.7)' :
                        local % ticksPerBeat === 0 ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.07)';
                    g.lineWidth = local === 0 ? 2 : 1;
                    g.beginPath();
                    g.moveTo(x, 0);
                    g.lineTo(x, H);
                    g.stroke();
                }
                g.lineWidth = 1;
            }
            // the notes: height = midi - baseMidi, folded by octaves into the range (folded ones paler)
            const drawNotes = (notes, color) => {
                for (const n of notes) {
                    const end = n.end ?? now;
                    if (xAt(end) < 0) continue;
                    let h = n.midi - this.options.baseMidi + lo;
                    let folded = false;
                    while (h < lo) {
                        h += 12;
                        folded = true;
                    }
                    while (h > hi) {
                        h -= 12;
                        folded = true;
                    }
                    g.globalAlpha = folded ? 0.35 : 0.8;
                    g.fillStyle = color;
                    const x0 = xAt(n.start);
                    g.fillRect(x0, yAt(h) - 3, Math.max(2, xAt(end) - x0 - 1), 6);
                }
                g.globalAlpha = 1;
            };
            const css = getComputedStyle(document.documentElement);
            drawNotes(c.agentNotes, css.getPropertyValue('--pianoRoll-agent-color').trim() || '#d15833');
            drawNotes(c.userNotes, css.getPropertyValue('--pianoRoll-human-color').trim() || '#32ddcf');
            // the line: bright while drawing, grey while not
            const pts = c.points;
            for (let i = 1; i < pts.length; i++) {
                const a = pts[i - 1];
                const b = pts[i];
                g.strokeStyle = b.pen ? '#f7f0d2' : 'rgba(247,240,210,0.3)';
                g.lineWidth = b.pen ? 2.5 : 1.5;
                g.beginPath();
                g.moveTo(xAt(a.time), yAt(a.h));
                g.lineTo(xAt(b.time), yAt(b.h));
                g.stroke();
            }
            g.lineWidth = 1;
            // "now" and the pen tip
            g.strokeStyle = 'rgba(230,161,0,0.9)';
            g.beginPath();
            g.moveTo(nowX + 0.5, 0);
            g.lineTo(nowX + 0.5, H);
            g.stroke();
            g.beginPath();
            g.arc(nowX, yAt(c.shared.height), 6, 0, 2 * Math.PI);
            g.fillStyle = c.shared.pen ? '#e6a100' : 'rgba(230,161,0,0.3)';
            g.fill();
            if (c.shared.keyHeld) {
                g.strokeStyle = '#32ddcf';
                g.lineWidth = 3;
                g.stroke();
                g.lineWidth = 1;
            }
            // status: the model in use and its time per tick, every ~10 frames
            if ((this.frameCount = (this.frameCount ?? 0) + 1) % 10 === 0) {
                const ms = c.stats.ms;
                const recent = ms.slice(-50).sort((a, b) => a - b);
                const median = recent.length ? `${recent[recent.length >> 1].toFixed(1)} ms/tick` : '';
                this.status = `${c.stats.modelShown} ${median}`;
            }
        },
    },
};
</script>

<style scoped>
.liveCanvas {
    position: absolute;
    right: 220px;
    bottom: 220px;
    z-index: 8;
    max-width: calc(100vw - 40px);
    border: 2px solid #a79c0f;
    border-radius: 8px;
    padding: 4px;
    background-color: var(--grey-background-color);
    color: #e6a100;
    font-size: 13px;
    user-select: none;
}

.lcHeader {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 4px;
}

.lcTitle {
    font-weight: bold;
    font-size: 1.1em;
    cursor: move;
}

.lcControl select {
    margin-left: 4px;
}

.lcStatus {
    margin-left: auto;
    color: #f7f0d2;
    opacity: 0.8;
}

.lcStage {
    position: relative;
    overflow: hidden;
}

.lcStage canvas {
    display: block;
    max-width: 100%;
}

.lcPen {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 72px;
    height: 72px;
    border-radius: 50%;
    border: 2px solid #e6a100;
    background: rgba(230, 161, 0, 0.15);
    color: #f7f0d2;
    font-weight: bold;
    cursor: pointer;
}

.lcPen.on {
    background: rgba(230, 161, 0, 0.55);
    color: #1a1a1a;
}

.lcHint {
    margin-top: 4px;
    color: #f7f0d2;
    opacity: 0.75;
    font-size: 12px;
}
</style>
