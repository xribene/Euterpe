/**
 * Which notes of a bar fragment are beamed together. Notes are {start, len, rest} in 16ths, start counted from
 * the bar line. A note can be beamed only if it is an 8th/16th value (len <= 3, incl. dotted 8th), not a rest,
 * and it starts and ends inside one beat; a beam never crosses a beat boundary, and a rest or an unbeamable note
 * breaks it. Returns arrays of indices, one per beam (2+ notes).
 * @param {Array<{start: number, len: number, rest: boolean}>} notes - in time order
 * @param {number} [beatLength=4] - 16ths per beat
 * @return {Array<Array<number>>}
 */
export function beamGroups(notes, beatLength = 4) {
    const groups = [];
    let run = [];
    let runBeat = -1;
    const flush = () => {
        if (run.length >= 2) groups.push(run);
        run = [];
        runBeat = -1;
    };
    notes.forEach((n, i) => {
        const beat = Math.floor(n.start / beatLength);
        const endBeat = Math.floor((n.start + n.len - 1) / beatLength);
        const beamable = !n.rest && n.len <= 3 && beat === endBeat;
        if (!beamable || (run.length > 0 && beat !== runBeat)) flush();
        if (beamable) {
            run.push(i);
            runBeat = beat;
        }
    });
    flush();
    return groups;
}
