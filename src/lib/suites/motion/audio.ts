/**
 * Audio sync: a track attached to the project (a data: URL so the project stays one portable JSON blob,
 * same as an image layer), and a pure peak-extraction function for drawing its waveform on the timeline.
 *
 * Decoding the file itself needs the browser's Web Audio API, so that part lives in the React component;
 * `peaksFromSamples` is the pure, testable half — given the raw channel samples it already decoded, turn
 * them into a fixed number of min/max buckets to draw, independent of how long the clip actually is.
 */

export interface AudioTrack {
  name: string;
  /** A data: URL — the decoded file re-encoded as nothing extra; this is the original upload, verbatim. */
  dataUrl: string;
  duration: number;
  /** Seconds into the project where the clip starts playing. */
  offset: number;
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
