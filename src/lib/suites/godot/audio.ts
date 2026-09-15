/**
 * Generating music and sound effects as real audio files.
 *
 * A generated game arrived silent. Silence is the single loudest sign that
 * something is a tech demo rather than a game — and it is the one gap a
 * language model cannot fill, because it cannot emit a binary.
 *
 * So the audio is synthesised here: PCM samples written into a RIFF/WAVE
 * container, which Godot imports natively with no conversion step and no
 * library to pull in. Everything is derived from a seed and a scale, so a
 * track is reproducible and two zones can be told apart by ear.
 *
 * Pure: numbers in, bytes out. Testable by parsing the header back.
 */

/** 44.1 kHz mono is plenty for a phone game and keeps the files half the size. */
export const SAMPLE_RATE = 44_100;

/** Semitone offsets from the root, by mood. */
export const SCALES = {
  /** Bright, obvious, the default for a runner. */
  major: [0, 2, 4, 5, 7, 9, 11],
  /** Tense. For a night or chase zone. */
  minor: [0, 2, 3, 5, 7, 8, 10],
  /** Neither happy nor sad, and hard to make sound wrong. */
  pentatonic: [0, 2, 4, 7, 9],
  /** Unsettling. Sparingly. */
  phrygian: [0, 1, 3, 5, 7, 8, 10],
} as const;

export type ScaleName = keyof typeof SCALES;

/** Hz for a semitone offset from A4 = 440. */
export function noteHz(semitonesFromA4: number): number {
  return 440 * Math.pow(2, semitonesFromA4 / 12);
}

/** A small deterministic PRNG, so a seed always gives the same tune. */
export function rng(seed: number): () => number {
  let s = (seed | 0) || 1;
  return () => {
    // xorshift32: short, fast, and good enough to pick notes with.
    s ^= s << 13; s |= 0;
    s ^= s >>> 17;
    s ^= s << 5; s |= 0;
    return ((s >>> 0) % 100_000) / 100_000;
  };
}

/**
 * An ADSR envelope value at time t.
 *
 * Without one every note starts and ends with a click, because a waveform cut
 * mid-cycle is a step change — and a hundred clicks a second is what makes
 * naive generated audio sound broken rather than simple.
 */
export function envelope(t: number, duration: number, attack = 0.01, release = 0.06): number {
  if (t < 0 || t > duration) return 0;
  if (t < attack) return t / attack;
  if (t > duration - release) return Math.max(0, (duration - t) / release);
  return 1;
}

export interface Voice {
  /** 'square' and 'saw' read as chiptune; 'sine' and 'triangle' sit underneath. */
  wave: 'sine' | 'square' | 'saw' | 'triangle' | 'noise';
  gain: number;
}

function sample(wave: Voice['wave'], phase: number, noise: () => number): number {
  switch (wave) {
    case 'square': return phase % 1 < 0.5 ? 1 : -1;
    case 'saw': return 2 * (phase % 1) - 1;
    case 'triangle': return 4 * Math.abs((phase % 1) - 0.5) - 1;
    case 'noise': return noise() * 2 - 1;
    case 'sine':
    default: return Math.sin(phase * Math.PI * 2);
  }
}

export interface Note {
  /** Semitones from A4. */
  pitch: number;
  /** Seconds from the start of the track. */
  at: number;
  duration: number;
  gain?: number;
  wave?: Voice['wave'];
}

/**
 * Renders notes to mono float samples in -1..1.
 *
 * Overlapping notes are summed and then soft-clipped rather than hard-limited:
 * a chord that exceeds 1.0 clipped flat buzzes, while tanh just compresses it.
 */
export function render(notes: Note[], seconds: number): Float32Array {
  const out = new Float32Array(Math.ceil(seconds * SAMPLE_RATE));
  const noise = rng(0x5eed);

  for (const note of notes) {
    const hz = noteHz(note.pitch);
    const start = Math.floor(note.at * SAMPLE_RATE);
    const length = Math.floor(note.duration * SAMPLE_RATE);
    const gain = note.gain ?? 0.25;
    const wave = note.wave ?? 'square';

    for (let i = 0; i < length; i += 1) {
      const index = start + i;
      if (index < 0 || index >= out.length) continue;
      const t = i / SAMPLE_RATE;
      const phase = hz * t;
      out[index] += sample(wave, phase, noise) * envelope(t, note.duration) * gain;
    }
  }

  for (let i = 0; i < out.length; i += 1) out[i] = Math.tanh(out[i]);
  return out;
}

