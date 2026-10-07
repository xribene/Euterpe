const state = {
    config: null,
    sessionID: null,
    clockStatus: false,
    clockInitialized: false,
    currentBPM: null,
    frequency: null,
    // randomness: null,
    modalStatus: false,
    // Key estimate from the agent ('E♭ major'), used to spell notes (C♯ vs D♭); null spells with sharps
    estimatedKey: null,
};

const getters = {
    getConfig(state) {
        return state.config;
    },
    getClockStatus(state) {
        return state.clockStatus;
    },
    getClockInitialized(state) {
        return state.clockInitialized;
    },
    getBPM(state) {
        return state.currentBPM;
    },
    // getRandomness(state){
    //   return state.randomness;
    // },
    getModalStatus(state) {
        return state.modalStatus;
    },
    getEstimatedKey(state) {
        return state.estimatedKey;
    },
    getTSNom(state) {
        // if (state.config.event-based) return null;
        return state.config.clockSettings.timeSignature.numerator;
    },
    getTSDenom(state) {
        return state.config.clockSettings.timeSignature.denominator;
    },
    getTicksPerBeat(state) {
        return state.config.clockSettings.ticksPerBeat;
    },
    getTicksPerMeasure(state) {
        return state.config.clockSettings.timeSignature.numerator *
            state.config.clockSettings.ticksPerBeat;
    },
    getSecondsPerTick(state) {
        return 60 / state.currentBPM / state.config.clockSettings.ticksPerBeat;
    },
    getClockPeriod(state, getters, rootState, rootGetters) {
        return (60 / state.currentBPM / getters.getTicksPerBeat) * 1000;
    },
};

const actions = {};

const mutations = {
    setEstimatedKey(state, key) {
        state.estimatedKey = key;
    },
    setConfig(state, config) {
        state.config = config;
        state.currentBPM = config.clockSettings.defaultBPM;
    },
    writeSessionID(state, id) {
        state.sessionID = id;
        console.debug(id);
    },
    changeClockStatus(state) {
        state.clockStatus = !state.clockStatus;
    },
    setClockStatus(state, status) {
        state.clockStatus = status;
    },
    initializeClock(state) {
        state.clockInitialized = true;
    },
    setBPM(state, bpm) {
        console.debug('setBPM: ' + bpm);
        state.currentBPM = bpm;
    },
    changeModalStatus(state) {
        state.modalStatus = !state.modalStatus;
    },
};

export default {
    state,
    getters,
    actions,
    mutations,
};
