// Unit tests of the clock's tick store (src/store/modules/tick-number.js), incl. the bar restart of a
// `resetsClock` button (BachDuet's Reset).  Run: node --test tools/clock/test_tickStore.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import tickStore from '../../src/store/modules/tick-number.js';

const {mutations, getters} = tickStore;
const config = {clockSettings: {ticksPerBeat: 4, timeSignature: {numerator: 4}}};

function fresh() {
    const state = JSON.parse(JSON.stringify(tickStore.state));
    mutations.setTicksPerMeasure(state, config);
    return state;
}
// one clock tick as Euterpe.vue runs it: incrementTick, then (tick/4 later) incrementTickDelayed
function tick(state) {
    mutations.incrementTick(state);
    const atTick = {local: state.localTick, global: state.globalTick, bar: state.barNumber, barTick: state.barTick,
        reset: getters.isBarResetTick(state)};
    mutations.incrementTickDelayed(state);
    return {...atTick, localDelayed: state.localTickDelayed, globalDelayed: state.globalTickDelayed};
}

test('counts 16ths and bars as before when there is no reset', () => {
    const s = fresh();
    const rows = Array.from({length: 40}, () => tick(s));
    assert.deepEqual(rows.map((r) => r.local), Array.from({length: 40}, (_, i) => i % 16));
    assert.deepEqual(rows.map((r) => r.localDelayed), rows.map((r) => r.local));
    assert.deepEqual(rows.map((r) => r.global), Array.from({length: 40}, (_, i) => i));
    assert.deepEqual(rows.map((r) => r.bar), Array.from({length: 40}, (_, i) => Math.floor(i / 16) + 1));
    assert.deepEqual(rows.map((r) => r.barTick), Array.from({length: 40}, (_, i) => Math.floor(i / 16)));
    assert.ok(rows.every((r) => !r.reset));
});

test('a bar restart makes the next tick beat 1 of a new bar; globalTick keeps counting', () => {
    const s = fresh();
    for (let i = 0; i < 22; i++) tick(s); // last tick: global 21, local 5
    mutations.requestBarReset(s);
    const r = tick(s);
    assert.deepEqual([r.global, r.local, r.localDelayed, r.bar, r.barTick, r.reset], [22, 0, 0, 3, 2, true]);
    assert.equal(getters.getResetTick(s), 22);
    const after = Array.from({length: 20}, () => tick(s));
    assert.deepEqual(after.map((x) => x.local), Array.from({length: 20}, (_, i) => (i + 1) % 16));
    assert.deepEqual(after.map((x) => x.localDelayed), after.map((x) => x.local));
    assert.deepEqual(after.map((x) => x.global), Array.from({length: 20}, (_, i) => 23 + i));
    assert.equal(after[14].bar, 3);
    assert.equal(after[15].bar, 4); // global 38 = 16 ticks after the restart
    assert.ok(after.every((x) => !x.reset));
    assert.equal(getters.isNewBar(s), false);
});

test('the delayed tick follows the restart even if the reset lands between a tick and its delayed run', () => {
    const s = fresh();
    for (let i = 0; i < 9; i++) tick(s);
    mutations.incrementTick(s); // tick 9 (local 9) ...
    mutations.requestBarReset(s); // ... Reset pressed before its delayed run
    mutations.incrementTickDelayed(s);
    assert.equal(s.localTickDelayed, 9);
    const r = tick(s);
    assert.deepEqual([r.global, r.local, r.localDelayed, r.reset], [10, 0, 0, true]);
});

test('a reset before the clock starts: the first tick is a downbeat as usual; double presses restart once', () => {
    const s = fresh();
    mutations.requestBarReset(s);
    assert.deepEqual(tick(s), {local: 0, global: 0, bar: 1, barTick: 0, reset: true, localDelayed: 0, globalDelayed: 0});
    for (let i = 0; i < 5; i++) tick(s);
    mutations.requestBarReset(s);
    mutations.requestBarReset(s);
    const r = tick(s);
    assert.deepEqual([r.local, r.bar, r.reset], [0, 2, true]);
    assert.equal(tick(s).local, 1);
});
