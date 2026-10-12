/**
 * Audio sync: a track attached to the project (a data: URL so the project stays one portable JSON blob,
 * same as an image layer), and a pure peak-extraction function for drawing its waveform on the timeline.
 *
 * Decoding the file itself needs the browser's Web Audio API, so that part lives in the React component;
 * `peaksFromSamples` is the pure, testable half — given the raw channel samples it already decoded, turn
 * them into a fixed number of min/max buckets to draw, independent of how long the clip actually is.
 */

export type AudioRole = 'bgm' | 'sfx' | 'voice';

export interface AudioTrack {
  name: string;
  /** A data: URL — the decoded file re-encoded as nothing extra; this is the original upload, verbatim. */
  dataUrl: string;
  duration: number;
  /** Seconds into the project where the clip starts playing. */
  offset: number;
  /** Which of the project's 3 audio slots this clip occupies — music bed, one-off sound effects, or dialogue (the one a lip-sync guide reads from). */
  role: AudioRole;
  volume: number;
  muted: boolean;
}

export function newAudioTrack(role: AudioRole, name: string, dataUrl: string, duration: number): AudioTrack {
  return { name, dataUrl, duration, offset: 0, role, volume: 1, muted: false };
}

export interface WaveformBucket {
  min: number;
  max: number;
}

/**
 * Downsample a mono (or already-mixed) channel of samples in [-1, 1] into `bucketCount` min/max pairs,
 * suitable for drawing a classic waveform strip regardless of the clip's actual sample count.
 */
export function peaksFromSamples(samples: Float32Array | number[], bucketCount: number): WaveformBucket[] {
  const n = samples.length;
  if (n === 0 || bucketCount <= 0) return [];
  const perBucket = n / bucketCount;
  const out: WaveformBucket[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const start = Math.floor(i * perBucket);
    const end = Math.max(start + 1, Math.floor((i + 1) * perBucket));
    let min = Infinity, max = -Infinity;
    for (let j = start; j < end && j < n; j++) {
      const v = samples[j]!;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!Number.isFinite(min)) { min = 0; max = 0; }
    out.push({ min, max });
  }
  return out;
}

/** Mix multiple channels (e.g. stereo) down to one, by simple averaging — for waveform display only. */
export function mixChannelsDown(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0]!;
  const n = channels[0]!.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (const ch of channels) sum += ch[i] ?? 0;
    out[i] = sum / channels.length;
  }
  return out;
}

/**
 * Simple energy-based beat/onset detector (the classic "instant energy vs. a local average, scaled by
 * local variance" approach): split the track into small windows, and flag a window as a beat whenever its
 * energy spikes well above the recent local average — the variance scaling is what makes a loud, steady
 * passage not constantly false-trigger, and a quiet passage still catch its own, smaller accents.
 */
export function detectBeats(samples: Float32Array | number[], sampleRate: number, windowSize = 1024, historyWindows = 43): number[] {
  const n = samples.length;
  if (n === 0 || sampleRate <= 0) return [];
  const windowCount = Math.floor(n / windowSize);
  const energies: number[] = [];
  for (let w = 0; w < windowCount; w++) {
    let sum = 0;
    const start = w * windowSize;
    for (let i = start; i < start + windowSize; i++) { const v = samples[i] ?? 0; sum += v * v; }
    energies.push(sum / windowSize);
  }
  const beats: number[] = [];
  let lastBeatWindow = -Infinity;
  const minGapWindows = Math.max(1, Math.round((sampleRate * 0.12) / windowSize)); // never two beats within ~120ms
  for (let w = 0; w < energies.length; w++) {
    const histStart = Math.max(0, w - historyWindows);
    const hist = energies.slice(histStart, w);
    if (hist.length < 4) continue;
    const avg = hist.reduce((a, b) => a + b, 0) / hist.length;
    const variance = hist.reduce((a, b) => a + (b - avg) ** 2, 0) / hist.length;
    const threshold = -0.0025714 * variance + 1.5142857; // Patin's beat-detection constant, tuned for small windows
    const instant = energies[w]!;
    // floor the local average so a spike straight out of true digital silence (avg == 0, no real-world noise
    // floor to compare against) still reads as anomalously loud, instead of being unable to ever clear a 0 baseline
    const avgFloor = Math.max(avg, 1e-6);
    if (instant > avgFloor * threshold && w - lastBeatWindow >= minGapWindows) {
      beats.push((w * windowSize) / sampleRate);
      lastBeatWindow = w;
    }
  }
  return beats;
}

/**
 * A per-frame "mouth openness" envelope (0..1) for lip-sync — the voice track's amplitude, windowed at the
 * project's own frame rate and smoothed so it doesn't chatter: this is deliberately a loudness proxy, not
 * phoneme recognition (far too heavy for a 2D sketch tool), but it gives a believable mouth-flap guide a
 * real voice clip can be keyframed against.
 */
export function lipSyncEnvelope(samples: Float32Array | number[], sampleRate: number, fps: number): number[] {
  const n = samples.length;
  if (n === 0 || sampleRate <= 0 || fps <= 0) return [];
  const duration = n / sampleRate;
  const frameCount = Math.max(1, Math.ceil(duration * fps));
  const samplesPerFrame = sampleRate / fps;
  const raw: number[] = [];
  let peak = 1e-6;
  for (let f = 0; f < frameCount; f++) {
    const start = Math.floor(f * samplesPerFrame);
    const end = Math.min(n, Math.floor((f + 1) * samplesPerFrame));
    let sum = 0, count = 0;
    for (let i = start; i < end; i++) { const v = samples[i] ?? 0; sum += v * v; count++; }
    const rms = count > 0 ? Math.sqrt(sum / count) : 0;
    raw.push(rms);
    if (rms > peak) peak = rms;
  }
  // light one-pole smoothing so consecutive frames don't snap open/closed on every zero-crossing
  const out: number[] = [];
  let smoothed = 0;
  for (const v of raw) {
    const target = Math.max(0, Math.min(1, v / peak));
    smoothed = smoothed + (target - smoothed) * 0.6;
    out.push(smoothed);
  }
  return out;
}
