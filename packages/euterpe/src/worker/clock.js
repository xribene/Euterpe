/* eslint-disable require-jsdoc */
let bpm = 100;
// clockSettings.ticksPerBeat, and clockSettings.clockPeriod (ms, free time: overrides bpm and ticksPerBeat)
let ticksPerBeat = 4;
let clockPeriod = null;
let isRunning = false;
let intervalId = null;

function startClock() {
    if (!isRunning) {
        isRunning = true;
        intervalId = setInterval(tick, clockPeriod ?? 1000 * 60 / bpm / ticksPerBeat);
    }
}

function stopClock() {
    if (isRunning) {
        isRunning = false;
        clearInterval(intervalId);
    }
}

function tick() {
    postMessage('tick');
    // console.debug("tick");
}

self.onmessage = function(msg) {
    const data = msg.data;
    if (data.action === 'setBPM') {
        bpm = data.bpm;
        if (data.ticksPerBeat) ticksPerBeat = data.ticksPerBeat;
        if (data.clockPeriod !== undefined) clockPeriod = data.clockPeriod || null;
        // if (isRunning) {
        //   stopClock();
        //   startClock();
        // }
    } else if (data.action === 'startClock') {
        startClock();
    } else if (data.action === 'stopClock') {
        stopClock();
    }
};
