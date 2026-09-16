'use client';

/**
 * The game, playing in the chat.
 *
 * Deliberately behind a press rather than auto-loading. The build is tens of
 * megabytes of WebAssembly and a phone will feel it, so nobody should pay for
 * it by scrolling past — and browsers keep audio muted until a real gesture
 * arrives anyway, so a game that started on its own would start silent.
 */

import { useEffect, useRef, useState } from 'react';
import { playerFrameSrc, takePlayable } from '@/lib/suites/godot/web-export';

export function GamePlayer({ id, label }: { id: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const revoke = useRef<(() => void) | null>(null);

  // The object URLs are released when this unmounts, or the tab holds every
  // build of the session in memory at once.
  useEffect(() => () => revoke.current?.(), []);

  const play = () => {
    const files = takePlayable(id);
    if (!files) {
      setGone(true);
      return;
    }
    const made = playerFrameSrc(files);
    revoke.current = made.revoke;
    setSrc(made.src);
  };

  if (gone) {
    return (
      <p className="mono mt-2 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
        That build is not in memory any more — a reload clears it. Ask again and it recompiles.
      </p>
    );
  }

  if (!src) {
    return (
      <button
        type="button"
        onClick={play}
        className="mono mt-2 rounded border px-3 py-1.5 text-[11px]"
        style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
      >
        ▶ Play here — {label}
      </button>
    );
  }

  return (
    <div className="mt-2 overflow-hidden rounded-lg border" style={{ borderColor: 'var(--line)' }}>
      <iframe
        src={src}
        title="Game"
        // Landscape-ish and tall enough for the touch controls, which lay
        // themselves out from whatever size they are actually given.
        className="block h-[420px] w-full"
        // Same-origin so the blob URLs made in this document resolve, scripts
        // so the engine runs. Nothing else: the frame has no reason to
        // navigate the tab or open a window.
        sandbox="allow-scripts allow-same-origin allow-pointer-lock"
        allow="autoplay; fullscreen; gamepad"
      />
    </div>
  );
}
