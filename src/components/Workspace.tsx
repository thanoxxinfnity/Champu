'use client';

import { useEffect, useRef, useState } from 'react';
import { useWorkspace } from '@/lib/store';
import { resumeParkedWork } from '@/lib/agent/runtime';
import { Sidebar } from './Sidebar';
import { Message } from './Message';
import { ThinkingBubble } from './ThinkingBubble';
import { TodoHud } from './TodoHud';
import { Terminal } from './Terminal';
import { FileManager } from './FileManager';
import { CommandDock } from './CommandDock';
import { Settings } from './Settings';
import { DeployButton } from './DeployButton';
import { BedrockBuilder } from './suites/BedrockBuilder';
import { BlockbenchStudio } from './suites/Blockbench';
import { AndroidStudio } from './suites/AndroidStudio';
import { McpBuilder } from './suites/McpBuilder';
import { ImageSuite } from './suites/ImageSuite';
import { Workdrive } from './suites/Workdrive';
import { SkillsManager } from './suites/SkillsManager';
import { Studio } from './suites/Studio';
import { db, isBrowser } from '@/lib/db/schema';

/** Suite-specific tool pane shown on the right when the suite has one. */
function SuiteTool() {
  const suite = useWorkspace((s) => s.activeSuite);
  const [minecraftTab, setMinecraftTab] = useState<'addon' | 'model'>('addon');

  switch (suite) {
    case 'android':
      return <AndroidStudio />;
    case 'minecraft':
      return (
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex shrink-0 border-b" style={{ borderColor: 'var(--line)' }}>
            {(['addon', 'model'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setMinecraftTab(tab)}
                className="mono px-3 py-2 text-[10.5px] transition-colors"
                style={{
                  background: minecraftTab === tab ? 'color-mix(in oklab, var(--accent) 12%, transparent)' : undefined,
                  color: minecraftTab === tab ? 'var(--accent)' : 'var(--ink-dim)',
                }}
              >
                {tab === 'addon' ? 'addon builder' : 'blockbench 3d'}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">{minecraftTab === 'addon' ? <BedrockBuilder /> : <BlockbenchStudio />}</div>
        </div>
      );
    case 'studio':
      return <Studio />;
    case 'mcp':
      return <McpBuilder />;
    case 'image':
      return <ImageSuite />;
    case 'workdrive':
      return <Workdrive />;
    case 'skills':
      return <SkillsManager />;
    default:
      return null;
  }
}

const HAS_TOOL = new Set(['android', 'minecraft', 'studio', 'mcp', 'image', 'workdrive', 'skills']);

export function Workspace() {
  const activeSuite = useWorkspace((s) => s.activeSuite);
  const messages = useWorkspace((s) => s.messages);
  const sidebarOpen = useWorkspace((s) => s.sidebarOpen);
  const toggleSidebar = useWorkspace((s) => s.toggleSidebar);
  const rightPaneTab = useWorkspace((s) => s.rightPaneTab);
  const setRightPaneTab = useWorkspace((s) => s.setRightPaneTab);
  const hydrate = useWorkspace((s) => s.hydrate);
  const setEndpoints = useWorkspace((s) => s.setEndpoints);
  const heartbeat = useWorkspace((s) => s.heartbeat);
  const files = useWorkspace((s) => s.files);
  const plan = useWorkspace((s) => s.plan);
  const modelWarnings = useWorkspace((s) => s.modelWarnings);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [warningsDismissed, setWarningsDismissed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const bootedRef = useRef(false);

  // ── Boot ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;

    void hydrate();

    if (isBrowser()) {
      void db().endpoints.toArray().then(setEndpoints).catch(() => undefined);
    }

    return () => useWorkspace.getState().stopHeartbeat();
  }, [hydrate, setEndpoints]);

  // Bridge recovery un-parks blocked steps.
  useEffect(() => {
    if (heartbeat.status === 'online') void resumeParkedWork();
  }, [heartbeat.status]);

  // Autoscroll the chat, but only while the user is at the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Global shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        setSettingsOpen(true);
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toggleSidebar]);

  const suiteHasTool = HAS_TOOL.has(activeSuite);
  const tabs: Array<{ id: typeof rightPaneTab; label: string; badge?: number }> = [
    ...(suiteHasTool ? [{ id: 'preview' as const, label: 'tool' }] : []),
    { id: 'plan', label: 'plan', badge: plan?.tasks.length },
    { id: 'files', label: 'files', badge: files.size || undefined },
    { id: 'terminal', label: 'terminal' },
  ];

  // Fall back to a tab that exists for this suite.
  const effectiveTab = tabs.some((t) => t.id === rightPaneTab) ? rightPaneTab : tabs[0].id;

  return (
    <div className="flex h-dvh overflow-hidden" style={{ background: 'var(--bg)' }}>
      {sidebarOpen && (
        <div className="hidden md:block">
          <Sidebar onOpenSettings={() => setSettingsOpen(true)} />
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <header
          className="flex shrink-0 items-center gap-2 border-b px-3 py-2"
          style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}
        >
          <button
            type="button"
            onClick={toggleSidebar}
            className="mono rounded px-1.5 py-1 text-[12px]"
            style={{ color: 'var(--ink-faint)' }}
            aria-label="Toggle sidebar"
            title="⌘B"
          >
            ☰
          </button>

          <span className="mono text-[11px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-dim)' }}>
            {activeSuite}
          </span>

          <div className="ml-auto flex items-center gap-2">
            <DeployButton />
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="mono rounded px-1.5 py-1 text-[12px]"
              style={{ color: 'var(--ink-faint)' }}
              aria-label="Settings"
              title="⌘,"
            >
              ⚙
            </button>
          </div>
        </header>

        {modelWarnings.length > 0 && !warningsDismissed && (
          <div
            className="flex shrink-0 items-start gap-2 border-b px-3 py-2"
            style={{ borderColor: 'var(--line)', background: 'color-mix(in oklab, var(--color-amber) 8%, transparent)' }}
          >
            <div className="min-w-0 flex-1">
              {modelWarnings.map((warning, i) => (
                <p key={i} className="text-[10.5px] leading-[1.45]" style={{ color: 'var(--color-amber)' }}>
                  {warning}
                </p>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setWarningsDismissed(true)}
              className="mono shrink-0 text-[10px]"
              style={{ color: 'var(--color-amber)' }}
            >
              ✕
            </button>
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          {/* Chat column */}
          <section className="flex min-w-0 flex-1 flex-col">
            <div ref={scrollRef} onScroll={() => {
              const el = scrollRef.current;
              if (el) pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
            }} className="min-h-0 flex-1 overflow-y-auto">
              {messages.length === 0 ? (
                <div className="flex h-full items-center justify-center p-8">
                  <div className="max-w-md text-center">
                    <div
                      className="mono mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl text-[16px] font-bold"
                      style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-alt))', color: '#04150e' }}
                      aria-hidden
                    >
                      C
                    </div>
                    <h2 className="text-[17px] font-semibold tracking-tight">Chomugiri</h2>
                    <p className="mt-1.5 text-[12.5px] leading-[1.6]" style={{ color: 'var(--ink-dim)' }}>
                      Ask a technical question and it routes to <strong>Lane A</strong> — direct answers, no filler.
                      <br />
                      Describe something to build and it routes to <strong>Lane B</strong> — an atomic plan, generated
                      files, and real builds over the terminal bridge.
                    </p>
                    <p className="mono mt-4 text-[10.5px] leading-[1.7]" style={{ color: 'var(--ink-faint)' }}>
                      /make-apk · /build-mcpack · /build-mcp
                      <br />
                      /make-deck · /research · /audit-code · /deploy
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {messages.map((message) => (
                    <Message key={message.id} message={message} />
                  ))}
                  <div className="px-4 pb-2">
                    <ThinkingBubble />
                  </div>
                </>
              )}
            </div>

            <CommandDock />
          </section>

          {/* Right pane */}
          <section
            className="hidden w-[46%] min-w-0 shrink-0 flex-col border-l lg:flex xl:w-[42%]"
            style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}
          >
            <nav className="flex shrink-0 border-b" style={{ borderColor: 'var(--line)' }}>
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setRightPaneTab(tab.id)}
                  className="mono flex items-center gap-1.5 px-3 py-2 text-[10.5px] transition-colors"
                  style={{
                    background: effectiveTab === tab.id ? 'color-mix(in oklab, var(--accent) 12%, transparent)' : undefined,
                    color: effectiveTab === tab.id ? 'var(--accent)' : 'var(--ink-dim)',
                  }}
                >
                  {tab.label}
                  {tab.badge != null && tab.badge > 0 && (
                    <span
                      className="rounded px-1 py-px text-[9px]"
                      style={{ background: 'var(--surface)', color: 'var(--ink-faint)' }}
                    >
                      {tab.badge}
                    </span>
                  )}
                </button>
              ))}
            </nav>

            <div className="min-h-0 flex-1">
              {effectiveTab === 'preview' && <SuiteTool />}
              {effectiveTab === 'plan' && <TodoHud />}
              {effectiveTab === 'files' && <FileManager />}
              {effectiveTab === 'terminal' && <Terminal />}
            </div>
          </section>
        </div>
      </main>

      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
