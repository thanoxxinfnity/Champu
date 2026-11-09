'use client';

import { openSession } from '@/lib/session/open';
import { useCallback, useEffect, useState } from 'react';
import { useWorkspace } from '@/lib/store';
import { deleteSession, exportSuite, listMessages, listSessions, searchSessions, storageEstimate } from '@/lib/db/history';
import { SUITE_LABELS, type SessionRecord, type SuiteId } from '@/lib/db/schema';
import { downloadText, formatBytes } from '@/lib/zip';
import { LogoWordmark } from './Logo';
import { Icon } from '@/components/Icon';

interface SuiteEntry {
  id: SuiteId;
  label: string;
  icon: string;
  hint: string;
}

const CORE_SUITES: SuiteEntry[] = [
  { id: 'chat', label: 'Chat', icon: 'chat', hint: 'Technical discourse and general execution' },
  { id: 'android', label: 'Android', icon: 'android', hint: 'EXE/desktop migration, APK builds' },
  { id: 'minecraft', label: 'Minecraft', icon: 'minecraft', hint: 'Bedrock addons, Java conversion, Blockbench' },
  { id: 'studio', label: 'Studio', icon: 'studio', hint: 'Decks, canvas, documents, images' },
  { id: 'game', label: 'Game Studio', icon: 'game', hint: 'Godot games — plan, assets, project, APK' },
  { id: 'workdrive', label: 'Workdrive', icon: 'workdrive', hint: 'Autonomous research and milestones' },
  { id: 'assets', label: 'Asset Studio', icon: 'assets', hint: 'Background removal, icons and drawables' },
  { id: 'skills', label: 'Skills', icon: 'skills', hint: 'Slash commands and custom skills' },
];

const CAPABILITY_SUITE_META: Record<string, { label: string; icon: string; hint: string }> = {
  image: { label: 'Image', icon: 'image', hint: 'Multi-provider image generation' },
  video: { label: 'Video', icon: 'video', hint: 'Scenes on a timeline, generated clips' },
  audio: { label: 'Audio', icon: 'audio', hint: 'Speech and sound, with a waveform' },
  model3d: { label: '3D', icon: 'model3d', hint: 'Make and turn 3D models' },
};

/** Opens a viewer or editor of its own, so it has no list of chat sessions. */
const STANDALONE = new Set(['library', 'canvas', 'motion', 'shot2code', 'tools', 'handoff', 'craft', 'video', 'audio', 'model3d', 'skills']);

