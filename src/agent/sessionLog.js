/**
 * Records what BachDuet heard and played, tick by tick, so a session can be saved
 * (Settings → "Save session") and replayed offline.
 */

export const TICK_COLUMNS = ['tickInBar', 'userMidi', 'userArtic', 'agentMidi', 'agentArtic', 'entropy', 'pChosen'];

export function createSessionLog() {
    return {
        version: 1,
        startedAt: new Date().toISOString(),
        // one row per clock tick: what the user played at that tick and the note BachDuet chose
        // (BachDuet's note sounds on the NEXT tick); midi 0 = rest, artic 1 = new note, 0 = held
        tickColumns: TICK_COLUMNS,
        ticks: [],
        // resets, model switches and parameter changes, with the index of the tick they happened at
        events: [],
    };
}

export function logEvent(type, data = {}) {
    const session = self.session;
    if (session) session.events.push({t: session.ticks.length, type, ...data});
}

export function logTick(row) {
    self.session?.ticks.push(row);
}
