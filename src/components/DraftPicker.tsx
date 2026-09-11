'use client';

import { useMemo, useState } from 'react';
import { useWorkspace } from '@/lib/store';
import { renderMarkdown } from './markdown';
import { appendMessage, uid } from '@/lib/db/history';
import { extractArtifacts, filesOf } from '@/lib/agent/artifacts';

/**
 * Two alternatives, side by side, pick one.
 *
 * The discarded draft is dropped rather than kept around: leaving both in the
 * transcript would poison the next turn's context with an answer the user
 * explicitly rejected.
 */
export function DraftPicker() {
  const drafts = useWorkspace((s) => s.drafts);
  const setDrafts = useWorkspace((s) => s.setDrafts);
  const pushMessage = useWorkspace((s) => s.pushMessage);
  const upsertFile = useWorkspace((s) => s.upsertFile);
  const setRightPaneTab = useWorkspace((s) => s.setRightPaneTab);
  const sessionId = useWorkspace((s) => s.sessionId);
  const activeSuite = useWorkspace((s) => s.activeSuite);
  const selection = useWorkspace((s) => s.selection);

  const [expanded, setExpanded] = useState<string | null>(null);

  const anyStreaming = useMemo(() => drafts?.some((d) => d.streaming) ?? false, [drafts]);

  if (!drafts?.length) return null;

  const choose = (id: string) => {
    const draft = drafts.find((d) => d.id === id);
    if (!draft || !draft.content) return;

    const messageId = uid('msg');
    pushMessage({
      id: messageId,
      role: 'assistant',
      content: draft.content,
      reasoning: draft.reasoning || undefined,
      model: draft.model,
      provider: selection.provider,
      createdAt: Date.now(),
    });

    void appendMessage({
      id: messageId,
      sessionId: sessionId ?? 'unbound',
      suite: activeSuite,
      role: 'assistant',
      content: draft.content,
      reasoning: draft.reasoning || undefined,
      createdAt: Date.now(),
      model: draft.model,
    });

    // Only the chosen draft's files enter the workspace.
    const files = filesOf(extractArtifacts(draft.content));
    for (const file of files) upsertFile(file);
    if (files.length) setRightPaneTab('files');

    setDrafts(null);
  };

  return (
    <div className="enter-rise px-4 pb-3 pl-[52px]">
      <div className="mb-2 flex items-center gap-2">
        <span className="mono text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--ink-faint)' }}>
          {anyStreaming ? 'drafting two approaches' : 'pick a draft'}
        </span>
        {anyStreaming && drafts.some((d) => !d.streaming) && (
          <span className="mono text-[9.5px]" style={{ color: 'var(--ink-faint)' }}>
            · one at a time on NIM
          </span>
        )}
        {!anyStreaming && (
          <button
            type="button"
            onClick={() => setDrafts(null)}
            className="mono ml-auto text-[10px]"
            style={{ color: 'var(--ink-faint)' }}
          >
            discard both
          </button>
        )}
      </div>

      <div className="grid gap-2.5 md:grid-cols-2">
        {drafts.map((draft, i) => {
          const isOpen = expanded === draft.id;
          const html = draft.content ? renderMarkdown(draft.content) : '';

          return (
            <article
              key={draft.id}
              className="enter-pop flex flex-col overflow-hidden rounded-xl border"
              style={{
                animationDelay: `${i * 70}ms`,
                borderColor: draft.error
                  ? 'color-mix(in oklab, var(--color-rose) 40%, var(--line))'
                  : 'var(--line)',
                background: 'var(--panel)',
              }}
            >
              <header
                className="flex shrink-0 items-center gap-2 border-b px-3 py-2"
                style={{ borderColor: 'var(--line)' }}
              >
                <span
                  className="mono rounded px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider"
                  style={{
                    background: i === 0
                      ? 'color-mix(in oklab, var(--accent) 16%, transparent)'
                      : 'color-mix(in oklab, var(--accent-alt) 16%, transparent)',
                    color: i === 0 ? 'var(--accent)' : 'var(--accent-alt)',
                  }}
                >
                  {draft.label}
                </span>
                <span className="mono truncate text-[10px]" style={{ color: 'var(--ink-faint)' }}>
                  {draft.angle}
                </span>
                {draft.streaming && <span className="thinking-dot ml-auto shrink-0" aria-hidden />}
              </header>

              <div
                className="min-h-[120px] overflow-y-auto px-3 py-2.5"
                style={{ maxHeight: isOpen ? '60vh' : '210px' }}
              >
                {draft.error ? (
                  <p className="text-[11.5px] leading-5" style={{ color: 'var(--color-rose)' }}>
                    {draft.error}
                  </p>
                ) : draft.content ? (
                  <div className="prose-chomu text-[12.5px]" dangerouslySetInnerHTML={{ __html: html }} />
                ) : (
                  <div className="flex flex-col gap-2" aria-hidden>
                    <span className="skeleton h-3 w-[80%]" />
                    <span className="skeleton h-3 w-[62%]" style={{ animationDelay: '120ms' }} />
                    <span className="skeleton h-3 w-[71%]" style={{ animationDelay: '240ms' }} />
                  </div>
                )}
              </div>

              <footer className="flex shrink-0 gap-1.5 border-t px-3 py-2" style={{ borderColor: 'var(--line)' }}>
                <button
                  type="button"
                  onClick={() => choose(draft.id)}
                  disabled={draft.streaming || !draft.content}
                  className="press mono flex-1 rounded-lg px-3 py-1.5 text-[11px] font-semibold disabled:opacity-30"
                  style={{
                    background: i === 0
                      ? 'linear-gradient(135deg, var(--accent), color-mix(in oklab, var(--accent) 60%, var(--accent-alt)))'
                      : 'linear-gradient(135deg, var(--accent-alt), color-mix(in oklab, var(--accent-alt) 60%, var(--accent)))',
                    color: i === 0 ? '#04150e' : '#0a0a1f',
                  }}
                >
                  use this
                </button>
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : draft.id)}
                  disabled={!draft.content}
                  className="press mono rounded-lg border px-2.5 py-1.5 text-[10.5px] disabled:opacity-30"
                  style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
                >
                  {isOpen ? 'less' : 'more'}
                </button>
              </footer>
            </article>
          );
        })}
      </div>
    </div>
  );
}
