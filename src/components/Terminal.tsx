'use client';

import { useEffect, useRef, useState } from 'react';
import { useWorkspace } from '@/lib/store';
import { executeCommand } from '@/lib/agent/runtime';

const STREAM_COLOR: Record<string, string> = {
  stdout: 'var(--ink)',
  stderr: 'var(--color-rose)',
  command: 'var(--accent)',
  system: 'var(--color-amber)',
};

/**
 * Streaming terminal pane.
 *
 * Autoscroll sticks to the bottom only while the user is already there — a build
 * that yanks the viewport away mid-scroll makes long logs unreadable.
 */
export function Terminal() {
  const lines = useWorkspace((s) => s.terminal);
  const clearTerminal = useWorkspace((s) => s.clearTerminal);
  const heartbeat = useWorkspace((s) => s.heartbeat);
  const runningExecId = useWorkspace((s) => s.runningExecId);
  const bridge = useWorkspace((s) => s.bridge);
  const sessionId = useWorkspace((s) => s.sessionId);
  const activeSuite = useWorkspace((s) => s.activeSuite);

  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [cwd, setCwd] = useState('.');

  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const online = heartbeat.status === 'online' || heartbeat.status === 'degraded';

  const submit = async () => {
    const command = input.trim();
    if (!command || runningExecId) return;

    setHistory((h) => [command, ...h.filter((c) => c !== command)].slice(0, 100));
    setHistoryIndex(-1);
    setInput('');

    // `cd` is a shell builtin; each exec gets a fresh shell, so track it here.
    const cd = /^cd\s+(.+)$/.exec(command);
    if (cd) {
      const target = cd[1].trim();
      const next = target.startsWith('/') ? target.replace(/^\/+/, '') : target === '..' ? cwd.split('/').slice(0, -1).join('/') || '.' : cwd === '.' ? target : `${cwd}/${target}`;
      setCwd(next);
      useWorkspace.getState().appendTerminal({ stream: 'system', text: `cwd → ${next}` });
      return;
    }

    await executeCommand(command, { cwd, sessionId: sessionId ?? undefined, suite: activeSuite });
  };

  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--void, var(--bg))' }}>
      <header
        className="flex shrink-0 items-center gap-2 border-b px-3 py-2"
        style={{ borderColor: 'var(--line)' }}
      >
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{
            background:
              heartbeat.status === 'online' ? 'var(--accent)'
                : heartbeat.status === 'degraded' ? 'var(--color-amber)'
                  : 'var(--color-rose)',
            boxShadow: heartbeat.status === 'online' ? '0 0 8px var(--accent)' : undefined,
          }}
          aria-hidden
        />
        <span className="mono text-[10.5px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-dim)' }}>
          {heartbeat.health?.workspace ? heartbeat.health.workspace.split('/').slice(-2).join('/') : 'terminal'}
        </span>

        {heartbeat.latencyMs != null && (
          <span className="mono text-[10px]" style={{ color: 'var(--ink-faint)' }}>
            {heartbeat.latencyMs}ms
          </span>
        )}

        {runningExecId && (
          <span className="mono text-[10px]" style={{ color: 'var(--accent)' }}>
            running
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {runningExecId && (
            <button
              type="button"
              onClick={() => void bridge.kill(runningExecId).catch(() => undefined)}
              className="mono text-[10.5px]"
              style={{ color: 'var(--color-rose)' }}
            >
              kill
            </button>
          )}
          <button
            type="button"
            onClick={clearTerminal}
            className="mono text-[10.5px]"
            style={{ color: 'var(--ink-faint)' }}
          >
            clear
          </button>
        </div>
      </header>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-3 py-2.5">
        {lines.length === 0 ? (
          <div className="mono py-6 text-center text-[11.5px] leading-5" style={{ color: 'var(--ink-faint)' }}>
            {online ? (
              <>
                Bridge online.
                <br />
                {heartbeat.health?.platform} · node {heartbeat.health?.node}
                <br />
                java {heartbeat.health?.toolchains.java ? '✔' : '✘'} · gradle{' '}
                {heartbeat.health?.toolchains.gradle ? '✔' : '✘'} · sdk{' '}
                {heartbeat.health?.toolchains.androidSdk ? '✔' : '✘'}
              </>
            ) : (
              <>
                Terminal bridge is {heartbeat.status}.
                <br />
                Run <span style={{ color: 'var(--accent)' }}>npm run agent</span> on your machine, expose it with ngrok
                <br />
                or cloudflared, then paste the URL + token into Settings.
                <br />
                <span style={{ color: 'var(--ink-dim)' }}>Code generation continues without it.</span>
              </>
            )}
          </div>
        ) : (
          lines.map((line) => (
            <div key={line.id} className="term-line" style={{ color: STREAM_COLOR[line.stream] ?? 'var(--ink)' }}>
              {line.text}
            </div>
          ))
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t px-3 py-2" style={{ borderColor: 'var(--line)' }}>
        <span className="mono shrink-0 text-[12px]" style={{ color: 'var(--accent)' }}>
          {cwd === '.' ? '~' : cwd}$
        </span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit();
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              const next = Math.min(historyIndex + 1, history.length - 1);
              if (next >= 0) {
                setHistoryIndex(next);
                setInput(history[next]);
              }
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              const next = historyIndex - 1;
              setHistoryIndex(next);
              setInput(next >= 0 ? history[next] : '');
            }
          }}
          disabled={!online || Boolean(runningExecId)}
          placeholder={online ? 'run a command…' : 'bridge offline'}
          spellCheck={false}
          autoComplete="off"
          className="mono flex-1 bg-transparent text-[12.5px] outline-none disabled:opacity-40"
          style={{ color: 'var(--ink)' }}
          aria-label="Terminal command"
        />
      </div>
    </div>
  );
}
