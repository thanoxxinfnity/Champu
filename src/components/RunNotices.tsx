'use client';

import { useCallback } from 'react';
import { openSessionById } from '@/lib/session/open';
import { useWorkspace } from '@/lib/store';
import type { RunNotice } from '@/lib/store';

/**
 * Finished background runs, announced and then gone.
 *
 * A run you started before wandering off should tell you it is done, say what
 * it was about, and take you back to it — without leaving anything behind in
 * the transcript. So these are transient: they fade themselves out, and double
 * -clicking one jumps straight to the conversation it belongs to.
 */

const SUITE_LABEL: Record<string, string> = {
  chat: 'Chat',
  android: 'Android',
  minecraft: 'Minecraft',
  studio: 'Studio',
  mcp: 'MCP Builder',
  workdrive: 'Workdrive',
  assets: 'Asset Studio',
  skills: 'Skills',
};

export function RunNotices() {
  const notices = useWorkspace((s) => s.notices);
  const dismissNotice = useWorkspace((s) => s.dismissNotice);
  const currentSession = useWorkspace((s) => s.sessionId);

  const jump = useCallback(
    async (notice: RunNotice) => {
      dismissNotice(notice.id);
      if (notice.sessionId === currentSession) return;
      await openSessionById(notice.sessionId);
    },
    [currentSession, dismissNotice],
  );

  if (!notices.length) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-3 right-3 z-50 flex w-[min(21rem,calc(100vw-1.5rem))] flex-col gap-2"
      aria-live="polite"
    >
      {notices.map((notice) => {
        const failed = notice.status === 'failed';
        return (
          <button
            key={notice.id}
            type="button"
            // Double-click is the quick jump; a single click only dismisses, so
            // brushing past a notice never yanks the user out of what they are
            // reading.
            onDoubleClick={() => void jump(notice)}
            onClick={() => dismissNotice(notice.id)}
            className={`notice-pop pointer-events-auto w-full rounded-xl border p-2.5 text-left ${failed ? '' : 'notice-glow'}`}
            style={{
              borderColor: failed
                ? 'color-mix(in oklab, var(--color-danger) 50%, var(--line))'
                : 'color-mix(in oklab, var(--accent) 55%, var(--line))',
              background: 'var(--panel)',
            }}
            title="Double-click to open this run · click to dismiss"
          >
            <span
              className="mono flex items-center gap-1.5 text-[9.5px] uppercase tracking-[0.12em]"
              style={{ color: failed ? 'var(--color-danger)' : 'var(--accent)' }}
            >
              <span aria-hidden>{failed ? '✕' : '✔'}</span>
              {failed ? 'run failed' : 'run finished'}
              <span style={{ color: 'var(--ink-faint)' }}>· {SUITE_LABEL[notice.suite] ?? notice.suite}</span>
            </span>

            <span className="mt-1 block truncate text-[12.5px]" style={{ color: 'var(--ink)' }}>
              {notice.topic}
            </span>

            <span className="mono mt-0.5 block truncate text-[10px]" style={{ color: 'var(--ink-faint)' }}>
              {notice.detail ?? 'double-click to open'}
            </span>
          </button>
        );
      })}
    </div>
  );
}
