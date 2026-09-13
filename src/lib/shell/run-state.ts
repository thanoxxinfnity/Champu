'use client';

import { isShellHosted } from '@/lib/keys';

/**
 * Telling the Android shell that a run is in flight.
 *
 * The whole agent loop is driven from the page, so only the page knows when
 * work is happening — and Android freezes a backgrounded process at its own
 * discretion, which is what used to kill a build the moment the user switched
 * apps. The shell answers this by holding the process open with a foreground
 * service for exactly as long as the run, and taking its notification away the
 * instant the run ends.
 *
 * In a browser there is no shell and nothing to do: every call is a no-op, so
 * the runtime does not need to know which platform it is on.
 */

async function tell(payload: Record<string, unknown>): Promise<void> {
  try {
    if (!(await isShellHosted())) return;
    await fetch('/api/shell/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      // A failure here must never take a run down with it.
      keepalive: true,
    });
  } catch {
    // The shell is a convenience; the run continues without it.
  }
}

export async function runStarted(topic: string): Promise<void> {
  await tell({ active: true, topic });
}

export async function runFinished(opts: {
  topic: string;
  ok: boolean;
  summary?: string;
  /** True when the user has moved away and should be told it finished. */
  notify: boolean;
}): Promise<void> {
  await tell({ active: false, topic: opts.topic, ok: opts.ok, summary: opts.summary ?? '', notify: opts.notify });
}
