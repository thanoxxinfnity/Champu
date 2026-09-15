# Generated audio

Empty on purpose — ~20 MB of WAV is *output*. Chomugiri writes these when it
builds the game, and they regenerate byte-identically from
`src/lib/suites/godot/audio.ts` because every track derives from a seed:
`zone_0..4.wav` and `sfx_{coin,jump,crash,levelup}.wav`.

Without them the game still runs: `audio.gd` treats a missing file as silence
rather than as a crash.
