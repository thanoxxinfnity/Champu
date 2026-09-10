'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWorkspace } from '@/lib/store';
import { deleteSession, exportSuite, listMessages, listSessions, searchSessions, storageEstimate } from '@/lib/db/history';
import { SUITE_LABELS, type SessionRecord, type SuiteId } from '@/lib/db/schema';
import { downloadText, formatBytes } from '@/lib/zip';

interface SuiteEntry {
  id: SuiteId;
  label: string;
  icon: string;
  hint: string;
}

const CORE_SUITES: SuiteEntry[] = [
  { id: 'chat', label: 'Chat', icon: '◈', hint: 'Technical discourse and general execution' },
  { id: 'android', label: 'Android', icon: '▤', hint: 'EXE/desktop migration, APK builds' },
  { id: 'minecraft', label: 'Minecraft', icon: '▩', hint: 'Bedrock addons, Java conversion, Blockbench' },
  { id: 'studio', label: 'Studio', icon: '◫', hint: 'Decks, canvas, documents, images' },
  { id: 'mcp', label: 'MCP Builder', icon: '⬡', hint: 'Model Context Protocol servers' },
  { id: 'workdrive', label: 'Workdrive', icon: '◎', hint: 'Autonomous research and milestones' },
  { id: 'skills', label: 'Skills', icon: '✦', hint: 'Slash commands and custom skills' },
];

const CAPABILITY_SUITE_META: Record<string, { label: string; icon: string; hint: string }> = {
  image: { label: 'Image', icon: '◐', hint: 'Multi-provider image generation' },
  video: { label: 'Video', icon: '▷', hint: 'Detected on a custom endpoint' },
  audio: { label: 'Audio', icon: '◍', hint: 'Detected on a custom endpoint' },
  model3d: { label: '3D', icon: '⬢', hint: 'Detected on a custom endpoint' },
};

function BridgeStatusCard({ onOpenSettings }: { onOpenSettings: () => void }) {
  const heartbeat = useWorkspace((s) => s.heartbeat);
  const monitor = useWorkspace((s) => s.monitor);

  const color =
    heartbeat.status === 'online' ? 'var(--accent)'
      : heartbeat.status === 'degraded' ? 'var(--color-amber)'
        : heartbeat.status === 'connecting' ? 'var(--color-indigo)'
          : 'var(--color-rose)';

  const tools = heartbeat.health?.toolchains;

  return (
    <div className="mx-2 mb-2 rounded-lg border p-2.5" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
      <div className="flex items-center gap-2">
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: color, boxShadow: heartbeat.status === 'online' ? `0 0 8px ${color}` : undefined }}
          aria-hidden
        />
        <span className="mono text-[10px] uppercase tracking-[0.12em]" style={{ color }}>
          bridge {heartbeat.status}
        </span>
        {heartbeat.latencyMs != null && (
          <span className="mono ml-auto text-[9.5px]" style={{ color: 'var(--ink-faint)' }}>
            {heartbeat.latencyMs}ms
          </span>
        )}
      </div>

      {heartbeat.status === 'online' && tools ? (
        <div className="mono mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[9.5px]" style={{ color: 'var(--ink-faint)' }}>
          <span style={{ color: tools.java ? 'var(--accent)' : undefined }}>java {tools.java ? '✔' : '✘'}</span>
          <span style={{ color: tools.gradle ? 'var(--accent)' : undefined }}>gradle {tools.gradle ? '✔' : '✘'}</span>
          <span style={{ color: tools.androidSdk ? 'var(--accent)' : undefined }}>sdk {tools.androidSdk ? '✔' : '✘'}</span>
          <span style={{ color: tools.node ? 'var(--accent)' : undefined }}>node {tools.node ? '✔' : '✘'}</span>
        </div>
      ) : (
        <p className="mt-1 text-[10px] leading-[1.45]" style={{ color: 'var(--ink-faint)' }}>
          {heartbeat.lastError ?? 'Not configured. Terminal steps will be parked; code generation continues.'}
        </p>
      )}

      <div className="mt-1.5 flex gap-1.5">
        <button
          type="button"
          onClick={() => void monitor?.ping()}
          className="mono flex-1 rounded border px-1.5 py-1 text-[9.5px]"
          style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
        >
          reconnect
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          className="mono flex-1 rounded border px-1.5 py-1 text-[9.5px]"
          style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
        >
          configure
        </button>
      </div>
    </div>
  );
}

