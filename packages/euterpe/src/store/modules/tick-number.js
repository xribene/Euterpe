// import Vue from 'vue';

/* Initial state of three Tick number
globalTick is the Tick number for the whole process of the midi IO
localTick is the Tick number for only one measure, cannot be greater than 16
barTick is the number of the measures played
 */
const state = {
    ticksPerMeasure: null,
    globalTick: -1,
    localTick: -1,
    localTickDelayed: -1,
    globalTickDelayed: -1,
    barTick: -1,
    barNumber: 0,
    // Bar restarts (a widget with `resetsClock: true`, e.g. BachDuet's Reset): the next tick becomes beat 1 of a new
    // bar. globalTick keeps counting (score, piano roll and session log stay continuous); resetTick is the global
    // tick of the latest restart (barResets counts them), and the bar position is counted from there.
    resetPending: false,
    resetTick: 0,
    barResets: 0,
};

// Getters for globalTick, localTick, barTick
const getters = {
    getGlobalTick(state) {
        return state.globalTick;
    },
    getLocalTick(state) {
        return state.localTick;
    },
    getLocalTickDelayed(state) {
        return state.localTickDelayed;
    },
    getGlobalTickDelayed(state) {
        return state.globalTickDelayed;
    },
    getBarTick(state) {
        return state.barTick;
    },
    getBarNumber(state) {
        return state.barNumber;
    },
    isNewBar(state) {
        return state.localTick % state.ticksPerMeasure === 0;
    },
    getNextLocalTickAfter: (state) => (currentTick) => {
        return (currentTick + 1) % state.ticksPerMeasure;
    },
    getNextLocalTick(state) {
        return (state.localTick + 1) % state.ticksPerMeasure;
    },
    getResetTick(state) {
        return state.resetTick;
    },
    // true at the tick where a bar restart takes effect (its localTick is 0)
    isBarResetTick(state) {
        return state.barResets > 0 && state.globalTick === state.resetTick;
    },
};

const actions = {
};

/*
AddTick is the func. for changing the value of the three Tick number.
 */
const mutations = {
    setTicksPerMeasure(state, config) {
        state.ticksPerMeasure = config.clockSettings.ticksPerBeat *
                    config.clockSettings.timeSignature.numerator;
    },
    incrementTick(state) {
        state.globalTick += 1;
        if (state.resetPending) {
            // bar restart: this tick is beat 1 of a new bar
            state.resetPending = false;
            state.resetTick = state.globalTick;
            state.barResets += 1;
            state.localTick = 0;
        } else {
            state.localTick = (state.localTick + 1) % state.ticksPerMeasure;
        }
        if (state.localTick == 0) {
            state.barNumber += 1;
            state.barTick += 1;
        }
        // console.debug('incrementTick to ', state.globalTick);
    },
    incrementTickDelayed(state) {
        state.globalTickDelayed += 1;
        if (state.barResets > 0 && state.globalTickDelayed === state.resetTick) {
            // the delayed tick reaches the bar restart
            state.localTickDelayed = 0;
        } else {
            state.localTickDelayed = (state.localTickDelayed + 1) % state.ticksPerMeasure;
        }
        // console.debug('incrementDelayedTick to ', state.globalTickDelayed);
    },
    // Restart the bar at the next tick (see resetPending above)
    requestBarReset(state) {
        state.resetPending = true;
    },
};

export default {
    state,
    getters,
    actions,
    mutations,
};
