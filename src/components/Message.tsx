'use client';

import { useWorkspace, visibleFiles } from '@/lib/store';
import { dataUrlToBytes, downloadBlob, zipBlob } from '@/lib/zip';
import { canShareFiles, downloadSource, shareBlob, shareSource } from '@/lib/save-file';
import { buildPackExport, detectPacks } from '@/lib/suites/minecraft/pack';
import { buildGodotExport } from '@/lib/suites/godot/export';
import { useEffect, useMemo, useState } from 'react';
import { markLive, renderMarkdown } from './markdown';
import { ComputerUseCard } from './ComputerUseCard';
import { LogoMark } from './Logo';
import { useRunner } from '@/lib/handoff/runner';
import { TextWithSites } from './SiteChip';
import './codeActions';
import type { ChatMessageView } from '@/lib/store';
import { GamePlayer } from '@/components/GamePlayer';
import { CommandRuns } from '@/components/CommandRuns';
import { activityCount, diffTotals, splitCommandBlocks, type FileChange } from '@/lib/text/command-blocks';
import { isImageMime, stripSendBlocks } from '@/lib/text/send-blocks';
import { Icon } from '@/components/Icon';

function Avatar({ role, lane }: { role: string; lane?: 'A' | 'B' }) {
  const isUser = role === 'user';
  return (
    <div
      className="msg-avatar mono flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold"
      style={{
        background: isUser ? 'var(--surface)' : 'transparent',
        border: isUser ? '1px solid var(--line)' : 'none',
        color: isUser ? 'var(--ink-dim)' : 'var(--ink)',
      }}
      title={isUser ? 'You' : `Chomugiri · Lane ${lane ?? 'A'}`}
    >
      {isUser ? 'YOU' : <LogoMark size={22} id="msg-avatar" />}
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
          <Icon name="chevronRight" size={12} />
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
  const pics = attachments.filter((a) => a.dataUrl && a.kind.startsWith('image/'));
  const rest = attachments.filter((a) => !(a.dataUrl && a.kind.startsWith('image/')));
  return (
    <div className="mb-2 space-y-1.5">
      {pics.length ? (
        <div className="flex flex-wrap gap-2">
          {pics.map((a) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={a.id} src={a.dataUrl} alt={a.name} title={a.name} className="h-28 w-auto max-w-[70%] rounded-[18px] border object-cover" style={{ borderColor: 'var(--line)' }} />
          ))}
        </div>
      ) : null}
      {rest.length ? (
        <div className="flex flex-wrap gap-1.5">
          {rest.map((a) => (
            <span key={a.id} className="mono flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10.5px]" style={{ borderColor: 'var(--line)', background: 'var(--surface)', color: 'var(--ink-dim)' }} title={`${a.kind} · ${a.bytes} bytes`}>
              <span className="rounded border px-1 text-[9.5px] font-semibold" style={{ borderColor: 'var(--line)' }}>{a.name.includes('.') ? a.name.split('.').pop()!.toUpperCase().slice(0, 5) : 'FILE'}</span>
              {a.name}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The reply as words: a ```send block names a file to attach, it is not text to read. */
function shown(content: string): string {
  return /(^|\n)[ \t]*(`{3,}|~{3,})[ \t]*send\b|path=@send/.test(content) ? stripSendBlocks(content) : content;
}

const fmtBytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : n ? `${n} B` : '');

/** Pictures the assistant sent show in the chat; every file can be saved. */
/** The type word on a file card: APK, ZIP, PDF … */
function kindWord(name: string, kind: string): string {
  const ext = name.includes('.') ? name.split('.').pop()!.toUpperCase() : '';
  if (ext && ext.length <= 5) return ext;
  return (kind.split('/').pop() ?? 'FILE').toUpperCase().slice(0, 5);
}

/** Files the assistant sent: pictures as rounded thumbnails (tap to open big), other files as cards with their type — tap to save. */
function SentFiles({ files }: { files: NonNullable<ChatMessageView['attachments']> }) {
  const [note, setNote] = useState<Record<string, string>>({});
  const [share, setShare] = useState(false);
  const [big, setBig] = useState<string | null>(null);
  useEffect(() => setShare(canShareFiles()), []);
  const say = (id: string, text: string) => setNote((n) => ({ ...n, [id]: text }));
  const save = (a: (typeof files)[number]) => void downloadSource(a).then((ok) => say(a.id, ok ? 'Saving… check your Downloads. If nothing appears, use Share.' : 'This file is no longer available — ask for it again.'));
  const shareIt = (a: (typeof files)[number]) => void shareSource(a).then((r) => { if (r === 'unsupported') say(a.id, 'Sharing is not available here — use the download button.'); else if (r === 'missing') say(a.id, 'This file is no longer available — ask for it again.'); });
  const images = files.filter((a) => isImageMime(a.kind) && a.dataUrl);
  const others = files.filter((a) => !(isImageMime(a.kind) && a.dataUrl));
  return (
    <div className="mt-2.5 space-y-2.5" data-testid="sent-files">
      {images.length ? (
        <div className="flex flex-wrap gap-2.5">
          {images.map((a) => (
            <figure key={a.id} className="max-w-[78%]">
              <button type="button" onClick={() => setBig(a.dataUrl!)} className="press block overflow-hidden rounded-[22px] border" style={{ borderColor: 'var(--line)' }} aria-label={`Open ${a.name}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.dataUrl} alt={a.caption ?? a.name} loading="lazy" className="block max-h-[240px] w-auto max-w-full object-cover" />
              </button>
              {a.caption ? <figcaption className="mt-1 px-1 text-[12px]" style={{ color: 'var(--ink-dim)' }}>{a.caption}</figcaption> : null}
            </figure>
          ))}
        </div>
      ) : null}
      {others.length ? (
        <div className="flex flex-wrap gap-2.5">
          {others.map((a) => (
            <div key={a.id} className="w-[168px]">
              <button
                type="button"
                onClick={() => save(a)}
                className="press flex h-[150px] w-full flex-col justify-between rounded-[22px] border p-3 text-left"
                style={{ borderColor: 'color-mix(in oklab, var(--ink) 22%, var(--line))', background: 'var(--panel)' }}
                aria-label={`Save ${a.name}`}
              >
                <span className="mono self-start rounded-lg border px-2 py-0.5 text-[12px] font-semibold" style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)', background: 'var(--surface)' }}>{kindWord(a.name, a.kind)}</span>
                <span>
                  <span className="line-clamp-2 break-all text-[14px] font-medium leading-snug" style={{ color: 'var(--ink)' }}>{a.name.replace(/\.[a-z0-9]{1,5}$/i, '')}</span>
                  {fmtBytes(a.bytes) ? <span className="mono mt-0.5 block text-[11px]" style={{ color: 'var(--ink-faint)' }}>{fmtBytes(a.bytes)}</span> : null}
                </span>
              </button>
              <div className="mt-1 flex gap-1.5 px-0.5">
                <button type="button" onClick={() => save(a)} className="press mono text-[11px]" style={{ color: 'var(--accent)' }}><span className="inline-flex items-center gap-1"><Icon name="download" size={13} />save</span></button>
                {share ? <button type="button" onClick={() => shareIt(a)} className="press mono text-[11px]" style={{ color: 'var(--ink-dim)' }}>share</button> : null}
              </div>
              {a.caption ? <p className="mt-0.5 px-0.5 text-[11.5px]" style={{ color: 'var(--ink-dim)' }}>{a.caption}</p> : null}
              {note[a.id] ? <p className="mt-1 px-0.5 text-[10.5px]" style={{ color: 'var(--ink-faint)' }} role="status">{note[a.id]}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
      {images.map((a) => (note[a.id] ? <p key={`n${a.id}`} className="text-[10.5px]" style={{ color: 'var(--ink-faint)' }} role="status">{note[a.id]}</p> : null))}
      {big ? (
        <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-3 p-4" style={{ background: 'rgba(0,0,0,0.9)' }} role="dialog" aria-modal aria-label="Picture" onClick={() => setBig(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={big} alt="" className="max-h-[80vh] max-w-full rounded-2xl" />
          <div className="flex gap-3" onClick={(e) => e.stopPropagation()}>
            {images.filter((a) => a.dataUrl === big).map((a) => (
              <span key={a.id} className="flex gap-3">
                <button type="button" onClick={() => save(a)} className="press mono rounded-xl border px-3 py-2 text-[12px]" style={{ borderColor: 'rgba(255,255,255,.3)', color: '#fff' }}><span className="inline-flex items-center gap-1"><Icon name="download" size={13} />save</span></button>
                {share ? <button type="button" onClick={() => shareIt(a)} className="press mono rounded-xl border px-3 py-2 text-[12px]" style={{ borderColor: 'rgba(255,255,255,.3)', color: '#fff' }}>share</button> : null}
              </span>
            ))}
            <button type="button" onClick={() => setBig(null)} className="press mono rounded-xl border px-3 py-2 text-[12px]" style={{ borderColor: 'rgba(255,255,255,.3)', color: '#fff' }}>close</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The end-of-work line under a finished build reply: how long, what changed, what ran. */
function WorkSummary({ segments, durationMs }: { segments: ReturnType<typeof splitCommandBlocks>; durationMs?: number }) {
  const files: FileChange[] = [];
  let commands = 0;
  for (const s of segments) if (s.kind === 'commands') { commands += s.commands.length; files.push(...(s.files ?? [])); }
  const paths = new Set(files.map((f) => f.path));
  const t = diffTotals(files);
  const secs = durationMs ? Math.round(durationMs / 1000) : 0;
  const took = secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : secs ? `${secs}s` : '';
  const bits = [took && `Worked ${took}`, paths.size && `${paths.size} file${paths.size === 1 ? '' : 's'} changed`, commands && `${commands} command${commands === 1 ? '' : 's'}`].filter(Boolean);
  if (!bits.length) return null;
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t pt-2 text-[12px]" style={{ borderColor: 'var(--line)', color: 'var(--ink-faint)' }} data-testid="work-summary">
      <span style={{ color: 'var(--accent)' }}><Icon name="check" size={14} stroke={2.2} /></span>
      <span>{bits.join(' · ')}</span>
      {paths.size ? (
        <span className="mono inline-flex overflow-hidden rounded-md text-[11px] font-semibold leading-none">
          <span className="px-1.5 py-0.5" style={{ background: 'color-mix(in oklab, #22c55e 20%, transparent)', color: '#22c55e' }}>+{t.added}</span>
          <span className="px-1.5 py-0.5" style={{ background: 'color-mix(in oklab, #ef4444 20%, transparent)', color: '#ef4444' }}>−{t.removed}</span>
        </span>
      ) : null}
    </div>
  );
}

/** A reply the terminal is still writing: it says so, and it can be stopped. */
function BackgroundStrip({ jobId }: { jobId: string }) {
  const bridge = useWorkspace((s) => s.bridge);
  const [stopped, setStopped] = useState(false);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-[11.5px]" style={{ borderColor: 'color-mix(in oklab, var(--accent) 40%, var(--line))', color: 'var(--ink-dim)' }} role="status" data-testid="background-strip">
      <span aria-hidden><Icon name="hourglass" size={14} /></span>
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
    () => (message.role === 'user' ? [] : splitCommandBlocks(shown(message.content), { shellRuns: message.lane === 'B', files: true })),
    [message.content, message.role, message.lane],
  );
  const hasCommands = activityCount(segments) > 0;
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
  // While its run is live, a Computer use message is the card; afterwards (or after a reload) it is the saved summary.
  const cuLive = useRunner((st) => (message.computerUse ? Boolean(st.runs[message.computerUse]) : false));

  return (
    <article className="msg enter-rise flex gap-3 px-4 py-3.5" data-role={message.role}>
      <Avatar role={message.role} lane={message.lane} />

      <div className="msg-body min-w-0 flex-1">
        <div className="msg-head mb-1.5 flex flex-wrap items-center gap-2">
          <span className="msg-name text-[12px] font-semibold">{isUser ? 'You' : 'Chomugiri'}</span>

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

        {cuLive && message.computerUse ? (
          <ComputerUseCard runId={message.computerUse} />
        ) : isUser ? (
          <p className="msg-user-text whitespace-pre-wrap text-[14px] leading-[1.6]" style={{ color: 'var(--ink)' }}>
            <TextWithSites text={message.content} />
          </p>
        ) : hasCommands ? (
          <div>
            {segments.map((seg, i) =>
              seg.kind === 'commands' ? (
                <CommandRuns key={i} commands={seg.commands} files={seg.files} sessionId={sessionId} since={message.createdAt} />
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

        {!isUser && !message.streaming && hasCommands ? <WorkSummary segments={segments} durationMs={message.durationMs} /> : null}

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
        <span className="inline-flex items-center gap-1.5"><Icon name="download" size={14} />{offer.filename}</span>
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