/** Left navigation with an independent history viewer per suite. */
export function Sidebar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const activeSuite = useWorkspace((s) => s.activeSuite);
  const setSuite = useWorkspace((s) => s.setSuite);
  const sessionId = useWorkspace((s) => s.sessionId);
  const setSessionId = useWorkspace((s) => s.setSessionId);
  const capabilityTabs = useWorkspace((s) => s.capabilityTabs);
  const clearMessages = useWorkspace((s) => s.clearMessages);
  const pushMessage = useWorkspace((s) => s.pushMessage);
  const setPlan = useWorkspace((s) => s.setPlan);
  const setFiles = useWorkspace((s) => s.setFiles);

  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<SuiteId | null>(activeSuite);
  const [storage, setStorage] = useState<{ usedBytes: number; quotaBytes: number } | null>(null);

  const refresh = useCallback(async (suite: SuiteId, search: string) => {
    const rows = search.trim() ? await searchSessions(suite, search) : await listSessions(suite, { limit: 80 });
    setSessions(rows);
  }, []);

  useEffect(() => {
    void refresh(expanded ?? activeSuite, query);
  }, [expanded, activeSuite, query, refresh, sessionId]);

  useEffect(() => {
    void storageEstimate().then(setStorage);
  }, [sessions.length]);

  const openSession = async (session: SessionRecord) => {
    setSuite(session.suite);
    setSessionId(session.id);
    clearMessages();
    setPlan(null);
    setFiles(new Map());

    const messages = await listMessages(session.id);
    for (const m of messages) {
      if (m.role === 'tool') continue;
      pushMessage({
        id: m.id,
        role: m.role,
        content: m.content,
        reasoning: m.reasoning,
        lane: m.lane,
        model: m.model,
        provider: m.provider as never,
        createdAt: m.createdAt,
        attachments: m.attachments?.map((a, i) => ({ id: `${m.id}_${i}`, ...a })),
        usage: m.usage,
        durationMs: m.durationMs,
      });
    }
  };

  const newSession = (suite: SuiteId) => {
    setSuite(suite);
    setSessionId(null);
    clearMessages();
    setPlan(null);
    setFiles(new Map());
  };

  const suites: SuiteEntry[] = [
    ...CORE_SUITES,
    ...capabilityTabs
      .filter((id) => CAPABILITY_SUITE_META[id])
      .map((id) => ({ id, ...CAPABILITY_SUITE_META[id] })),
  ];

  return (
    <aside
      className="flex h-full w-64 shrink-0 flex-col border-r"
      style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}
    >
      <header className="shrink-0 px-3 py-3">
        <div className="flex items-center gap-2">
          <div
            className="mono flex h-6 w-6 items-center justify-center rounded text-[11px] font-bold"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-alt))', color: '#04150e' }}
            aria-hidden
          >
            C
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-[13px] font-semibold tracking-tight">Chomugiri</h1>
            <p className="mono text-[9px] uppercase tracking-[0.14em]" style={{ color: 'var(--ink-faint)' }}>
              autonomous workspace
            </p>
          </div>
        </div>
      </header>

      <BridgeStatusCard onOpenSettings={onOpenSettings} />

      <div className="px-2 pb-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="search history…"
          className="mono w-full rounded-lg border bg-transparent px-2.5 py-1.5 text-[11px] outline-none placeholder:opacity-45"
          style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
        />
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        {suites.map((suite) => {
          const isExpanded = expanded === suite.id;
          const isActive = activeSuite === suite.id;

          return (
            <div key={suite.id} className="mb-0.5">
              <button
                type="button"
                onClick={() => {
                  setExpanded(isExpanded ? null : suite.id);
                  setSuite(suite.id);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors"
                style={{
                  background: isActive ? 'color-mix(in oklab, var(--accent) 12%, transparent)' : undefined,
                  color: isActive ? 'var(--accent)' : 'var(--ink-dim)',
                }}
                title={suite.hint}
              >
                <span className="shrink-0 text-[12px]" aria-hidden>
                  {suite.icon}
                </span>
                <span className="truncate text-[12.5px] font-medium">{suite.label}</span>
                <span
                  className="mono ml-auto shrink-0 text-[9px] transition-transform duration-200"
                  style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', color: 'var(--ink-faint)' }}
                  aria-hidden
                >
                  ▶
                </span>
              </button>

              {isExpanded && (
                <div className="ml-2 mt-0.5 border-l pl-2" style={{ borderColor: 'var(--line)' }}>
                  <button
                    type="button"
                    onClick={() => newSession(suite.id)}
                    className="mono mb-0.5 w-full rounded px-2 py-1 text-left text-[10.5px] transition-colors"
                    style={{ color: 'var(--accent)' }}
                  >
                    + new session
                  </button>

                  {sessions.length === 0 ? (
                    <p className="mono px-2 py-1 text-[10px]" style={{ color: 'var(--ink-faint)' }}>
                      {query ? 'no matches' : 'no history yet'}
                    </p>
                  ) : (
                    sessions.map((session) => (
                      <div key={session.id} className="group flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void openSession(session)}
                          className="min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-[11px] transition-colors"
                          style={{
                            color: sessionId === session.id ? 'var(--accent)' : 'var(--ink-dim)',
                            background: sessionId === session.id ? 'color-mix(in oklab, var(--accent) 8%, transparent)' : undefined,
                          }}
                          title={session.summary ?? session.title}
                        >
                          {session.title}
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await deleteSession(session.id);
                            if (sessionId === session.id) newSession(suite.id);
                            void refresh(suite.id, query);
                          }}
                          className="mono shrink-0 px-1 text-[10px] opacity-0 transition-opacity group-hover:opacity-100"
                          style={{ color: 'var(--color-rose)' }}
                          aria-label={`Delete ${session.title}`}
                        >
                          ✕
                        </button>
                      </div>
                    ))
                  )}

                  {sessions.length > 0 && (
                    <button
                      type="button"
                      onClick={async () => {
                        const data = await exportSuite(suite.id);
                        downloadText(
                          JSON.stringify(data, null, 2),
                          `chomugiri-${suite.id}-history.json`,
                          'application/json',
                        );
                      }}
                      className="mono mt-0.5 w-full rounded px-2 py-1 text-left text-[9.5px]"
                      style={{ color: 'var(--ink-faint)' }}
                      title={`Export ${SUITE_LABELS[suite.id]} history (credentials excluded)`}
                    >
                      ↓ export history
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <footer className="shrink-0 border-t px-3 py-2" style={{ borderColor: 'var(--line)' }}>
        <button
          type="button"
          onClick={onOpenSettings}
          className="mono w-full rounded-lg border px-2 py-1.5 text-[10.5px] transition-colors"
          style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
        >
          ⚙ settings
        </button>
        {storage && storage.quotaBytes > 0 && (
          <p className="mono mt-1.5 text-center text-[9px]" style={{ color: 'var(--ink-faint)' }}>
            {formatBytes(storage.usedBytes)} local
          </p>
        )}
      </footer>
    </aside>
  );
}
