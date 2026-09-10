'use client';

import { useWorkspace } from '@/lib/store';

/**
 * Gemini-style processing indicator: an animated conic-gradient badge with a
 * cycling status phrase. The sweep and the phrase rotation are decoupled — the
 * ring animates on the compositor, the phrase swaps from the store.
 */
export function ThinkingBubble() {
  const thinking = useWorkspace((s) => s.thinking);
  const cancelRun = useWorkspace((s) => s.cancelRun);

  if (!thinking.active) return null;

  const elapsed = thinking.since ? Math.floor((Date.now() - thinking.since) / 1000) : 0;

  return (
    <div className="flex items-center gap-2.5 px-1 py-1">
      <div
        className="thinking-badge flex items-center gap-2.5 rounded-full px-3.5 py-2"
        role="status"
        aria-live="polite"
      >
        <span className="thinking-dot" aria-hidden />
        <span
          key={thinking.phrase}
          className="phrase-swap text-[12.5px] font-medium tracking-tight"
          style={{ color: 'var(--ink)' }}
        >
          {thinking.phrase || 'Working...'}
        </span>
        {elapsed > 2 && (
          <span className="mono text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>
            {elapsed}s
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={cancelRun}
        className="mono rounded-md border px-2 py-1 text-[10.5px] transition-colors"
        style={{ borderColor: 'var(--line)', color: 'var(--ink-faint)' }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--color-rose)';
          e.currentTarget.style.borderColor = 'var(--color-rose)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--ink-faint)';
          e.currentTarget.style.borderColor = 'var(--line)';
        }}
      >
        stop
      </button>
    </div>
  );
}
