'use client';

import { useWorkspace } from '@/lib/store';
import { dataUrlToBytes, downloadBlob, downloadZip } from '@/lib/zip';
import { buildPackExport, detectPacks } from '@/lib/suites/minecraft/pack';
import { buildGodotExport } from '@/lib/suites/godot/export';
import { useMemo, useState } from 'react';
import { renderMarkdown } from './markdown';
import type { ChatMessageView } from '@/lib/store';

function Avatar({ role, lane }: { role: string; lane?: 'A' | 'B' }) {
  const isUser = role === 'user';
  return (
    <div
      className="mono flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold"
      style={{
        background: isUser ? 'var(--surface)' : 'color-mix(in oklab, var(--accent) 14%, var(--surface))',
        border: `1px solid ${isUser ? 'var(--line)' : 'color-mix(in oklab, var(--accent) 30%, var(--line))'}`,
        color: isUser ? 'var(--ink-dim)' : 'var(--accent)',
      }}
      title={isUser ? 'You' : `Chomugiri · Lane ${lane ?? 'A'}`}
    >
      {isUser ? 'YOU' : 'CHO'}
    </div>
  );
}

/** Collapsible chain-of-thought drawer for reasoning models. */
function ReasoningDrawer({ reasoning, streaming }: { reasoning: string; streaming?: boolean }) {
  const [open, setOpen] = useState(false);
  const lines = reasoning.split('\n').filter(Boolean).length;

  return (
    <div
      className="mb-2.5 overflow-hidden rounded-xl border"
      style={{
        borderColor: streaming ? 'color-mix(in oklab, var(--accent-alt) 34%, var(--line))' : 'var(--line)',
        background: 'var(--surface)',
        transition: 'border-color var(--dur-base) var(--ease-out)',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="press flex w-full items-center gap-2 px-3 py-2 text-left"
        style={{ color: 'var(--ink-dim)' }}
        aria-expanded={open}
      >
        <span
          className="mono text-[10px] transition-transform duration-200"
          style={{ transform: open ? 'rotate(90deg)' : 'none', color: 'var(--accent-alt)' }}
          aria-hidden
        >
          ▶
        </span>
        <span
          className={`mono text-[10.5px] uppercase tracking-[0.12em] ${streaming ? 'thinking-phrase' : ''}`}
        >
          Reasoning
        </span>
        <span className="mono text-[10px]" style={{ color: 'var(--ink-faint)' }}>
          {streaming ? 'streaming…' : `${lines} line${lines === 1 ? '' : 's'}`}
        </span>
        {streaming && (
          <span className="ml-auto flex gap-1" aria-hidden>
            <span className="thinking-dot" style={{ animationDelay: '0ms' }} />
            <span className="thinking-dot" style={{ animationDelay: '160ms' }} />
            <span className="thinking-dot" style={{ animationDelay: '320ms' }} />
          </span>
        )}
      </button>

      {open && (
        <div
          className="enter-fade mono max-h-72 overflow-y-auto whitespace-pre-wrap border-t px-3 py-2.5 text-[11.5px] leading-[1.62]"
          style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
        >
          {reasoning}
        </div>
      )}
    </div>
  );
}

function AttachmentChips({ attachments }: { attachments: NonNullable<ChatMessageView['attachments']> }) {
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {attachments.map((a) => (
        <span
          key={a.id}
          className="press mono flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10.5px]"
          style={{ borderColor: 'var(--line)', background: 'var(--surface)', color: 'var(--ink-dim)' }}
          title={`${a.kind} · ${a.bytes} bytes`}
        >
          {a.dataUrl && a.kind.startsWith('image/') ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.dataUrl} alt="" className="h-4 w-4 rounded-sm object-cover" />
          ) : (
            <span style={{ color: 'var(--accent)' }}>◆</span>
          )}
          {a.name}
        </span>
      ))}
    </div>
  );
}

