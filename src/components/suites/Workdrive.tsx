'use client';

import { useCallback, useEffect, useState } from 'react';
import { withKeys } from '@/lib/keys';
import { useWorkspace } from '@/lib/store';
import { getResearchRun, listResearchRuns, saveResearchRun, uid } from '@/lib/db/history';
import type { ResearchRunRecord } from '@/lib/db/schema';
import { send } from '@/lib/agent/runtime';
import { downloadText } from '@/lib/zip';

/**
 * Autonomous research mode.
 *
 * Retrieval runs server-side (search → fetch → embed → rerank); the synthesis
 * step is handed to the normal chat stream so the answer renders live and lands
 * in session history like any other run.
 *
 * Completion alerts use the Notification API — permission is requested only when
 * the user starts a run, never on page load.
 */
export function Workdrive() {
  const setSuite = useWorkspace((s) => s.setSuite);

  const [runs, setRuns] = useState<ResearchRunRecord[]>([]);
  const [topic, setTopic] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [active, setActive] = useState<ResearchRunRecord | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setRuns(await listResearchRuns(60));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const notify = (title: string, body: string) => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try {
      new Notification(title, { body, tag: 'chomugiri-research' });
    } catch {
      /* some browsers require a service worker; degrade silently */
    }
  };

  const startRun = async () => {
    const query = topic.trim();
    if (!query) return;

    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission();
    }

    setBusy(true);

    const record: ResearchRunRecord = {
      id: uid('res'),
      sessionId: useWorkspace.getState().sessionId ?? 'unbound',
      topic: query,
      status: 'running',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      dueAt: dueAt ? new Date(dueAt).getTime() : undefined,
      milestones: [],
      sources: [],
    };

    await saveResearchRun(record);
    setActive(record);
    await refresh();

    try {
      // No timeout at all meant a stalled retrieval left the run stuck at
      // "running" in IndexedDB forever, with no error and no way out. 310s
      // gives the route's own 300s cap room to answer first.
      const res = await fetch('/api/research', withKeys({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, maxSources: 7, maxChunks: 16 }),
        signal: AbortSignal.timeout(310_000),
      }));

      const data = (await res.json()) as {
        context?: string;
        sources?: Array<{ n: number; url: string; title: string; score: number; excerpt: string }>;
        notes?: string[];
        error?: string;
        stats?: { pagesFetched: number; passages: number; selected: number };
      };

      if (!res.ok || !data.context) {
        const failed: ResearchRunRecord = { ...record, status: 'failed', error: data.error ?? 'Retrieval failed.', updatedAt: Date.now() };
        await saveResearchRun(failed);
        setActive(failed);
        await refresh();
        notify('Research failed', failed.error ?? '');
        return;
      }

      const completed: ResearchRunRecord = {
        ...record,
        status: 'completed',
        updatedAt: Date.now(),
        sources: (data.sources ?? []).map((s) => ({ url: s.url, title: s.title, score: s.score, excerpt: s.excerpt })),
        document: data.context,
        notified: 1,
      };

      await saveResearchRun(completed);
      setActive(completed);
      await refresh();
      notify('Research complete', `${completed.sources.length} sources on "${query}"`);

      // Hand the grounded context to the chat stream for synthesis.
      setSuite('workdrive');
      await send({
        input: `Synthesise a research briefing on: ${query}

Use ONLY the retrieved context below. Cite with [n] matching the source list. Separate what the sources establish from what you are inferring, and say so where they conflict.

## Sources
${(data.sources ?? []).map((s) => `[${s.n}] ${s.title} — ${s.url}`).join('\n')}

## Retrieved context
${data.context.slice(0, 90_000)}

${data.notes?.length ? `## Retrieval notes\n${data.notes.join('\n')}` : ''}`,
        suite: 'workdrive',
        forceLane: 'A',
      });
    } catch (err) {
      const failed: ResearchRunRecord = { ...record, status: 'failed', error: (err as Error).message, updatedAt: Date.now() };
      await saveResearchRun(failed);
      setActive(failed);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const addMilestone = async (run: ResearchRunRecord, title: string) => {
    const updated: ResearchRunRecord = {
      ...run,
      milestones: [...run.milestones, { id: uid('ms'), title, done: 0 }],
      updatedAt: Date.now(),
    };
    await saveResearchRun(updated);
    setActive(updated);
    await refresh();
  };

  const toggleMilestone = async (run: ResearchRunRecord, id: string) => {
    const updated: ResearchRunRecord = {
      ...run,
      milestones: run.milestones.map((m) => (m.id === id ? { ...m, done: m.done ? 0 : 1 } : m)),
      updatedAt: Date.now(),
    };
    await saveResearchRun(updated);
    setActive(updated);
    await refresh();
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-72 shrink-0 flex-col border-r" style={{ borderColor: 'var(--line)' }}>
        <div className="space-y-2 border-b p-3" style={{ borderColor: 'var(--line)' }}>
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={2}
            placeholder="What should I research?"
            className="w-full resize-y rounded-lg border bg-transparent px-2.5 py-2 text-[12px] outline-none placeholder:opacity-45"
            style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
          />
          <label className="block">
            <span className="mono block text-[9px] uppercase tracking-[0.1em]" style={{ color: 'var(--ink-faint)' }}>
              deadline (optional)
            </span>
            <input
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className="mono mt-0.5 w-full rounded border bg-transparent px-2 py-1.5 text-[10.5px] outline-none"
              style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
            />
          </label>
          <button
            type="button"
            onClick={() => void startRun()}
            disabled={busy || !topic.trim()}
            className="mono w-full rounded-lg px-3 py-2 text-[11px] font-medium disabled:opacity-35"
            style={{ background: 'var(--accent)', color: '#04150e' }}
          >
            {busy ? 'retrieving…' : 'start research run'}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {runs.length === 0 ? (
            <p className="mono px-2 py-3 text-center text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>
              no runs yet
            </p>
          ) : (
            runs.map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => void getResearchRun(run.id).then((r) => setActive(r ?? null))}
                className="mb-1 w-full rounded-lg border px-2.5 py-2 text-left"
                style={{
                  borderColor: active?.id === run.id ? 'color-mix(in oklab, var(--accent) 40%, var(--line))' : 'var(--line)',
                  background: active?.id === run.id ? 'color-mix(in oklab, var(--accent) 7%, transparent)' : undefined,
                }}
              >
                <p className="truncate text-[11.5px]" style={{ color: 'var(--ink)' }}>{run.topic}</p>
                <p className="mono mt-0.5 text-[9.5px]" style={{ color: run.status === 'failed' ? 'var(--color-rose)' : run.status === 'completed' ? 'var(--accent)' : 'var(--color-amber)' }}>
                  {run.status} · {run.sources.length} sources
                  {run.dueAt && ` · due ${new Date(run.dueAt).toLocaleDateString()}`}
                </p>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {!active ? (
          <div className="flex h-full items-center justify-center">
            <p className="mono max-w-sm text-center text-[11px] leading-[1.6]" style={{ color: 'var(--ink-faint)' }}>
              Autonomous research: search → fetch → chunk → embed → rerank → synthesise with citations.
              <br />
              <br />
              With NVIDIA_NIM_API_KEY set, ranking uses NV-EmbedQA + NV-RerankQA. Without it, retrieval falls back to
              lexical scoring — cruder, but still grounded.
            </p>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl space-y-4">
            <header>
              <h2 className="text-[16px] font-semibold tracking-tight">{active.topic}</h2>
              <p className="mono mt-1 text-[10px]" style={{ color: 'var(--ink-faint)' }}>
                {new Date(active.createdAt).toLocaleString()} · {active.status}
                {active.dueAt && ` · deadline ${new Date(active.dueAt).toLocaleString()}`}
              </p>
            </header>

            {active.error && (
              <p className="mono rounded-lg border px-2.5 py-2 text-[11px]" style={{ borderColor: 'color-mix(in oklab, var(--color-rose) 40%, var(--line))', color: 'var(--color-rose)' }}>
                {active.error}
              </p>
            )}

            {active.sources.length > 0 && (
              <section className="rounded-xl border p-3" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
                <h3 className="mono mb-2 text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
                  sources · {active.sources.length}
                </h3>
                <ol className="space-y-2">
                  {active.sources.map((source, i) => (
                    <li key={source.url}>
                      <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-[12px] leading-[1.4]" style={{ color: 'var(--accent)' }}>
                        [{i + 1}] {source.title}
                      </a>
                      <p className="mono truncate text-[9.5px]" style={{ color: 'var(--ink-faint)' }}>{source.url}</p>
                      {source.excerpt && (
                        <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-[1.45]" style={{ color: 'var(--ink-dim)' }}>
                          {source.excerpt}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <section className="rounded-xl border p-3" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
              <div className="mb-2 flex items-center">
                <h3 className="mono text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
                  milestones
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    const title = window.prompt('Milestone');
                    if (title?.trim()) void addMilestone(active, title.trim());
                  }}
                  className="mono ml-auto text-[10px]"
                  style={{ color: 'var(--accent)' }}
                >
                  + add
                </button>
              </div>

              {active.milestones.length === 0 ? (
                <p className="mono text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>none</p>
              ) : (
                <ul className="space-y-1">
                  {active.milestones.map((milestone) => (
                    <li key={milestone.id}>
                      <button
                        type="button"
                        onClick={() => void toggleMilestone(active, milestone.id)}
                        className="flex w-full items-center gap-2 text-left text-[11.5px]"
                        style={{ color: milestone.done ? 'var(--ink-faint)' : 'var(--ink)' }}
                      >
                        <span className="mono" style={{ color: milestone.done ? 'var(--accent)' : 'var(--ink-faint)' }}>
                          {milestone.done ? '●' : '○'}
                        </span>
                        <span style={{ textDecoration: milestone.done ? 'line-through' : undefined }}>{milestone.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {active.document && (
              <button
                type="button"
                onClick={() => downloadText(active.document ?? '', `research-${active.topic.slice(0, 40).replace(/\W+/g, '-')}.md`, 'text/markdown')}
                className="mono w-full rounded-lg border px-3 py-2 text-[11px]"
                style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
              >
                ↓ export retrieved context
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
