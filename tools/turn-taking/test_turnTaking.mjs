// Unit tests of the turn-taking state machine (src/agent/turnTaking.js).  Run: node --test tools/turn-taking/
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TurnTaking, octaveBelow} from '../../src/agent/turnTaking.js';

/**
 * Runs a user line through the state machine. `user` = per-tick [midi, artic]; the network's choice at every tick
 * comes from `choose(t, tt)` (default: a new note C3 on every beat, held otherwise).
 * @return {Array<Object>} per tick: {t, input, joining, listening, sounded, fed, event, resetState}
 */
function run(tt, user, choose = (t) => ({midi: 48, artic: (t + 1) % 4 === 0 ? 1 : 0})) {
    return user.map(([midi, artic], t) => {
        const h = tt.hear(midi, artic, t % 16);
        const d = tt.decide(choose(t, tt));
        return {t, ...h, ...d};
    });
}

// a note every `every` ticks for `ticks` ticks, starting at `from`; rests before
function phrase(ticks, {from = 0, every = 4, pitch = 72} = {}) {
    const out = [];
    for (let t = 0; t < from; t++) out.push([0, 1]);
    for (let t = 0; t < ticks; t++) out.push([pitch + 2 * Math.floor(t / every) % 12, t % every === 0 ? 1 : 0]);
    return out;
}
const rests = (n) => Array.from({length: n}, () => [0, 1]);
const firstSounding = (rows) => rows.find((r) => r.sounded.midi > 0);

test('listens for a bar, then joins on the next beat', () => {
    const rows = run(new TurnTaking(), phrase(32));
    // silent while listening: every decision up to tick 14 sounds a rest
    assert.ok(rows.slice(0, 15).every((r) => r.sounded.midi === 0 && r.listening));
    // 16 ticks heard at tick 15, the next tick (16) is a beat -> joins; its first note sounds at tick 16
    assert.equal(rows[15].event, 'join');
    assert.equal(rows[15].joining, true);
    assert.equal(firstSounding(rows).t, 15);
    // a held choice that was not sounding becomes a new note
    assert.deepEqual(rows[15].sounded, {midi: 48, artic: 1});
    assert.ok(rows.slice(16).every((r) => r.sounded.midi === 48 && !r.listening));
});

test('joins on a beat when the user starts off the beat', () => {
    const rows = run(new TurnTaking(), phrase(40, {from: 2}));
    // first note at tick 2 -> 16 ticks heard at tick 17 -> next beat is tick 20, decided at tick 19
    assert.equal(rows.findIndex((r) => r.event === 'join'), 19);
});

test('needs at least 3 notes', () => {
    // one note held for 2 bars, then notes every 4 ticks
    const user = [[72, 1], ...Array.from({length: 31}, () => [72, 0]), ...phrase(16, {pitch: 60})];
    const rows = run(new TurnTaking(), user);
    // the 3rd note starts at tick 36; the next beat after it is tick 40, decided at tick 39
    assert.equal(rows.findIndex((r) => r.event === 'join'), 39);
    // a new pitch without an onset flag counts as a new note too
    const tt = new TurnTaking({listenTicks: 4});
    run(tt, [[60, 1], [62, 0], [64, 0], [64, 0]]);
    assert.equal(tt.phraseNotes, 3);
});

test('stops after the silence threshold, letting its note end, then re-joins', () => {
    const tt = new TurnTaking({stopTicks: 32});
    const user = [...phrase(32), ...rests(48), ...phrase(32, {pitch: 60})];
    // the network: a new note every bar on tick 0, held otherwise
    const rows = run(tt, user, (t) => ({midi: 50, artic: (t + 1) % 16 === 0 ? 1 : 0}));
    const stop = rows.findIndex((r) => r.event === 'stop');
    // user silent from tick 32; at tick 63 silence = 32, but BachDuet's held note goes on until its next onset
    // (decided at tick 63 for tick 64: a new note -> it ends there)
    assert.equal(stop, 63);
    assert.ok(rows.slice(32, 63).every((r) => r.sounded.midi === 50));
    assert.ok(rows.slice(63, 95).every((r) => r.sounded.midi === 0));
    // the user plays again at tick 80: 16 ticks heard at tick 95 -> re-joins for tick 96
    assert.equal(rows.findIndex((r, i) => i > stop && r.event === 'join'), 95);
});

