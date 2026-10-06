'use client';

import { useEffect, useRef, useState } from 'react';
import { isRunningHere, useWorkspace } from '@/lib/store';
import { CloneAvatar } from './CloneAvatar';
import { activityOf, type Activity } from '@/lib/agent/activity';

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


/**
 * One small moving picture per kind of work, so a glance says what is happening before the words do.
 * Every one is plain SVG driven by CSS (transform / opacity / stroke-dashoffset only), no JS timers.
 */
function ActivityIcon({ kind }: { kind: Activity }) {
  if (kind === 'think') return <Sparkle />;
  return (
    <span className={`act-icon act-${kind}`} aria-hidden>
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {kind === 'terminal' && (
          <>
            <rect x="1.5" y="3" width="17" height="14" rx="3" />
            <path d="M5 8l3 2-3 2" />
            <path className="t-cursor" d="M10.5 13h4" />
          </>
        )}
        {kind === 'write' && (
          <>
            <path className="w-line w1" d="M3 6h9" />
            <path className="w-line w2" d="M3 10h12" />
            <path className="w-line w3" d="M3 14h7" />
            <g className="w-pen">
              <path d="M13 17l5-5-1.6-1.6-5 5z" fill="currentColor" stroke="none" />
            </g>
          </>
        )}
        {kind === 'download' && (
          <>
            <path className="d-arrow" d="M10 2v9m-4-4l4 4 4-4" />
            <path d="M3 14v2.5h14V14" />
            <path className="d-fill" d="M3 16.5h14" strokeWidth="2.4" />
          </>
        )}
        {kind === 'paint' && (
          <>
            <path className="p-stroke ps1" d="M3 15c3-8 5-8 7 0s4 8 7 0" />
            <circle className="p-drop" cx="16" cy="4.5" r="1.6" fill="currentColor" stroke="none" />
            <circle className="p-drop pd2" cx="4" cy="4.5" r="1.2" fill="currentColor" stroke="none" />
          </>
        )}
        {kind === 'build' && (
          <g className="b-gear">
            <circle cx="10" cy="10" r="3" />
            <path d="M10 1.8v2.4M10 15.8v2.4M1.8 10h2.4M15.8 10h2.4M4.2 4.2l1.7 1.7M14.1 14.1l1.7 1.7M4.2 15.8l1.7-1.7M14.1 5.9l1.7-1.7" />
          </g>
        )}
        {kind === 'search' && (
          <g className="s-orbit">
            <circle cx="8.5" cy="8.5" r="5" />
            <path d="M12.2 12.2L17 17" />
          </g>
        )}
        {kind === 'deploy' && (
          <g className="r-rocket">
            <path d="M10 2c3 2 4 5 3.5 9h-7C6 7 7 4 10 2z" />
            <circle cx="10" cy="7.5" r="1.3" />
            <path className="r-flame" d="M8.5 13.5L10 18l1.5-4.5" />
          </g>
        )}
        {kind === 'audio' && (
          <>
            <path className="a-bar a1" d="M4 10v0" strokeWidth="2.6" />
            <path className="a-bar a2" d="M8 10v0" strokeWidth="2.6" />
            <path className="a-bar a3" d="M12 10v0" strokeWidth="2.6" />
            <path className="a-bar a4" d="M16 10v0" strokeWidth="2.6" />
          </>
        )}
        {kind === 'plan' && (
          <>
            <path className="l-tick lt1" d="M3 5.5l1.7 1.7L7.6 4" />
            <path className="l-tick lt2" d="M3 11l1.7 1.7L7.6 9.5" />
            <path className="l-tick lt3" d="M3 16.5l1.7 1.7L7.6 15" transform="translate(0 -1.2)" />
            <path d="M10.5 5.5H17M10.5 11H17M10.5 15.8H15" opacity=".55" />
          </>
        )}
        {kind === 'read' && (
          <>
            <path d="M2.5 4.5c2.5-1 5-1 7.5 1v11c-2.5-2-5-2-7.5-1zM17.5 4.5c-2.5-1-5-1-7.5 1v11c2.5-2 5-2 7.5-1z" />
            <path className="rd-scan" d="M4.5 9h3M12.5 9h3" />
          </>
        )}
      </svg>
    </span>
  );
}

const IDLE = { active: false, phrase: '', since: 0 };

export function ThinkingBubble() {
  // Each session has its own bubble: this one shows what the session on screen is doing.
  const thinking = useWorkspace((s) => (s.sessionId ? s.thinkingBy[s.sessionId] : undefined)) ?? IDLE;
  const cancelRun = useWorkspace((s) => s.cancelRun);
  // "Running" belongs to the one session whose run it is; every other session is idle.
  const runningHere = useWorkspace(isRunningHere);

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

  if (!thinking.active || !runningHere) return null;
  const kind = activityOf(current || thinking.phrase);

  return (
    <div className="enter-pop flex items-center gap-2.5 py-1">
      <CloneAvatar active size={38} />

      <div className="thinking-shell" data-activity={kind} role="status" aria-live="polite" aria-label={current || 'Working'}>
        <span className="thinking-aurora" aria-hidden />

        <div className="thinking-badge">
          <ActivityIcon kind={kind} />

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

          <span className="act-tail" aria-hidden>
            <i /><i /><i />
          </span>

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
