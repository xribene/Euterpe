"""Extract Bach 4-voice chorales in 4/4 from the music21 corpus onto a 16th-note grid.

Each voice becomes a list of tokens, one per 16th step:
  int  -> new note onset (MIDI number)
  "h"  -> the previous note keeps sounding (hold / tie)
  "r"  -> rest
Step 0 is always a downbeat (pickup measures are padded with rests).
"""
import json
import sys

from music21 import corpus, meter, note, chord

OUT = sys.argv[1] if len(sys.argv) > 1 else 'chorales.json'


def voice_tokens(part, pad_steps, n_steps):
    toks = ['r'] * n_steps
    for el in part.flatten().notesAndRests:
        start = el.offset * 4 + pad_steps
        dur = el.duration.quarterLength * 4
        if start != int(start) or dur != int(dur) or dur == 0:
            raise ValueError('off-grid')
        start, dur = int(start), int(dur)
        if isinstance(el, note.Rest):
            continue
        midi = el.pitch.midi if isinstance(el, note.Note) else max(p.midi for p in el.pitches)
        tied_cont = el.tie is not None and el.tie.type in ('continue', 'stop')
        for k in range(dur):
            if start + k < n_steps:
                toks[start + k] = 'h' if (k > 0 or tied_cont) else midi
    return toks


out = []
skipped = {}
for path in corpus.getComposer('bach'):
    try:
        s = corpus.parse(path)
        if len(s.parts) != 4:
            raise ValueError('not 4 parts')
        ts = s.recurse().getElementsByClass(meter.TimeSignature).first()
        if ts is None or ts.ratioString != '4/4':
            raise ValueError('not 4/4')
        first_measure = s.parts[0].getElementsByClass('Measure').first()
        pad = first_measure.paddingLeft if first_measure is not None else 0
        pad_steps = int(round(pad * 4))
        n_steps = pad_steps + int(round(s.highestTime * 4))
        voices = [voice_tokens(p, pad_steps, n_steps) for p in s.parts]
        key = s.analyze('key')
        out.append({
            'id': str(path).split('/')[-1].rsplit('.', 1)[0],
            'key': f'{key.tonic.name} {key.mode}',
            'steps': n_steps,
            'voices': dict(zip(['S', 'A', 'T', 'B'], voices)),
        })
    except Exception as e:  # noqa: BLE001
        skipped[str(e)[:40]] = skipped.get(str(e)[:40], 0) + 1

# drop duplicate chorales (same soprano line)
seen, uniq = set(), []
for c in out:
    sig = tuple(c['voices']['S'])
    if sig not in seen:
        seen.add(sig)
        uniq.append(c)

json.dump(uniq, open(OUT, 'w'))
print(f'kept {len(uniq)} unique chorales ({len(out)} before dedup); skipped: {skipped}')
steps = sorted(c['steps'] for c in uniq)
print(f'steps per chorale: min {steps[0]} median {steps[len(steps)//2]} max {steps[-1]}')
c = uniq[0]
print(c['id'], c['key'], 'S[:16]=', c['voices']['S'][:16], 'B[:16]=', c['voices']['B'][:16])
