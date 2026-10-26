'use client';

import { useWorkspace, visibleFiles } from '@/lib/store';
import { dataUrlToBytes, downloadBlob, zipBlob } from '@/lib/zip';
import { canShareFiles, downloadSource, shareBlob, shareSource } from '@/lib/save-file';
import { buildPackExport, detectPacks } from '@/lib/suites/minecraft/pack';
import { buildGodotExport } from '@/lib/suites/godot/export';
import { useEffect, useMemo, useState } from 'react';
import { markLive, renderMarkdown } from './markdown';
import { TextWithSites } from './SiteChip';
import './codeActions';
import type { ChatMessageView } from '@/lib/store';
import { GamePlayer } from '@/components/GamePlayer';
import { CommandRuns } from '@/components/CommandRuns';
import { commandCount, splitCommandBlocks } from '@/lib/text/command-blocks';
import { isImageMime, stripSendBlocks } from '@/lib/text/send-blocks';

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

/** The reply as words: a ```send block names a file to attach, it is not text to read. */
function shown(content: string): string {
  return /(^|\n)[ \t]*(`{3,}|~{3,})[ \t]*send\b|path=@send/.test(content) ? stripSendBlocks(content) : content;
}

const fmtBytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : n ? `${n} B` : '');

/** Pictures the assistant sent show in the chat; every file can be saved. */
function SentFiles({ files }: { files: NonNullable<ChatMessageView['attachments']> }) {
  const [note, setNote] = useState<Record<string, string>>({});
  const [share, setShare] = useState(false);
  useEffect(() => setShare(canShareFiles()), []);
  const say = (id: string, text: string) => setNote((n) => ({ ...n, [id]: text }));
  return (
    <div className="mt-2 space-y-2" data-testid="sent-files">
      {files.map((a) => {
        const image = isImageMime(a.kind) && a.dataUrl;
        const chipStyle = { borderColor: 'color-mix(in oklab, var(--accent) 40%, var(--line))', color: 'var(--accent)' } as const;
        const chip = 'press mono inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[11.5px]';
        return (
          <figure key={a.id} className="max-w-full">
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.dataUrl} alt={a.caption ?? a.name} loading="lazy" className="max-h-[60vh] max-w-full rounded-xl border" style={{ borderColor: 'var(--line)' }} />
            ) : null}
            <figcaption className="mt-1 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={chip}
                style={chipStyle}
                onClick={() => void downloadSource(a).then((ok) => say(a.id, ok ? 'Saving… check your Downloads. If nothing appears, use Share.' : 'This file is no longer available — ask for it again.'))}
              >
                ↓ {a.name}{fmtBytes(a.bytes) ? ` · ${fmtBytes(a.bytes)}` : ''}
              </button>
              {share ? (
                <button
                  type="button"
                  className={chip}
                  style={chipStyle}
                  onClick={() => void shareSource(a).then((r) => { if (r === 'unsupported') say(a.id, 'Sharing is not available here — use the download button.'); else if (r === 'missing') say(a.id, 'This file is no longer available — ask for it again.'); })}
                >
                  Share / save
                </button>
              ) : null}
              {a.caption ? <span className="text-[11.5px]" style={{ color: 'var(--ink-dim)' }}>{a.caption}</span> : null}
            </figcaption>
            {note[a.id] ? <p className="mt-1 text-[10.5px]" style={{ color: 'var(--ink-faint)' }} role="status">{note[a.id]}</p> : null}
          </figure>
        );
      })}
    </div>
  );
}

/** A reply the terminal is still writing: it says so, and it can be stopped. */
function BackgroundStrip({ jobId }: { jobId: string }) {
  const bridge = useWorkspace((s) => s.bridge);
  const [stopped, setStopped] = useState(false);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-[11.5px]" style={{ borderColor: 'color-mix(in oklab, var(--accent) 40%, var(--line))', color: 'var(--ink-dim)' }} role="status" data-testid="background-strip">
      <span aria-hidden>⏳</span>
      <span>{stopped ? 'Stopping…' : 'Working on the terminal — you can close the app. The reply will be here when you come back.'}</span>
      {!stopped && (
        <button type="button" className="press mono rounded-lg border px-2 py-1 text-[10.5px]" style={{ borderColor: 'var(--line)' }} onClick={() => { setStopped(true); void bridge.cancelJob(jobId).catch(() => setStopped(false)); }}>
          stop
        </button>
      )}
    </div>
  );
}

export function Message({ message }: { message: ChatMessageView }) {
  // The reply as prose, with the commands it ran pulled out into one "Ran N commands" line each (CommandRuns).
  const segments = useMemo(
    () => (message.role === 'user' ? [] : splitCommandBlocks(shown(message.content), { shellRuns: message.lane === 'B' })),
    [message.content, message.role, message.lane],
  );
  const hasCommands = commandCount(segments) > 0;
  const sessionId = useWorkspace((s) => s.sessionId);
  // The block still being written lights up in place.
  const parts = useMemo(
    () =>
      segments.map((seg) => {
        if (seg.kind !== 'text') return null;
        const open = message.streaming && (seg.text.match(/^\s*(```|~~~)/gm)?.length ?? 0) % 2 === 1;
        return markLive(renderMarkdown(seg.text), { liveLast: open });
      }),
    [segments, message.streaming],
  );
  const html = useMemo(() => {
    if (message.role === 'user' || hasCommands) return null;
    const open = message.streaming && (message.content.match(/^\s*(```|~~~)/gm)?.length ?? 0) % 2 === 1;
    return markLive(renderMarkdown(shown(message.content)), { liveLast: open });
  }, [message.role, message.content, message.streaming, hasCommands]);

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
              title={message.lane === 'B' ? 'Build mode: planned and ran the work' : 'Answer mode: replied directly'}
            >
              {message.lane === 'B' ? 'build' : 'answer'}
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

        {message.attachments?.length && isUser ? <AttachmentChips attachments={message.attachments} /> : null}

        {message.reasoning ? (
          <ReasoningDrawer reasoning={message.reasoning} streaming={message.streaming} />
        ) : null}

        {isUser ? (
          <p className="whitespace-pre-wrap text-[14px] leading-[1.6]" style={{ color: 'var(--ink)' }}>
            <TextWithSites text={message.content} />
          </p>
        ) : hasCommands ? (
          <div>
            {segments.map((seg, i) =>
              seg.kind === 'commands' ? (
                <CommandRuns key={i} commands={seg.commands} sessionId={sessionId} since={message.createdAt} />
              ) : (
                <div
                  key={i}
                  className={`prose-chomu ${message.streaming && i === segments.length - 1 ? 'stream-caret' : ''}`}
                  dangerouslySetInnerHTML={{ __html: parts[i] ?? '' }}
                />
              ),
            )}
          </div>
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

        {message.background ? <BackgroundStrip jobId={message.background} /> : null}

        {message.attachments?.length && !isUser ? <SentFiles files={message.attachments} /> : null}

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
  const files = useWorkspace(visibleFiles);
  const [error, setError] = useState<string | null>(null);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(canShareFiles()), []);

  // Not a download at all: the game itself, in the message that built it.
  if (offer.kind === 'play') {
    return offer.playId ? <GamePlayer id={offer.playId} label={offer.label} /> : null;
  }

  /** The file as bytes, or null (with the reason shown) when what made it is no longer in the workspace. */
  const make = (): { blob: Blob; name: string } | null => {
    if (offer.kind === 'apk') {
      // Not rebuildable in the browser: making an APK needs Godot's native
      // exporter on the bridge. The bytes were stored when it was built.
      const stored = offer.source ? files.get(offer.source) : undefined;
      if (!stored?.content?.startsWith('data:')) {
        setError('That APK is no longer in this workspace — re-run the build to compile it again.');
        return null;
      }
      setError(null);
      // Copied into a plain ArrayBuffer: a Uint8Array can be backed by a
      // SharedArrayBuffer, which Blob will not take.
      const bytes = dataUrlToBytes(stored.content);
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      return { blob: new Blob([buffer], { type: 'application/vnd.android.package-archive' }), name: offer.filename };
    }

    if (offer.kind === 'files') {
      // The files of one run, taken from the workspace as they are now (so a later fix is in them): one as itself, several zipped.
      const picked = (offer.paths ?? []).map((p) => files.get(p)).filter((f): f is NonNullable<typeof f> => Boolean(f && typeof f.content === 'string'));
      if (!picked.length) {
        setError('Those files are no longer open in this workspace — ask for them again.');
        return null;
      }
      setError(null);
      const asBytes = (c: string) => (c.startsWith('data:') ? dataUrlToBytes(c) : c);
      if (picked.length === 1) {
        const only = picked[0];
        const bytes = asBytes(only.content);
        const buffer = new ArrayBuffer(typeof bytes === 'string' ? new TextEncoder().encode(bytes).length : bytes.byteLength);
        new Uint8Array(buffer).set(typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes);
        return { blob: new Blob([buffer], { type: 'application/octet-stream' }), name: offer.filename };
      }
      return { blob: zipBlob(picked.map((f) => ({ path: f.path, content: asBytes(f.content) })), 'application/zip'), name: offer.filename };
    }

    if (offer.kind === 'godot-project') {
      // Rebuilt from the workspace at click time, like the pack below, so an
      // edit made after the build is in the archive rather than being lost.
      const built = buildGodotExport([...files.values()], null, offer.filename.replace(/\.zip$/i, ''));
      if (!built) {
        setError('That project is no longer open — re-run the build to get the game again.');
        return null;
      }
      setError(null);
      return { blob: zipBlob(built.entries, 'application/zip'), name: built.filename };
    }

    const packs = detectPacks([...files.values()]);
    const built = buildPackExport(packs, offer.filename.replace(/\.(mcpack|mcaddon)$/i, ''));
    if (!built) {
      // The files that produced this offer are no longer in the workspace.
      setError('Those pack files are no longer open — re-run the build to get the add-on again.');
      return null;
    }
    setError(null);
    return { blob: zipBlob(built.entries, 'application/octet-stream'), name: built.filename };
  };

  const take = () => {
    const out = make();
    if (out) downloadBlob(out.blob, out.name);
  };
  const shareIt = () => {
    const out = make();
    if (out) void shareBlob(out.blob, out.name).then((r) => { if (r === 'unsupported') setError('Sharing is not available here — use the download button.'); });
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
      {canShare && (
        <button
          type="button"
          onClick={shareIt}
          className="press mono ml-2 inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[11.5px]"
          style={{ borderColor: 'color-mix(in oklab, var(--accent) 45%, var(--line))', color: 'var(--accent)' }}
        >
          Share / save
        </button>
      )}
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