test('a note still held at the threshold rings at most maxRing ticks', () => {
    const tt = new TurnTaking({stopTicks: 16, maxRing: 4});
    // the network holds one note for ever
    const rows = run(tt, [...phrase(16), ...rests(40)], () => ({midi: 50, artic: 0}));
    // user silent from tick 16: silence 16 at tick 31; 4 more ticks of ringing, stops at tick 35
    assert.equal(rows.findIndex((r) => r.event === 'stop'), 35);
});

test('stops at once when BachDuet is resting at the threshold', () => {
    const tt = new TurnTaking({stopTicks: 16});
    const rows = run(tt, [...phrase(16), ...rests(40)], (t) => ({midi: t < 20 ? 50 : 0, artic: 1}));
    assert.equal(rows.findIndex((r) => r.event === 'stop'), 31);
});

test('short rests of the user do not stop BachDuet', () => {
    const tt = new TurnTaking({stopTicks: 32});
    const user = [...phrase(32), ...rests(24), ...phrase(32), ...rests(31), ...phrase(16)];
    const rows = run(tt, user);
    assert.equal(rows.filter((r) => r.event === 'stop').length, 0);
    assert.equal(rows.filter((r) => r.event === 'join').length, 1);
});

test('Reset returns to listening; listen 0 / stop 0 = the old behaviour', () => {
    const tt = new TurnTaking();
    run(tt, phrase(32));
    assert.equal(tt.playing, true);
    tt.reset();
    assert.equal(tt.playing, false);
    assert.equal(tt.phraseStarted, false);
    const old = new TurnTaking({listenTicks: 0, stopTicks: 0});
    const rows = run(old, [...rests(8), ...phrase(16), ...rests(100)]);
    // plays from tick 0, never stops, input is always its own previous choice
    assert.ok(rows.every((r) => r.sounded.midi === 48 && r.input === null && r.event === null));
});

test('listen 0 after a stop: re-joins on the beat after the next note', () => {
    const tt = new TurnTaking({listenTicks: 0, stopTicks: 16});
    const rows = run(tt, [...phrase(16), ...rests(30), [70, 1], [70, 0], [70, 0], [70, 0], [70, 0]]);
    assert.equal(rows.findIndex((r) => r.event === 'stop'), 31);
    // the user's note at tick 46: the next beat is tick 48, decided at tick 47
    assert.equal(rows.findIndex((r, i) => i > 31 && r.event === 'join'), 47);
});

test('a phrase heard while listening is forgotten after a long silence', () => {
    const tt = new TurnTaking({stopTicks: 32});
    // 2 notes, 32 ticks of rest (forgotten), then a full bar
    const user = [[72, 1], [72, 0], [74, 1], ...rests(32), ...phrase(20, {pitch: 60})];
    const rows = run(tt, user);
    // the phrase restarts at tick 35: 16 ticks at tick 50, beat at 52 -> decided at 51
    assert.equal(rows.findIndex((r) => r.event === 'join'), 51);
});

test('own-voice input while listening: rest / octave / freerun', () => {
    const user = [[72, 1], [72, 0], [0, 1], [35, 1]];
    const inputs = (seeding) => run(new TurnTaking({seeding}), user).map((r) => r.input);
    assert.deepEqual(inputs('rest'), user.map(() => ({midi: 0, artic: 1})));
    assert.deepEqual(inputs('octave'), [{midi: 60, artic: 1}, {midi: 60, artic: 0}, {midi: 0, artic: 1},
        {midi: 47, artic: 1}]);
    assert.deepEqual(inputs('freerun'), [null, null, null, null]);
    assert.equal(octaveBelow(40), 28);
    assert.equal(octaveBelow(39), 51);
    // playing: no override
    const tt = new TurnTaking({seeding: 'octave'});
    const rows = run(tt, phrase(24));
    assert.ok(rows.slice(16).every((r) => r.input === null));
    assert.notEqual(rows[15].input, null); // the join tick itself still gets the listening input
});

test('re-entry reset asks for a state reset and feeds a rest', () => {
    const keep = run(new TurnTaking({stopTicks: 16}), [...phrase(16), ...rests(20)], () => ({midi: 50, artic: 1}));
    const stopK = keep.find((r) => r.event === 'stop');
    assert.equal(stopK.resetState, false);
    assert.deepEqual(stopK.fed, {midi: 50, artic: 1});
    const reset = run(new TurnTaking({stopTicks: 16, reentry: 'reset'}), [...phrase(16), ...rests(20)],
        () => ({midi: 50, artic: 1}));
    const stopR = reset.find((r) => r.event === 'stop');
    assert.equal(stopR.resetState, true);
    assert.deepEqual(stopR.fed, {midi: 0, artic: 1});
});