export function Message({ message }: { message: ChatMessageView }) {
  const html = useMemo(
    () => (message.role === 'user' ? null : renderMarkdown(message.content)),
    [message.content, message.role],
  );

  const isUser = message.role === 'user';

  return (
    <article className="enter-rise flex gap-3 px-4 py-3.5">
      <Avatar role={message.role} lane={message.lane} />

      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-semibold">{isUser ? 'You' : 'Chomugiri'}</span>

          {!isUser && message.lane && (
            <span
              className="mono rounded px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wider"
              style={{
                background:
                  message.lane === 'B'
                    ? 'color-mix(in oklab, var(--accent) 16%, transparent)'
                    : 'color-mix(in oklab, var(--color-indigo) 16%, transparent)',
                color: message.lane === 'B' ? 'var(--accent)' : 'var(--color-indigo)',
              }}
              title={message.lane === 'B' ? 'Autonomous execution' : 'Technical discourse'}
            >
              Lane {message.lane}
            </span>
          )}

          {!isUser && message.model && (
            <span className="mono text-[10px]" style={{ color: 'var(--ink-faint)' }}>
              {message.model.split('/').pop()}
            </span>
          )}

          {message.durationMs != null && message.durationMs > 0 && !message.streaming && (
            <span className="mono text-[10px]" style={{ color: 'var(--ink-faint)' }}>
              {(message.durationMs / 1000).toFixed(1)}s
            </span>
          )}

          {message.usage?.totalTokens != null && (
            <span className="mono text-[10px]" style={{ color: 'var(--ink-faint)' }}>
              {message.usage.totalTokens.toLocaleString()} tok
            </span>
          )}
        </div>

        {message.attachments?.length ? <AttachmentChips attachments={message.attachments} /> : null}

        {message.reasoning ? (
          <ReasoningDrawer reasoning={message.reasoning} streaming={message.streaming} />
        ) : null}

        {isUser ? (
          <p className="whitespace-pre-wrap text-[14px] leading-[1.6]" style={{ color: 'var(--ink)' }}>
            {message.content}
          </p>
        ) : (
          <div
            className={`prose-chomu ${message.streaming && !message.content ? '' : message.streaming ? 'stream-caret' : ''}`}
            dangerouslySetInnerHTML={{ __html: html ?? '' }}
          />
        )}

        {message.streaming && !message.content && !message.reasoning && (
          <div className="flex flex-col gap-2 py-1" aria-hidden>
            <span className="skeleton h-3 w-[72%]" />
            <span className="skeleton h-3 w-[54%]" style={{ animationDelay: '140ms' }} />
          </div>
        )}

        {message.offer ? <OfferDownload offer={message.offer} /> : null}

        {message.error && (
          <div
            className="enter-pop mt-2 rounded-xl border px-3 py-2 text-[12px] leading-5"
            style={{
              borderColor: 'color-mix(in oklab, var(--color-rose) 40%, var(--line))',
              background: 'color-mix(in oklab, var(--color-rose) 8%, transparent)',
              color: 'var(--color-rose)',
            }}
            role="alert"
          >
            <span className="mono mr-1.5 text-[10px] uppercase tracking-wider">error</span>
            {message.error}
          </div>
        )}
      </div>
    </article>
  );
}

/**
 * A file the run produced, handed over as a real download.
 *
 * The archive is built at the moment it is clicked, from the workspace's
 * current files, rather than being stored in the message — otherwise every
 * saved conversation would carry a second copy of every artifact, and a later
 * edit to a file would leave the download stale.
 */
function OfferDownload({ offer }: { offer: NonNullable<ChatMessageView['offer']> }) {
  const files = useWorkspace((s) => s.files);
  const [error, setError] = useState<string | null>(null);

  const take = () => {
    if (offer.kind === 'apk') {
      // Not rebuildable in the browser: making an APK needs Godot's native
      // exporter on the bridge. The bytes were stored when it was built.
      const stored = offer.source ? files.get(offer.source) : undefined;
      if (!stored?.content?.startsWith('data:')) {
        setError('That APK is no longer in this workspace — re-run the build to compile it again.');
        return;
      }
      setError(null);
      // Copied into a plain ArrayBuffer: a Uint8Array can be backed by a
      // SharedArrayBuffer, which Blob will not take.
      const bytes = dataUrlToBytes(stored.content);
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      downloadBlob(new Blob([buffer], { type: 'application/vnd.android.package-archive' }), offer.filename);
      return;
    }

    if (offer.kind === 'godot-project') {
      // Rebuilt from the workspace at click time, like the pack below, so an
      // edit made after the build is in the archive rather than being lost.
      const built = buildGodotExport([...files.values()], null, offer.filename.replace(/\.zip$/i, ''));
      if (!built) {
        setError('That project is no longer open — re-run the build to get the game again.');
        return;
      }
      setError(null);
      downloadZip(built.entries, built.filename, 'application/zip');
      return;
    }

    const packs = detectPacks([...files.values()]);
    const built = buildPackExport(packs, offer.filename.replace(/\.(mcpack|mcaddon)$/i, ''));
    if (!built) {
      // The files that produced this offer are no longer in the workspace.
      setError('Those pack files are no longer open — re-run the build to get the add-on again.');
      return;
    }
    setError(null);
    downloadZip(built.entries, built.filename, 'application/octet-stream');
  };

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={take}
        className="press mono inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[11.5px] font-semibold"
        style={{
          borderColor: 'color-mix(in oklab, var(--accent) 45%, var(--line))',
          background: 'color-mix(in oklab, var(--accent) 10%, transparent)',
          color: 'var(--accent)',
        }}
      >
        ↓ {offer.filename}
      </button>
      <p className="mono mt-1 text-[10px]" style={{ color: 'var(--ink-faint)' }}>
        {offer.label}
      </p>
      {error && (
        <p className="mt-1 text-[10.5px]" style={{ color: 'var(--color-danger)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
