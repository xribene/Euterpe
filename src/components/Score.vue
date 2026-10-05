<template>
  <!-- <div ref="score" id="pianoScores"> -->
  <div @wheel="onWheel" ref="score" id="pianoScores">
    <div v-touch:swipe.up="triggerCollapse" id="scoreWrapper">
      <div id="fadeBlockStart"></div>
      <div id="grandStaff"></div>
      <div id="noteBox"></div>
      <div id="staveBackground"></div>
      <div id="fadeBlockEnd"></div>
    </div>
    <button type="button" @click="triggerCollapse" id="collapseBtn">
      <i ref="collapseBtnSymbol" class="ri-arrow-up-s-line"></i>
    </button>
  </div>
</template>


<style scoped src="@/css/score.css">
</style>

<script>
// import '../css/score.css';
import '../css/variables.css';
import * as Vex from 'vexflow';
import {spellVexFlow} from '@/utils/spelling.js';
const CLEF_SEPARATE_AT = 'B3'; // Here, we define the separate point between treble clef and bass clef for both staff.

export default {
    name: 'Score',
    props: {
        scrollStatus: {
            type: Boolean,
            default: true,
        },
        // scoreShown: {
        //     type: Boolean,
        //     default: true,
        // },
    },

    data() {
        return {
            // Customizable Properties for score rendering
            lineWidth: 2,
            lineColor: null,
            noteColor: null,
            currentBarNumber: 0,

            screenWidth: document.body.clientWidth,
            VF: Vex.Flow,
            grandStaffDiv: null,
            grandStaffRenderer: null,
            renderer: null,
            targetDiv: null,
            lastSvgGroupTrebleBar: null,
            lastSvgGroupBassBar: null,
            lastSvgGroupTreble: null,
            lastSvgGroupBass: null,
            lastSvgGroupTrebleXOffset: null,
            lastSvgGroupTrebleXOffset_lastNote: null,
            lastSvgGroupTrebleXOffset_lastNote_prevBar: null,
            lastSvgGroupBassXOffset: null,
            lastSvgGroupBassXOffset_lastNote: null,
            lastDrawnNote_Human: null,
            lastDrawnNote_Human_prevBar: null,
            afairetisHuman: 0,
            afairetisAI: 0,
            barTieHuman: false,
            barTieAI: true,
            tickContexts: [],
            context: null,
            staves: [],
            notes: null,
            durations: null,
            lastXOffsetOnBar: null, // TODO delete that after I'm done
            viewX: 30,
            viewXOnWheel: 30,
            xTreble: 30,
            xBass: 30,
            xCurrent: 30,
            // distance between two 16ths in the score
            tickStepPixels: 30,
            // how often (in milliseconds) we scroll the viewBox
            // smaller --> smoother scrolling
            scrollStepTime: 10,
            // the position of the latest note will be at the 3/4s of the screen's width
            latestNotePosition: 0.75,
            // Scrolling starts once the x cursor has reached the desired latestNotePosition
            scrollsCounter: 0,
            scrollsNumberPerMeasure: 400,
            preDur: 1,
            scrollEnabled: false,
            // spelling of the notes currently drawn, by `${clef}:${startTick}:${midi}`
            spellings: new Map(),
            // per staff, the notes of the current beat, redrawn together every tick so 8ths/16ths can be beamed
            segments: {treble: null, bass: null},
        };
    },

    created() {
        window.addEventListener('resize', this.resize);
        this.$root.$refs.score = this;
        const css = window.getComputedStyle(document.documentElement);
        this.noteColor = css.getPropertyValue('--note-color');
        this.lineColor = css.getPropertyValue('--line-color');
    },

    unmounted() {
        window.removeEventListener('resize', this.resize);
    },

    watch: {
    // scoreShown: {
    //   immediate: true,
    //   handler(newValue, oldValue) {
    //     if (newValue == true) {
    //       this.triggerCollapse();
    //     }
    //   }
    // },
        scrollEnabled: { // TODO should scrollEnabled be in data() ?
            immediate: true,
            handler(newValue, oldValue) {
                if (newValue == true) {
                    this.enableScrolling();
                }
            },
        },

    },
    mounted() {
        const vm = this;

        // vm.scrollEnabled = this.$store.getters.config.gui.score;
        if (vm.$props.scrollStatus == false) {
            console.log('scrolling disabled');
            this.triggerCollapse();
        }

        vm.init();
        vm.resize();
        const grandStaff = document.getElementById('grandStaff');
        const grandStaffChildren = grandStaff.children;
        for (let i = 0; i < grandStaffChildren.length; i++) {
            const grandStaffChildrenChildren = grandStaffChildren[i].children;
            for (var j = 0; j < grandStaffChildrenChildren.length; j++) {
                grandStaffChildrenChildren[j].style.fill = this.lineColor;
                grandStaffChildrenChildren[j].style.stroke = this.lineColor;
            }
        }
        const clefs = document.getElementsByClassName('vf-clef');
        for (var j = 0; j < clefs.length; j++) {
            const clefPath = clefs[j].children[0];
            clefPath.style.fill = this.lineColor;
            clefPath.style.stroke = this.lineColor;
        }
    },

    methods: {
        resize() {
            this.screenWidth = document.body.clientWidth;
        },

        init() {
            const vm = this;
            // Render the grand staff.
            this.grandStaffDiv = document.getElementById('grandStaff');
            this.grandStaffRenderer = new this.VF.Renderer(
                this.grandStaffDiv,
                this.VF.Renderer.Backends.SVG,
            );
            this.grandStaffRenderer.resize(200, 300);
            const grandStaffContext = this.grandStaffRenderer.getContext();
            const trebleStave = new this.VF.Stave(30, 50, 200)
                .addClef('treble')
                .setStyle({
                    fillStyle: this.lineColor,
                    strokeStyle: this.lineColor,
                    lineWidth: this.lineWidth,
                });
            const bassStave = new this.VF.Stave(30, 150, 200).addClef('bass').setStyle({
                fillStyle: this.lineColor,
                strokeStyle: this.lineColor,
                lineWidth: this.lineWidth,
            });
            trebleStave.setContext(grandStaffContext).draw();
            bassStave.setContext(grandStaffContext).draw();

            const brace = new this.VF.StaveConnector(trebleStave, bassStave).setType(3).setStyle({
                fillStyle: this.lineColor,
                strokeStyle: this.lineColor,
                lineWidth: this.lineWidth,
            });
            const lineLeft = new this.VF.StaveConnector(trebleStave, bassStave).setType(
                1,
            ).setStyle({
                fillStyle: this.lineColor,
                strokeStyle: this.lineColor,
                lineWidth: this.lineWidth,
            });
            brace.setContext(grandStaffContext).draw();
            lineLeft.setContext(grandStaffContext).draw();

            // Set ground for background staves.
            this.targetDiv = document.getElementById('staveBackground');
            this.renderer = new this.VF.Renderer(
                this.targetDiv,
                this.VF.Renderer.Backends.SVG,
            );
            this.renderer.resize(this.screenWidth, 300);
            this.context = this.renderer.getContext();
            this.tickContexts.push(new this.VF.TickContext());
            this.tickContexts.push(new this.VF.TickContext());

            this.staves.push(new this.VF.Stave(30, 50, 5000));
            this.staves.push(new this.VF.Stave(30, 150, 5000));

            this.context.setViewBox(this.viewX, 0, this.screenWidth, 300);
            this.staves[0]
                .setContext(this.context)
                .setStyle({
                    fillStyle: this.lineColor,
                    strokeStyle: this.lineColor,
                    lineWidth: this.lineWidth,
                })
                .draw();
            this.staves[1]
                .setContext(this.context)
                .setStyle({
                    fillStyle: this.lineColor,
                    strokeStyle: this.lineColor,
                    lineWidth: this.lineWidth,
                })
                .draw();


            // Set ground for the notes.
            this.targetDiv = document.getElementById('noteBox');
            this.renderer = new this.VF.Renderer(
                this.targetDiv,
                this.VF.Renderer.Backends.SVG,
            );
            this.renderer.resize(this.screenWidth, 300);
            this.context = this.renderer.getContext();

            this.tickContexts.push(new this.VF.TickContext());
            this.tickContexts.push(new this.VF.TickContext());

            this.staves.push(new this.VF.Stave(30, 50, 0));
            this.staves.push(new this.VF.Stave(30, 150, 0));

            this.staves[0].setContext(this.context);
            this.staves[1].setContext(this.context);
        },

        enableScrolling() {
            setInterval(() => {
                if (this.$store.getters.getClockStatus && this.scrollEnabled) {
                    // console.log("scrolling score")
                    this.scrollScore(1);
                    this.scrollsCounter += 1;
                    this.scrollsNumberPerMeasure =
            ((60 / this.$store.getters.getBPM) * 4 * 1000) /
            this.scrollStepTime;
                }
            }, this.scrollStepTime);
        },

        scrollScore(steps) {
            this.viewX +=
        (steps * (this.scrollStepTime * this.tickStepPixels)) /
        ((1000 * 60) / this.$store.getters.getBPM / 4);
            this.context.setViewBox(this.viewX, 0, this.screenWidth, 300);
            this.viewXOnWheel = this.viewX;
        },

        onWheel(event) {
            this.viewXOnWheel -= (event.deltaX + event.deltaY);
            this.context.setViewBox(this.viewXOnWheel, 0, this.screenWidth, 300);
        },

        /**
         * VexFlow key + accidental for a note, spelled in the key that was current when the note started
         * (the agent's key estimate, see src/utils/spelling.js). The spelling is remembered, so a note that
         * keeps growing (and is redrawn every tick) never changes its accidental.
         */
        spelledNote(quantNoteDict, clef) {
            const id = `${clef}:${quantNoteDict.startTick}:${quantNoteDict.midi}`;
            let spelled = this.spellings.get(id);
            if (!spelled) {
                spelled = spellVexFlow(quantNoteDict.midi, this.$store.getters.getEstimatedKey);
                this.spellings.set(id, spelled);
                // only the notes still being drawn need to be remembered
                if (this.spellings.size > 64) this.spellings.delete(this.spellings.keys().next().value);
            }
            return spelled;
        },

        formatQuantizedNote(quantNoteDict, clef = 'treble', afairetis = 0) {
            const vm = this;

            let formName;
            let accidental = '';
            let extraR = '';

            // Get formatted name
            if (quantNoteDict.midi === 0) {
                formName = clef == 'treble' ? 'b/4' : 'd/2';
                extraR = 'r';
            } else {
                ({key: formName, accidental} = this.spelledNote(quantNoteDict, clef));
            }

            // get formatted duration
            let durationTokens;
            let durations;
            [durationTokens, durations] = this.DurationFormatter(
                quantNoteDict.dur - afairetis,
            );
            // console.log(formName, " ", durationTokens);
            // stem_direction vm.VF.StaveNote.STEM_UP
            const notes = [];
            for (let i = 0; i < durationTokens.length; i++) {
                const newNote = new vm.VF.StaveNote({
                    clef: clef,
                    keys: [formName],
                    duration: durationTokens[i] + extraR,
                }).setStyle({
                    fillStyle: this.noteColor,
                    strokeStyle: this.noteColor,
                });
                if (durationTokens[i].includes('d')) {
                    const dot = new vm.VF.Dot();
                    // dot.setDotShiftY(newNote.glyph.dot_shiftY);
                    newNote.addModifier(dot, 0);
                // newNote.addDotToAll();
                }
                if (accidental) {
                    newNote.addModifier(new vm.VF.Accidental(accidental), 0);
                }
                notes.push(newNote);
            }
            return {notes: notes, durations: durations};
        },

        /**
         * Draw one staff for the current tick. The notes that start in the same beat form a segment that is
         * redrawn as one SVG group every tick, so consecutive 8ths/16ths inside the beat can be beamed. The
         * segment is frozen (left as drawn) when a note starts in a later beat or a new bar begins. Notes that
         * cross a beat stay unbeamed and rests break beams. A note continuing over a barline restarts in the
         * new bar (afairetis) and is tied to its part in the previous bar.
         * @param {string} clef - 'treble' (user) or 'bass' (agent)
         * @param {Object} quantNoteDict - {midi, startTick, dur} of the note sounding at this tick
         * @param {number} afairetis - ticks of this note already drawn in the previous bar
         */
        drawStaff(clef, quantNoteDict, afairetis) {
            const t = this.$store.getters.getLocalTickDelayed % 16;
            const dur = quantNoteDict.dur - afairetis;
            let seg = this.segments[clef];
            if (dur === 1) {
                // a note (or rest) starts at this tick
                const beat = Math.floor(t / 4);
                if (!seg || t === 0 || beat !== seg.beat) {
                    const prev = seg;
                    seg = {
                        startX: prev ? prev.endX : (clef === 'treble' ? this.xTreble : this.xBass),
                        startTick: t,
                        beat: beat,
                        notes: [],
                        group: null,
                        endX: 0,
                        lastToken: null,
                        tieFrom: t === 0 && afairetis > 0 && prev ? prev.lastToken : null,
                    };
                    this.segments[clef] = seg;
                }
                seg.notes.push({midi: quantNoteDict.midi, startTick: quantNoteDict.startTick, dur: 1});
            } else if (seg && seg.notes.length > 0) {
                // the current note keeps sounding
                seg.notes[seg.notes.length - 1].dur = dur;
            } else {
                return;
            }
            this.renderSegment(clef, seg);
        },

        /**
         * (Re)draw a segment: its notes at their manual x positions, ties inside notes and over the barline,
         * and beams over runs of 8ths/16ths that lie within one beat.
         * @param {string} clef
         * @param {Object} seg - see drawStaff()
         */
        renderSegment(clef, seg) {
            const VF = this.VF;
            const stave = this.staves[clef === 'treble' ? 0 : 1];
            const style = {fillStyle: this.noteColor, strokeStyle: this.noteColor};
            if (seg.group) {
                seg.group.remove();
            }
            seg.group = this.context.openGroup();

            // StaveNotes, each with its own TickContext so its x stays put for ties and beams
            const tokens = [];
            let x = seg.startX;
            let tick = seg.startTick; // position in the bar
            seg.notes.forEach((record, r) => {
                const {notes, durations} = this.formatQuantizedNote(record, clef, 0);
                notes.forEach((note, i) => {
                    note.setStave(stave);
                    note.setContext(this.context);
                    note.setStemStyle(style);
                    if (clef === 'bass') {
                        note.setStemDirection(VF.StaveNote.STEM_DOWN);
                    }
                    const tickContext = new VF.TickContext();
                    tickContext.addTickable(note);
                    tickContext.preFormat();
                    tickContext.setX(x);
                    tokens.push({note: note, start: tick, len: durations[i], record: r, rest: record.midi === 0});
                    x += this.tickStepPixels * durations[i];
                    tick += durations[i];
                });
            });

            // beams: runs of 16ths, 8ths and dotted 8ths inside the same beat (created before drawing, so the
            // notes draw without flags and the beam draws their stems)
            const beams = [];
            let run = [];
            const flush = () => {
                if (run.length >= 2) {
                    beams.push(new VF.Beam(run.map((k) => k.note), false).setStyle(style));
                }
                run = [];
            };
            for (const k of tokens) {
                const beat = Math.floor(k.start / 4);
                const beamable = !k.rest && k.len <= 3 && beat === Math.floor((k.start + k.len - 1) / 4);
                if (!beamable || (run.length > 0 && Math.floor(run[0].start / 4) !== beat)) {
                    flush();
                }
                if (beamable) {
                    run.push(k);
                }
            }
            flush();

            tokens.forEach((k) => k.note.draw());

            // ties: between the parts of one note, and from the previous bar
            const tie = (from, to) => {
                new VF.StaveTie({first_note: from, last_note: to, first_indices: [0], last_indices: [0]})
                    .setStyle(style)
                    .setContext(this.context)
                    .draw();
            };
            if (seg.tieFrom && tokens.length > 0 && !tokens[0].rest) {
                tie(seg.tieFrom.note, tokens[0].note);
            }
            for (let i = 1; i < tokens.length; i++) {
                if (tokens[i].record === tokens[i - 1].record && !tokens[i].rest) {
                    tie(tokens[i - 1].note, tokens[i].note);
                }
            }

            beams.forEach((beam) => beam.setContext(this.context).draw());
            this.context.closeGroup();

            seg.endX = x;
            seg.lastToken = tokens.length > 0 ? tokens[tokens.length - 1] : null;
            if (clef === 'treble') {
                this.xTreble = x;
            } else {
                this.xBass = x;
            }
        },

        draw() {
            const humanQuantNoteDict = this.$store.getters.getLastHumanNoteQuantized;
            const aiQuantNoteDict = this.$store.getters.getLastAINoteQuantized;
            // console.log("TO DRAW ", aiQuantNoteDict.midi);

            if (aiQuantNoteDict.startTick == -1) {
                aiQuantNoteDict.dur = this.preDur;
                this.preDur += 1;
            }
            // TODO some if's are redudant.
            if (humanQuantNoteDict.dur == 1) {
                this.afairetisHuman = 0;
                this.barTieHuman = false;
            }
            if (aiQuantNoteDict.dur == 1) {
                this.afairetisAI = 0;
                this.barTieAI = false;
            }
            // TODO : localTickDelayed is the same as localTick because I call draw after I increase localTickDelayed
            if (this.$store.getters.getLocalTickDelayed % 16 === 0) {
                // this.lastDrawnNote_Human_prevBar = this.lastDrawnNote_Human;
                // this.lastSvgGroupTrebleXOffset_lastNote_prevBar = this.lastSvgGroupTrebleXOffset_lastNote;
                if (humanQuantNoteDict.dur == 1) {
                    this.afairetisHuman = 0;
                    this.barTieHuman = false;
                } else if (humanQuantNoteDict.dur > 1) {
                    this.afairetisHuman = humanQuantNoteDict.dur - 1;
                    this.barTieHuman = true;
                }
                if (aiQuantNoteDict.dur == 1) {
                    this.afairetisAI = 0;
                    this.barTieAI = false;
                } else if (aiQuantNoteDict.dur > 1) {
                    this.afairetisAI = aiQuantNoteDict.dur - 1;
                    this.barTieAI = true;
                }
            }

            this.drawStaff('treble', humanQuantNoteDict, this.afairetisHuman);
            this.drawStaff('bass', aiQuantNoteDict, this.afairetisAI);

            this.xCurrent += this.tickStepPixels * 1;
            // here we draw the barline and bar-number
            if (this.$store.getters.getLocalTickDelayed % 16 === 0) {
                // Draw Barnumber
                this.currentBarNumber += 1;
                this.context.font = '22px Georgia';
                // set every color to line color
                this.context.fillStyle = this.lineColor;
                this.context.fillText(
                    this.currentBarNumber,
                    this.xCurrent + Math.floor(this.tickStepPixels / 2),
                    this.staves[0].getYForLine(0) - 20,
                );

                // Draw Barline
                const thickness = 1;
                const topY = this.staves[0].getYForLine(0);
                const botY = this.staves[1].getYForLine(this.staves[1].getNumLines() - 1);
                this.context.fillRect(
                    this.xCurrent + this.tickStepPixels / 2 - thickness / 2,
                    topY,
                    thickness,
                    botY - topY,
                );
                // Scrolling problem. The setTimeout function doesn't behave accurately.
                // At 60bpm and 10ms interval, it should run 400 (scrolls) per measure, however
                // it doesn't. Notice that in a previous version of the code we didn't have this problem
                // The solution I implement here is that at the end of each bar, check how many scrolls are missing,
                // and srcoll accordingly. The problem is that this creates sudden "jumps".
                // To fix that we can try to perform this check more often (i.e every beat)

                if (this.scrollEnabled == true) {
                    const scrollsDiff = this.scrollsNumberPerMeasure - this.scrollsCounter;
                    // console.log(scrollsDiff);
                    this.scrollScore(scrollsDiff);
                    this.scrollsCounter = 0;
                }

                this.lastXOffsetOnBar = this.xCurrent;
            }

            // find the position of the next note in relation with the screenWidth
            const pos = (this.xCurrent - this.viewX) / this.screenWidth;
            if (pos > this.latestNotePosition) {
                // console.log(pos);
                this.scrollEnabled = true;
            }

            if (this.$store.getters.getLocalTickDelayed % 16 === 15) {
                this.lastDrawnNote_Human_prevBar = this.lastDrawnNote_Human;
                this.lastSvgGroupTrebleXOffset_lastNote_prevBar =
          this.lastSvgGroupTrebleXOffset_lastNote;
            }
        },

        triggerCollapse() {
            const btnSymbol = this.$refs.collapseBtnSymbol.classList;
            const score = this.$refs.score;
            const scoreClass = score.classList;
            if (scoreClass.contains('slide-up')) {
                scoreClass.replace('slide-up', 'slide-down');
                btnSymbol.replace('ri-arrow-down-s-line', 'ri-arrow-up-s-line');
            } else if (scoreClass.contains('slide-down')) {
                scoreClass.replace('slide-down', 'slide-up');
                btnSymbol.replace('ri-arrow-up-s-line', 'ri-arrow-down-s-line');
            } else {
                scoreClass.add('slide-up');
                btnSymbol.replace('ri-arrow-up-s-line', 'ri-arrow-down-s-line');
            }
        },

        DurationFormatter(duration) {
            // 1 --> 16
            // 2 --> 8
            // 3 --> 8.
            // 4 --> 4 or q
            // 5 --> 4 + need for extra tied sixteenth
            // 6 --> 4.
            // 7 --> 4. + need for extra tied sixteenth
            // 8 --> 2 or h
            // 9 --> 8 + need for extra tied sixteenth
            // 10 --> 8 + need for extra tied eight
            // 11 --> 8 + need for extra tied eigth dotted
            // 12 --> 8.
            // 13 --> 8. + need for extra tied sixteenth
            // 14 --> 8. + need for extra tied eigth
            // 15 --> 8. + need for extra tied eigth dotted
            // 16 --> 1 or w
            const vm = this;
            let durationTokens;
            let newDurations;
            switch (duration) {
            case 1:
                durationTokens = ['16'];
                newDurations = [1];
                break;
            case 2:
                durationTokens = ['8'];
                newDurations = [2];
                break;
            case 3:
                durationTokens = ['8d'];
                newDurations = [3];
                break;
            case 4:
                durationTokens = ['4'];
                newDurations = [4];
                break;
            case 5:
                durationTokens = ['4', '16'];
                newDurations = [4, 1];
                break;
            case 6:
                durationTokens = ['4d'];
                newDurations = [6];
                break;
            case 7:
                durationTokens = ['4d', '16'];
                newDurations = [6, 1];
                break;
            case 8:
                durationTokens = ['2'];
                newDurations = [8];
                break;
            case 9:
                durationTokens = ['2', '16'];
                newDurations = [8, 1];
                break;
            case 10:
                durationTokens = ['2', '8'];
                newDurations = [8, 2];
                break;
            case 11:
                durationTokens = ['2', '8d'];
                newDurations = [8, 3];
                break;
            case 12:
                durationTokens = ['2d'];
                newDurations = [12];
                break;
            case 13:
                durationTokens = ['2d', '16'];
                newDurations = [12, 1];
                break;
            case 14:
                durationTokens = ['2d', '8'];
                newDurations = [12, 2];
                break;
            case 15:
                durationTokens = ['2d', '8d'];
                newDurations = [12, 3];
                break;
            case 16:
                durationTokens = ['1'];
                newDurations = [16];
                break;

            default:
                vm.$toasted.show('score error: Invalid Duration.');
                console.error('Invalid duration', duration);
            }
            return [durationTokens, newDurations];
        },
    },
};
</script>
