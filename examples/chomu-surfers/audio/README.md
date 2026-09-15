# Generated audio

Empty on purpose. The five stage tracks and four effects are ~20 MB of WAV, and
they are *output* — regenerating them from `src/lib/suites/godot/audio.ts` gives
byte-identical files, because every track is derived from a seed.

Chomugiri writes them into the project automatically. To rebuild them by hand:

```js
import { effect, toWav, track } from '../../../src/lib/suites/godot/audio.ts';
const zones = [
  { seed: 1101, scale: 'pentatonic', bpm: 104, root: -12 },  // Sunset Yard
  { seed: 2204, scale: 'minor',      bpm: 124, root: -10 },  // Neon District
  { seed: 3307, scale: 'major',      bpm: 136, root: -7  },  // Frost Line
  { seed: 4410, scale: 'phrygian',   bpm: 148, root: -14 },  // Ember Deep
  { seed: 5513, scale: 'minor',      bpm: 160, root: -17 },  // The Void
];
zones.forEach((z, i) => write(`zone_${i}.wav`, toWav(track({ ...z, seconds: 48 }))));
for (const k of ['coin', 'jump', 'crash', 'levelup']) write(`sfx_${k}.wav`, toWav(effect(k)));
```

Without them the game still runs — `audio.gd` treats a missing file as silence
rather than as a crash.
