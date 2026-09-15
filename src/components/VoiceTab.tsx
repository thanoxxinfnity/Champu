'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The voice recordings that ship with Chomugiri.
 *
 * They live in the app rather than in anything it generates. A recording baked
 * into an exported game travels with that game to wherever the user publishes
 * it, and then its licence is their problem rather than ours — which is a
 * question nobody wants to answer after the fact. Here they are played, not
 * redistributed.
 */

interface Track {
  id: string;
  file: string;
  title: string;
  note: string;
}

const TRACKS: Track[] = [
  { id: 'narration', file: '/voice/narration.wav', title: 'Narration', note: 'Multi-speaker. The longest of the three.' },
  { id: 'voice_a', file: '/voice/voice_a.wav', title: 'Voice A', note: 'Merged take.' },
  { id: 'voice_b', file: '/voice/voice_b.wav', title: 'Voice B', note: 'Merged take, second session.' },
];

function mmss(seconds: number): string {
  if (!Number.isFinite(seconds)) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function VoiceTab() {
  // One element for all of them: several <audio> tags is several things that
  // can end up playing at once, which is the one thing a voice player must not do.
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [at, setAt] = useState(0);
  const [length, setLength] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const el = new Audio();
    audio.current = el;

    const onTime = () => setAt(el.currentTime);
    const onMeta = () => setLength(el.duration);
    const onEnd = () => { setPlaying(null); setAt(0); };
    const onError = () => { setFailed('That file would not play. It may not have been included in this build.'); setPlaying(null); };

    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('ended', onEnd);
    el.addEventListener('error', onError);

    return () => {
      el.pause();
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('ended', onEnd);
      el.removeEventListener('error', onError);
    };
  }, []);

  const toggle = (track: Track) => {
    const el = audio.current;
    if (!el) return;
    setFailed(null);

    if (playing === track.id) {
      el.pause();
      setPlaying(null);
      return;
    }

    // Switching tracks resets the position: resuming a different recording
    // from the last one's timestamp lands in the middle of a sentence.
    el.pause();
    el.src = track.file;
    el.currentTime = 0;
    setAt(0);
    setLength(0);
    void el.play().then(() => setPlaying(track.id)).catch(() => {
      setFailed('The browser would not start playback. Tap it once more — some browsers need a direct tap.');
    });
  };

  const seek = (value: number) => {
    const el = audio.current;
    if (!el || !Number.isFinite(el.duration)) return;
    el.currentTime = value;
    setAt(value);
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mono text-sm font-semibold">Voice</h3>
        <p className="mt-1 text-xs" style={{ color: 'var(--ink-dim)' }}>
          The recordings that ship with Chomugiri. They play here and on the site; they are deliberately
          not baked into anything Chomugiri generates, so a game you export carries none of them with it.
        </p>
      </div>

      {TRACKS.map((track) => {
        const active = playing === track.id;
        return (
          <div
            key={track.id}
            className="rounded-xl border p-3"
            style={{
              borderColor: active ? 'color-mix(in oklab, var(--accent) 45%, var(--line))' : 'var(--line)',
              background: active ? 'color-mix(in oklab, var(--accent) 8%, transparent)' : undefined,
            }}
          >
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => toggle(track)}
                aria-label={active ? `Pause ${track.title}` : `Play ${track.title}`}
                className="press flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-sm"
                style={{
                  borderColor: 'color-mix(in oklab, var(--accent) 45%, var(--line))',
                  color: 'var(--accent)',
                  background: 'color-mix(in oklab, var(--accent) 10%, transparent)',
                }}
              >
                {active ? '❚❚' : '▶'}
              </button>

              <div className="min-w-0 flex-1">
                <div className="mono text-[12.5px] font-semibold">{track.title}</div>
                <div className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>{track.note}</div>
              </div>

              <div className="mono shrink-0 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                {active ? `${mmss(at)} / ${mmss(length)}` : ''}
              </div>
            </div>

            {active && (
              <input
                type="range"
                min={0}
                max={Number.isFinite(length) && length > 0 ? length : 1}
                step={0.1}
                value={at}
                onChange={(e) => seek(Number(e.target.value))}
                aria-label={`Seek within ${track.title}`}
                className="mt-3 w-full"
                style={{ accentColor: 'var(--accent)' }}
              />
            )}
          </div>
        );
      })}

      {failed && (
        <p className="text-[11.5px]" style={{ color: 'var(--color-danger)' }}>{failed}</p>
      )}

      <hr className="ink-rule" />
      <p className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>
        22 kHz mono, peak-normalised. The originals were 48 kHz stereo, which is studio delivery rather
        than anything a phone needs — this is a quarter of the bytes and sounds the same through a phone
        speaker. Normalising matters because three separately recorded files are otherwise three
        different volumes.
      </p>
    </div>
  );
}
