/**
 * Download a session recorded by the agent (src/agent/sessionLog.js) as JSON and as a
 * two-track MIDI file (track 1: user, track 2: agent).
 */

const PPQ = 480;

function download(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// MIDI variable-length quantity
function vlq(n) {
    const bytes = [n & 0x7f];
    while ((n >>= 7) > 0) bytes.unshift((n & 0x7f) | 0x80);
    return bytes;
}

function chunk(type, data) {
    const len = data.length;
    return [...type].map((c) => c.charCodeAt(0))
        .concat([(len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255], data);
}

/**
 * Notes of one voice from per-tick [midi, artic] pairs: a note starts on artic 1 (or a pitch change)
 * and lasts until the next start or rest.
 * @return {Array<{start: number, end: number, midi: number}>} in ticks
 */
function notesOf(pairs, offset) {
    const notes = [];
    let current = null;
    pairs.forEach(([midi, artic], t) => {
        const startsNew = midi !== 0 && (artic === 1 || !current || current.midi !== midi);
        if (current && (midi === 0 || startsNew)) {
            current.end = t + offset;
            notes.push(current);
            current = null;
        }
        if (startsNew) current = {start: t + offset, midi};
    });
    if (current) {
        current.end = pairs.length + offset;
        notes.push(current);
    }
    return notes;
}

function trackFromNotes(notes, channel, ticksPerStep, name) {
    const events = [];
    notes.forEach((n) => {
        events.push({time: n.start * ticksPerStep, bytes: [0x90 | channel, n.midi, 90]});
        events.push({time: n.end * ticksPerStep, bytes: [0x80 | channel, n.midi, 0]});
    });
    // note-offs before note-ons at the same time
    events.sort((a, b) => a.time - b.time || (a.bytes[0] & 0xf0) - (b.bytes[0] & 0xf0));
    const nameBytes = [...new TextEncoder().encode(name)];
    let data = [0, 0xff, 0x03, ...vlq(nameBytes.length), ...nameBytes];
    let last = 0;
    events.forEach((e) => {
        data = data.concat(vlq(e.time - last), e.bytes);
        last = e.time;
    });
    data = data.concat([0, 0xff, 0x2f, 0]);
    return chunk('MTrk', data);
}

/**
 * @param {Object} session - from the agent
 * @param {Object} info - {bpm, ticksPerBeat}
 * @return {Uint8Array} a MIDI file
 */
export function sessionToMidi(session, {bpm, ticksPerBeat}) {
    const col = Object.fromEntries(session.tickColumns.map((c, i) => [c, i]));
    const user = session.ticks.map((r) => [r[col.userMidi], r[col.userArtic]]);
    // BachDuet's note chosen at tick t sounds at tick t + 1
    const agent = session.ticks.map((r) => [r[col.agentMidi], r[col.agentArtic]]);
    const ticksPerStep = PPQ / ticksPerBeat;
    const usPerBeat = Math.round(60e6 / bpm);
    const tempoTrack = chunk('MTrk', [0, 0xff, 0x51, 0x03, (usPerBeat >> 16) & 255, (usPerBeat >> 8) & 255,
        usPerBeat & 255, 0, 0xff, 0x58, 0x04, 4, 2, 24, 8, 0, 0xff, 0x2f, 0]);
    const header = chunk('MThd', [0, 1, 0, 3, (PPQ >> 8) & 255, PPQ & 255]);
    return new Uint8Array([
        ...header,
        ...tempoTrack,
        ...trackFromNotes(notesOf(user, 0), 0, ticksPerStep, 'User'),
        ...trackFromNotes(notesOf(agent, 1), 1, ticksPerStep, session.model ?? 'BachDuet'),
    ]);
}

export function downloadSession(session, {bpm, ticksPerBeat}) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const base = `bachduet-session-${stamp}`;
    const full = {...session, savedAt: new Date().toISOString(), bpm, ticksPerBeat};
    download(`${base}.json`, new Blob([JSON.stringify(full)], {type: 'application/json'}));
    download(`${base}.mid`, new Blob([sessionToMidi(session, {bpm, ticksPerBeat})], {type: 'audio/midi'}));
}