const CANVAS_ENTRY: SuiteEntry = { id: 'canvas', label: 'Canvas', icon: 'canvas', hint: 'Design app or website screens on a board and export them' };
const MOTION_ENTRY: SuiteEntry = { id: 'motion', label: 'Motion Studio', icon: 'motion', hint: 'Layers, keyframes and a timeline — export CSS, GSAP or HTML' };
const SHOT2CODE_ENTRY: SuiteEntry = { id: 'shot2code', label: 'Screenshot → Code', icon: 'shot2code', hint: 'Turn a screenshot or mock-up into HTML, Tailwind, React or Vue' };
const HANDOFF_ENTRY: SuiteEntry = { id: 'handoff', label: 'Handoff', icon: 'handoff', hint: 'Give a job to an agent that uses its own browser or computer — watch live, approve, take over; plus Panels' };
const CRAFT_ENTRY: SuiteEntry = { id: 'craft', label: 'Craft apps', icon: 'craft', hint: 'Open-source PhotoCraft, VectorCraft, FilmCraft ... and Craft Anything, run on your terminal computer' };
const TOOLS_ENTRY: SuiteEntry = { id: 'tools', label: 'Tools', icon: 'tools', hint: '190+ calculators, converters, generators and developer helpers — all on your device' };
const LIBRARY_ENTRY: SuiteEntry = { id: 'library', label: 'Library', icon: 'library', hint: 'Everything you generated — open and zoom up to 50×' };

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
          <span style={{ color: tools.java ? 'var(--accent)' : undefined }}>java <Icon name={tools.java ? 'check' : 'close'} size={10} style={{ display: 'inline', verticalAlign: '-1px' }} /></span>
          <span style={{ color: tools.gradle ? 'var(--accent)' : undefined }}>gradle <Icon name={tools.gradle ? 'check' : 'close'} size={10} style={{ display: 'inline', verticalAlign: '-1px' }} /></span>
          <span style={{ color: tools.androidSdk ? 'var(--accent)' : undefined }}>sdk <Icon name={tools.androidSdk ? 'check' : 'close'} size={10} style={{ display: 'inline', verticalAlign: '-1px' }} /></span>
          <span style={{ color: tools.node ? 'var(--accent)' : undefined }}>node <Icon name={tools.node ? 'check' : 'close'} size={10} style={{ display: 'inline', verticalAlign: '-1px' }} /></span>
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
export function Sidebar({ onOpenSettings, onNavigate }: { onOpenSettings: () => void; /** Called after the user picks somewhere to go, so a phone's overlay menu can close. */ onNavigate?: () => void }) {
  const activeSuite = useWorkspace((s) => s.activeSuite);
  const setSuite = useWorkspace((s) => s.setSuite);
  const sessionId = useWorkspace((s) => s.sessionId);
  const runs = useWorkspace((s) => s.runs);
  const queuedIds = useWorkspace((s) => s.queue);
  const setSessionId = useWorkspace((s) => s.setSessionId);
  const capabilityTabs = useWorkspace((s) => s.capabilityTabs);
  const mediaHidden = useWorkspace((s) => s.mediaHidden);
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

  const newSession = (suite: SuiteId) => {
    setSuite(suite);
    setSessionId(null);
    clearMessages();
    if (!useWorkspace.getState().runSessionId) {
      setPlan(null);
      setFiles(new Map());
      useWorkspace.getState().setSlotOwner(null);
    }
  };

  const suites: SuiteEntry[] = [
    LIBRARY_ENTRY,
    CANVAS_ENTRY,
    HANDOFF_ENTRY,
    CRAFT_ENTRY,
    TOOLS_ENTRY,
    SHOT2CODE_ENTRY,
    MOTION_ENTRY,
    ...CORE_SUITES,
    ...capabilityTabs
      .filter((id) => CAPABILITY_SUITE_META[id] && !mediaHidden.includes(id))
      .map((id) => ({ id, ...CAPABILITY_SUITE_META[id] })),
  ];

  return (
    <aside
      className="flex h-full w-64 shrink-0 flex-col border-r"
      style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}
    >
      <header className="shrink-0 px-3 py-3">
        <LogoWordmark size={18} />
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

          if (STANDALONE.has(suite.id)) {
            return (
              <div key={suite.id} className="mb-0.5">
                <button
                  type="button"
                  onClick={() => { setSuite(suite.id); setExpanded(null); onNavigate?.(); }}
                  className="press flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left"
                  style={{
                    background: isActive ? 'color-mix(in oklab, var(--accent) 12%, transparent)' : undefined,
                    boxShadow: isActive ? 'inset 2px 0 0 var(--accent)' : undefined,
                    color: isActive ? 'var(--accent)' : 'var(--ink-dim)',
                  }}
                  title={suite.hint}
                >
                  <span className="shrink-0" aria-hidden style={{ color: 'var(--ink-dim)' }}><Icon name={suite.icon} size={15} /></span>
                  <span className="truncate text-[12.5px] font-medium">{suite.label}</span>
                </button>
              </div>
            );
          }

          return (
            <div key={suite.id} className="mb-0.5">
              <button
                type="button"
                onClick={() => {
                  setExpanded(isExpanded ? null : suite.id);
                  setSuite(suite.id);
                }}
                className="press flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left"
                style={{
                  background: isActive ? 'color-mix(in oklab, var(--accent) 12%, transparent)' : undefined,
                  boxShadow: isActive ? 'inset 2px 0 0 var(--accent)' : undefined,
                  color: isActive ? 'var(--accent)' : 'var(--ink-dim)',
                }}
                title={suite.hint}
              >
                <span className="shrink-0" aria-hidden style={{ color: 'var(--ink-dim)' }}>
                  <Icon name={suite.icon} size={15} />
                </span>
                <span className="truncate text-[12.5px] font-medium">{suite.label}</span>
                <span
                  className="ml-auto shrink-0 transition-transform duration-200"
                  style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', color: 'var(--ink-faint)' }}
                  aria-hidden
                >
                  <Icon name="chevronRight" size={13} />
                </span>
              </button>

              {isExpanded && (
                <div className="ml-2 mt-0.5 border-l pl-2" style={{ borderColor: 'var(--line)' }}>
                  <button
                    type="button"
                    onClick={() => { newSession(suite.id); onNavigate?.(); }}
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
                          onClick={() => { void openSession(session); onNavigate?.(); }}
                          className="press min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-[11px]"
                          style={{
                            color: sessionId === session.id ? 'var(--accent)' : 'var(--ink-dim)',
                            background: sessionId === session.id ? 'color-mix(in oklab, var(--accent) 8%, transparent)' : undefined,
                          }}
                          title={session.summary ?? session.title}
                        >
                          {session.title}
                        </button>
                        {runs[session.id] && (
                          <span className="thinking-dot shrink-0" role="status" aria-label="Running in this session" title="Running" />
                        )}
                        {queuedIds.some((q) => q.sessionId === session.id) && (
                          <span className="mono shrink-0 text-[9px]" style={{ color: 'var(--ink-faint)' }} title="Messages waiting">
                            +{queuedIds.filter((q) => q.sessionId === session.id).length}
                          </span>
                        )}
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
                          <Icon name="close" size={13} />
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
                      <span className="inline-flex items-center gap-1"><Icon name="download" size={11} />export history</span>
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
          <span className="inline-flex items-center justify-center gap-1.5"><Icon name="settings" size={13} />settings</span>
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
