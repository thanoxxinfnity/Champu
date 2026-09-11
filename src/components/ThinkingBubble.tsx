'use client';

import { useEffect, useRef, useState } from 'react';
import { useWorkspace } from '@/lib/store';
import { CloneAvatar } from './CloneAvatar';

/**
 * Gemini-style processing indicator.
 *
 * The phrase swap is the part worth getting right: both the outgoing and the
 * incoming line occupy the same grid cell, so they cross-fade in place instead
 * of the pill snapping to a new width. The gradient sweeping through the text is
 * what reads as "thinking" — a spinner reads as "waiting".
 */

function Sparkle() {
  return (
    <span className="thinking-spark" aria-hidden>
      <svg viewBox="0 0 16 16" fill="none">
        <path
          className="spark-lg"
          d="M8 0.8 L9.5 6.5 L15.2 8 L9.5 9.5 L8 15.2 L6.5 9.5 L0.8 8 L6.5 6.5 Z"
          fill="url(#spark-a)"
        />
        <path
          className="spark-sm"
          d="M13 1 L13.7 3.3 L16 4 L13.7 4.7 L13 7 L12.3 4.7 L10 4 L12.3 3.3 Z"
          fill="url(#spark-b)"
        />
        <defs>
          <linearGradient id="spark-a" x1="0" y1="0" x2="16" y2="16">
            <stop offset="0%" stopColor="var(--accent)" />
            <stop offset="100%" stopColor="var(--accent-alt)" />
          </linearGradient>
          <linearGradient id="spark-b" x1="10" y1="1" x2="16" y2="7">
            <stop offset="0%" stopColor="var(--accent-alt)" />
            <stop offset="100%" stopColor="var(--accent)" />
          </linearGradient>
        </defs>
      </svg>
    </span>
  );
}

export function ThinkingBubble() {
  const thinking = useWorkspace((s) => s.thinking);
  const cancelRun = useWorkspace((s) => s.cancelRun);

  const [current, setCurrent] = useState('');
  const [previous, setPrevious] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hold the outgoing phrase just long enough for its exit animation to play.
  useEffect(() => {
    const next = thinking.phrase;
    if (!next || next === current) return;

    if (current) {
      setPrevious(current);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setPrevious(null), 320);
    }
    setCurrent(next);
  }, [thinking.phrase, current]);

  useEffect(() => {
    if (!thinking.active) {
      setCurrent('');
      setPrevious(null);
      setElapsed(0);
      return;
    }
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - thinking.since) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [thinking.active, thinking.since]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  if (!thinking.active) return null;

  return (
    <div className="enter-pop flex items-center gap-2.5 py-1">
      <CloneAvatar active size={38} />

      <div className="thinking-shell" role="status" aria-live="polite" aria-label={current || 'Working'}>
        <span className="thinking-aurora" aria-hidden />

        <div className="thinking-badge">
          <Sparkle />

          <div className="thinking-phrase-track">
            {previous && (
              <span key={previous} className="thinking-phrase is-leaving">
                {previous}
              </span>
            )}
            <span key={current} className="thinking-phrase is-entering">
              {current || 'Working…'}
            </span>
          </div>

          {elapsed > 2 && (
            <span className="mono shrink-0 text-[10px] tabular-nums" style={{ color: 'var(--ink-faint)' }}>
              {elapsed}s
            </span>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={cancelRun}
        className="press mono rounded-lg border px-2.5 py-1.5 text-[10.5px]"
        style={{ borderColor: 'var(--line)', color: 'var(--ink-faint)' }}
        onPointerEnter={(e) => {
          e.currentTarget.style.color = 'var(--color-rose)';
          e.currentTarget.style.borderColor = 'color-mix(in oklab, var(--color-rose) 45%, var(--line))';
        }}
        onPointerLeave={(e) => {
          e.currentTarget.style.color = 'var(--ink-faint)';
          e.currentTarget.style.borderColor = 'var(--line)';
        }}
      >
        stop
      </button>
    </div>
  );
}
