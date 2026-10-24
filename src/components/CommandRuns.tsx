'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { describeCommand } from '@/lib/agent/narrate';
import { db, isBrowser, type RunRecord } from '@/lib/db/schema';
import { matchRuns, type CommandBlock } from '@/lib/text/command-blocks';
import { useWorkspace } from '@/lib/store';
import { copyText } from './codeActions';

/**
 * What ran for a reply, without a code box per command.
 *
 * In the chat it is one quiet line, "Ran 3 commands ›". Tapping it opens a sheet with one row per command, and a row opens
 * the whole record: what it was for, the command itself and what it printed, each with its own copy button. Nothing here
 * moves while a command runs — a word changes, that is all — so a long build costs the phone nothing extra.
 */

type Status = 'done' | 'failed' | 'running' | 'waiting';

interface Item {
  command: CommandBlock;
  run?: RunRecord;
  status: Status;
  what: string;
}

const clean = (phrase: string) => phrase.replace(/…$/, '');

function Icon({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}
const TERMINAL = 'M4 6l5 5-5 5M12 17h8';
const CHEVRON = 'M9 6l6 6-6 6';
const BACK = 'M15 6l-6 6 6 6';
const CLOSE = 'M6 6l12 12M18 6L6 18';
const COPY = 'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM5 15V5a1 1 0 0 1 1-1h10';
const CHECK = 'M5 12.5l4.5 4.5L19 7.5';

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        void copyText(text).then((ok) => {
          if (!ok) return;
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
      className="press -m-1 shrink-0 p-1"
      style={{ color: done ? 'var(--accent)' : 'var(--ink-dim)' }}
    >
      <Icon d={done ? CHECK : COPY} size={19} />
    </button>
  );
}

function Section({ title, copy, copyLabel, children }: { title: string; copy?: string; copyLabel?: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <div className="mb-1.5 flex items-center justify-between px-1">
        <h4 className="text-[13px] font-medium" style={{ color: 'var(--ink-dim)' }}>{title}</h4>
        {copy ? <CopyButton text={copy} label={copyLabel ?? `Copy ${title.toLowerCase()}`} /> : null}
      </div>
      <div className="rounded-xl px-3.5 py-3" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
        {children}
      </div>
    </section>
  );
}

const STATUS_TEXT: Record<Status, string> = { done: 'Completed', failed: 'Failed', running: 'Running', waiting: 'Waiting' };

function statusOf(run: RunRecord | undefined, command: CommandBlock, runningCommand: string | null): Status {
  if (run) return run.exitCode === 0 ? 'done' : 'failed';
  if (runningCommand && runningCommand.trim() === command.command.trim()) return 'running';
  return 'waiting';
}

function Detail({ item }: { item: Item }) {
  const { run, command } = item;
  const out = run ? [run.stdout, run.stderr].filter((t) => t.trim()).join(run.stdout.trim() && run.stderr.trim() ? '\n' : '') : '';
  const meta = run
    ? `${run.exitCode === 0 ? 'exit 0' : `exit ${run.exitCode ?? 'none'}`}${run.durationMs != null ? ` · ${(run.durationMs / 1000).toFixed(1)}s` : ''}`
    : '';
  return (
    <div className="px-4 pb-8">
      <Section title="Description">
        <p className="text-[14px] leading-[1.55]">{item.what}</p>
        {command.cwd ? <p className="mono mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>in {command.cwd}</p> : null}
      </Section>
      <Section title="Command" copy={command.command} copyLabel="Copy command">
        <pre className="mono max-h-52 overflow-auto whitespace-pre-wrap break-all text-[12.5px] leading-[1.55]">{command.command}</pre>
      </Section>
      <Section title="Output" copy={out || undefined} copyLabel="Copy output">
        {run ? (
          out ? (
            <pre className="mono max-h-[40vh] overflow-auto whitespace-pre-wrap break-all text-[12px] leading-[1.55]">{out}</pre>
          ) : (
            <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>No output.</p>
          )
        ) : (
          <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
            {item.status === 'running' ? 'Running now — the output appears here when it finishes.' : 'Has not run yet.'}
          </p>
        )}
        {meta ? <p className="mono mt-2 text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>{meta}</p> : null}
      </Section>
    </div>
  );
}

function Sheet({ items, onClose }: { items: Item[]; onClose: () => void }) {
  const [open, setOpen] = useState<number | null>(items.length === 1 ? 0 : null);
  const item = open != null ? items[open] : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (open != null && items.length > 1) setOpen(null);
      else onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, items.length, onClose]);

  const title = item ? 'Terminal' : `Ran ${items.length} command${items.length === 1 ? '' : 's'}`;

  return createPortal(
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal aria-label={title} data-testid="command-sheet">
      <button type="button" aria-label="Close" className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose} />
      <div
        className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[88vh] w-full max-w-2xl flex-col rounded-t-[22px]"
        style={{ background: 'var(--bg)', border: '1px solid var(--line)', borderBottom: 0, color: 'var(--ink)' }}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full" style={{ background: 'var(--line)' }} aria-hidden />
        <header className="flex items-center gap-3 px-4 pb-2 pt-3">
          <button
            type="button"
            aria-label={item && items.length > 1 ? 'Back' : 'Close'}
            className="press -m-1 p-1"
            onClick={() => (item && items.length > 1 ? setOpen(null) : onClose())}
          >
            <Icon d={item && items.length > 1 ? BACK : CLOSE} size={22} />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <h3 className="text-[16px] font-semibold">{title}</h3>
            {item ? <p className="text-[12.5px]" style={{ color: item.status === 'failed' ? 'var(--color-rose)' : 'var(--ink-faint)' }}>{STATUS_TEXT[item.status]}</p> : null}
          </div>
          <span className="w-[22px]" aria-hidden />
        </header>
        <div className="overflow-y-auto">
          {item ? (
            <Detail item={item} />
          ) : (
            <ul className="px-2 pb-8 pt-1">
              {items.map((it, i) => (
                <li key={i}>
                  <button type="button" onClick={() => setOpen(i)} className="press flex w-full items-center gap-3 rounded-xl px-2.5 py-3 text-left">
                    <span className="shrink-0" style={{ color: 'var(--ink-faint)' }}><Icon d={TERMINAL} size={18} /></span>
                    <span className="shrink-0 text-[14.5px] font-medium">{it.status === 'failed' ? 'Failed' : it.status === 'done' ? 'Ran' : it.status === 'running' ? 'Running' : 'Waiting'}</span>
                    <span className="min-w-0 flex-1 truncate text-[14px]" style={{ color: 'var(--ink-dim)' }}>{it.what}</span>
                    <span className="shrink-0" style={{ color: 'var(--ink-faint)' }}><Icon d={CHEVRON} size={16} /></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The "Ran N commands ›" line for one group of commands in a reply. */
export function CommandRuns({ commands, sessionId, since }: { commands: CommandBlock[]; sessionId: string | null; since: number }) {
  const runningCommand = useWorkspace((s) => s.runningCommand);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [open, setOpen] = useState(false);

  // Runs come from the saved history, so they are still here after a reload. Re-read when a command starts or ends.
  useEffect(() => {
    if (!sessionId || !isBrowser()) return;
    let alive = true;
    void db().runs.where('sessionId').equals(sessionId).toArray().then((rows) => alive && setRuns(rows)).catch(() => undefined);
    return () => { alive = false; };
  }, [sessionId, runningCommand, commands.length]);

  const items = useMemo<Item[]>(() => {
    const matched = matchRuns(commands, runs, since);
    return commands.map((command, i) => ({
      command,
      run: matched[i],
      status: statusOf(matched[i], command, runningCommand),
      what: command.description?.trim() || clean(describeCommand(command.command || 'a command')),
    }));
  }, [commands, runs, since, runningCommand]);

  const running = items.some((i) => i.status === 'running') || commands.some((c) => !c.complete);
  const failed = items.filter((i) => i.status === 'failed').length;
  const waiting = items.filter((i) => i.status === 'waiting').length;
  const n = items.length;
  const label = running
    ? `Running ${n} command${n === 1 ? '' : 's'}`
    : waiting === n
      ? `${n} command${n === 1 ? '' : 's'} waiting`
      : `Ran ${n - waiting} command${n - waiting === 1 ? '' : 's'}${failed ? ` · ${failed} failed` : ''}`;

  return (
    <>
      <button
        type="button"
        data-testid="ran-commands"
        onClick={() => setOpen(true)}
        className="press my-1.5 flex items-center gap-1.5 py-1 text-left text-[14px]"
        style={{ color: failed ? 'var(--color-rose)' : 'var(--ink-dim)' }}
        aria-haspopup="dialog"
      >
        <span style={{ color: 'var(--ink-faint)' }}><Icon d={TERMINAL} size={16} /></span>
        <span>{label}</span>
        <Icon d={CHEVRON} size={15} />
      </button>
      {open ? <Sheet items={items} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