/** Wraps mono float samples in a RIFF/WAVE container Godot imports directly. */
export function toWav(samples: Float32Array, sampleRate = SAMPLE_RATE): Uint8Array {
  const bytes = samples.length * 2; // 16-bit
  const out = new Uint8Array(44 + bytes);
  const view = new DataView(out.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) out[offset + i] = text.charCodeAt(i);
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);       // PCM chunk size
  view.setUint16(20, 1, true);        // PCM
  view.setUint16(22, 1, true);        // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);        // block align
  view.setUint16(34, 16, true);       // bits
  ascii(36, 'data');
  view.setUint32(40, bytes, true);

  for (let i = 0; i < samples.length; i += 1) {
    // Rounded and clamped: a value of exactly 1.0 scaled by 32768 overflows
    // int16 and wraps to a loud negative spike.
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(v * 32767), true);
  }
  return out;
}

export interface TrackOptions {
  seed?: number;
  scale?: ScaleName;
  /** Beats per minute. Faster zones want faster music. */
  bpm?: number;
  seconds?: number;
  /** Semitones from A4 for the tonic. Negative is lower. */
  root?: number;
}

/**
 * A loopable backing track.
 *
 * Three layers, because one is a beep and two is a ringtone: a bass line on the
 * root, a melody that walks the scale, and a kick on the beat. The melody is
 * random within the scale rather than a fixed riff, so two zones with different
 * seeds are actually different rather than transposed.
 */
export function track(options: TrackOptions = {}): Float32Array {
  const seconds = options.seconds ?? 30;
  const bpm = options.bpm ?? 120;
  const root = options.root ?? -12;
  const scale = SCALES[options.scale ?? 'pentatonic'];
  const pick = rng(options.seed ?? 1);

  const beat = 60 / bpm;
  const notes: Note[] = [];

  for (let b = 0; b * beat < seconds; b += 1) {
    const at = b * beat;

    // Kick on every beat: it is what makes the loop feel like it has a tempo.
    notes.push({ pitch: root - 24, at, duration: beat * 0.35, gain: 0.35, wave: 'noise' });

    // Bass alternates root and fifth every two beats.
    if (b % 2 === 0) {
      notes.push({ pitch: root + (b % 4 === 0 ? 0 : 7), at, duration: beat * 1.6, gain: 0.22, wave: 'triangle' });
    }

    // Melody: two eighth notes a beat, with rests so it breathes.
    for (const half of [0, 0.5]) {
      if (pick() < 0.28) continue;
      const step = scale[Math.floor(pick() * scale.length)];
      const octave = pick() < 0.25 ? 12 : 0;
      notes.push({
        pitch: root + 12 + step + octave,
        at: at + half * beat,
        duration: beat * 0.45,
        gain: 0.16,
        wave: 'square',
      });
    }
  }

  return render(notes, seconds);
}

/** The short sounds a runner needs. Each is a single gesture, not a tune. */
export function effect(kind: 'coin' | 'jump' | 'crash' | 'levelup'): Float32Array {
  switch (kind) {
    case 'coin':
      // Two quick rising notes — the universal "you got it".
      return render(
        [
          { pitch: 16, at: 0, duration: 0.07, gain: 0.34, wave: 'square' },
          { pitch: 23, at: 0.06, duration: 0.12, gain: 0.3, wave: 'square' },
        ],
        0.2,
      );
    case 'jump':
      return render([{ pitch: 4, at: 0, duration: 0.12, gain: 0.28, wave: 'triangle' }], 0.14);
    case 'crash':
      // Noise plus a low body, which reads as an impact rather than a beep.
      return render(
        [
          { pitch: -12, at: 0, duration: 0.4, gain: 0.45, wave: 'noise' },
          { pitch: -24, at: 0, duration: 0.5, gain: 0.35, wave: 'saw' },
        ],
        0.55,
      );
    case 'levelup':
    default:
      return render(
        [
          { pitch: 0, at: 0, duration: 0.11, gain: 0.3, wave: 'square' },
          { pitch: 4, at: 0.1, duration: 0.11, gain: 0.3, wave: 'square' },
          { pitch: 7, at: 0.2, duration: 0.11, gain: 0.3, wave: 'square' },
          { pitch: 12, at: 0.3, duration: 0.26, gain: 0.32, wave: 'square' },
        ],
        0.6,
      );
  }
}
