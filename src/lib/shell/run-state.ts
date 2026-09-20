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
      // Fire-and-forget already, but an unbounded hung request is still a
      // leaked connection nothing ever cleans up.
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // The shell is a convenience; the run continues without it.
  }
}

export async function runStarted(topic: string): Promise<void> {
  await tell({ active: true, topic });
}

/**
 * Mirrors the step currently being narrated to the background notification.
 *
 * `runStarted` sets the notification once, at the top of a run, to the user's
 * original prompt — and nothing updated it after that. The narration itself
 * ("Creating `bp/manifest.json`...", "Sending it to a Kaggle GPU.") kept
 * happening in the transcript the whole time; it just stopped being visible
 * the moment the screen went off, because nothing told the notification about
 * it. This is that missing call — same wire shape as `runStarted`
 * (`{active: true, topic}`), which `RunService` already treats as "update the
 * ongoing notification's text" whether it is the first call of a run or the
 * tenth.
 *
 * Wired into `setThinking` in the store rather than into every narration call
 * site in runtime.ts individually, so nothing has to remember to call it.
 */
export async function updateRunProgress(phrase: string): Promise<void> {
  await tell({ active: true, topic: phrase });
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
