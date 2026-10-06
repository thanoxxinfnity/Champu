'use client';

import { useEffect, useRef, useState } from 'react';
import { isRunningHere, useWorkspace } from '@/lib/store';
import { CloneAvatar } from './CloneAvatar';
import { activityOf, type Activity } from '@/lib/agent/activity';
import { iconHtml, SCENE_HTML, VARIANTS } from '@/lib/agent/activity-icons';

/**
 * Gemini-style processing indicator.
 *
 * The phrase swap is the part worth getting right: both the outgoing and the
 * incoming line occupy the same grid cell, so they cross-fade in place instead
 * of the pill snapping to a new width. The gradient sweeping through the text is
 * what reads as "thinking" — a spinner reads as "waiting".
 */

/** The same moving icon the chat's running blocks show — drawn from one string source. */
function ActivityIcon({ kind }: { kind: Activity }) {
  return <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: iconHtml(kind) }} />;
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
  // A fresh look each time the work changes, chosen at random so a long run never feels like one loop.
  const [variant, setVariant] = useState(0);
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
    setVariant(Math.floor(Math.random() * VARIANTS));
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

      <div className="thinking-shell" data-activity={kind} data-variant={variant} role="status" aria-live="polite" aria-label={current || 'Working'}>
        <span className="thinking-aurora" aria-hidden />

        <div className="thinking-badge">
          <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: SCENE_HTML }} />
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
