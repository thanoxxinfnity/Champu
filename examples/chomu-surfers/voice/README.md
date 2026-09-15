# Voice lines

Empty on purpose — these are recordings, not generated output, and ~11 MB of
them. `voice.gd` names three: `narration.wav`, `voice_a.wav`, `voice_b.wav`.

They are 22 kHz mono. The originals were 48 kHz stereo, which is studio
delivery rather than anything a phone game needs — voice carries fine at 22 kHz
and it is a quarter of the bytes on a download people wait for. They are also
peak-normalised, because three files recorded separately are otherwise three
different volumes in the same game.

Which line plays when is the `LINES` dictionary at the top of `voice.gd` and
nothing else. A missing file is silence, not a crash.
