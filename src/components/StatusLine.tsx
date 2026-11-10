'use client';

/**
 * The line under the message box, as a terminal agent has one: is the terminal connected (and how fast), which model answers, and
 * where it works. The terminal part is a button: a tap asks the terminal again right now, so "offline" is never a stale guess, and
 * when nothing is set up yet it opens Settings.
 */
import { useState } from 'react';
import { useWorkspace } from '@/lib/store';
import { Icon } from '@/components/Icon';

const TONE = {
  online: 'var(--accent)',
  degraded: 'var(--color-amber)',
  connecting: 'var(--ink-faint)',
  unknown: 'var(--ink-faint)',
  offline: 'var(--color-rose)',
  unauthorized: 'var(--color-rose)',
} as const;

export function StatusLine({ onOpenSettings }: { onOpenSettings: () => void }) {
  const heartbeat = useWorkspace((s) => s.heartbeat);
  const monitor = useWorkspace((s) => s.monitor);
  const configured = useWorkspace((s) => s.bridge.configured);
  const model = useWorkspace((s) => s.selection.model);
  const [asking, setAsking] = useState(false);

  const status = heartbeat.status;
  const word = !configured ? 'terminal not set up'
    : asking ? 'checking terminal'
      : status === 'online' ? `terminal online${heartbeat.latencyMs != null ? ` ${heartbeat.latencyMs}ms` : ''}`
        : status === 'degraded' ? 'terminal unstable'
          : status === 'unauthorized' ? 'terminal refused the token'
            : status === 'offline' ? 'terminal offline, tap to retry'
              : 'connecting to terminal';
  const tone = !configured ? 'var(--ink-faint)' : asking ? 'var(--ink-faint)' : TONE[status] ?? 'var(--ink-faint)';
  const folder = heartbeat.health?.workspace ? heartbeat.health.workspace.replace(/^.*[\\/]/, '') : null;

  const tap = async () => {
    if (!configured || status === 'unauthorized') { onOpenSettings(); return; }
    if (!monitor || asking) return;
    setAsking(true);
    try { await Promise.race([monitor.ping(), new Promise((r) => setTimeout(r, 9000))]); } finally { setAsking(false); }
  };

  return (
    <div className="status-line mono flex items-center gap-x-3 gap-y-0.5 overflow-hidden px-4 pb-1.5 pt-0.5 text-[10.5px]" style={{ color: 'var(--ink-faint)' }} data-testid="status-line">
      <button type="button" onClick={() => void tap()} className="press inline-flex shrink-0 items-center gap-1.5 py-1" style={{ color: tone }} title={heartbeat.lastError ?? 'Tap to ask the terminal again'} data-testid="status-terminal" data-status={configured ? status : 'unset'}>
        <span className="relative flex h-2 w-2">
          {status === 'online' && configured && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-40" style={{ background: tone }} />}
          <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: tone }} />
        </span>
        <Icon name="terminal" size={12} />
        <span>{word}</span>
      </button>
      <span className="inline-flex min-w-0 items-center gap-1 truncate" title={model}>
        <Icon name="bolt" size={11} />
        <span className="truncate">{model.split('/').pop()}</span>
      </span>
      {folder && (
        <span className="hidden min-w-0 items-center gap-1 truncate sm:inline-flex" title={heartbeat.health?.workspace}>
          <Icon name="folder" size={11} />
          <span className="truncate">{folder}</span>
        </span>
      )}
    </div>
  );
}
