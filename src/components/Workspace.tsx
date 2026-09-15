'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useWorkspace } from '@/lib/store';
import { resumeParkedWork } from '@/lib/agent/runtime';
import { Sidebar } from './Sidebar';
import { Message } from './Message';
import { ThinkingBubble } from './ThinkingBubble';
import { TodoHud } from './TodoHud';
import { SitePreview } from './SitePreview';
import { Terminal } from './Terminal';
import { FileManager } from './FileManager';
import { CommandDock } from './CommandDock';
import { Settings } from './Settings';
import { DeployButton } from './DeployButton';
import { DraftPicker } from './DraftPicker';
import { AssetStudio } from './suites/AssetStudio';
import { LogoMark, LogoWordmark } from './Logo';
import { ThemeToggle } from './ThemeToggle';
import { RunNotices } from './RunNotices';
import { BedrockBuilder } from './suites/BedrockBuilder';
import { BlockbenchStudio } from './suites/Blockbench';
import { AndroidStudio } from './suites/AndroidStudio';
import { GameStudio } from './suites/GameStudio';
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
    case 'game':
      return <GameStudio />;
    case 'image':
      return <ImageSuite />;
    case 'workdrive':
      return <Workdrive />;
    case 'skills':
      return <SkillsManager />;
    case 'assets':
      return <AssetStudio />;
    default:
      return null;
  }
}

const HAS_TOOL = new Set(['android', 'minecraft', 'studio', 'game', 'image', 'workdrive', 'skills', 'assets']);

export function Workspace() {
  const activeSuite = useWorkspace((s) => s.activeSuite);
  const messages = useWorkspace((s) => s.messages);
  const sidebarOpen = useWorkspace((s) => s.sidebarOpen);
  const toggleSidebar = useWorkspace((s) => s.toggleSidebar);
  // Separate from `sidebarOpen`: on a phone the navigation is an overlay that
  // must start closed, while on a desktop it is a column that starts open.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // An overlay that covers the whole screen has to be dismissible by Escape as
  // well as by tapping away, or a keyboard user is simply trapped in it.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileNavOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileNavOpen]);
  const rightPaneTab = useWorkspace((s) => s.rightPaneTab);
  const setRightPaneTab = useWorkspace((s) => s.setRightPaneTab);
  const hydrate = useWorkspace((s) => s.hydrate);
  const setEndpoints = useWorkspace((s) => s.setEndpoints);
  const heartbeat = useWorkspace((s) => s.heartbeat);
  const files = useWorkspace((s) => s.files);
  const plan = useWorkspace((s) => s.plan);
  const modelWarnings = useWorkspace((s) => s.modelWarnings);

  const [settingsOpen, setSettingsOpen] = useState(false);
  // Below `lg` the split pane has nowhere to live, so plan/files/terminal move
  // into a sheet that slides over the chat. Without this they are unreachable on
  // a phone — which is where the Android build spends all of its time.
  const [sheetOpen, setSheetOpen] = useState(false);
  const tabRailRef = useRef<HTMLElement>(null);
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
  // A website is worth watching run, so the tab appears the moment one exists —
  // in any suite, since "build me a landing page" is not a suite of its own.
  const hasSite = Array.from(files.keys()).some((path) => /\.html?$/i.test(path));
  const tabs: Array<{ id: typeof rightPaneTab; label: string; badge?: number }> = [
    ...(suiteHasTool ? [{ id: 'preview' as const, label: 'tool' }] : []),
    ...(hasSite ? [{ id: 'site' as const, label: 'site' }] : []),
    { id: 'plan', label: 'plan', badge: plan?.tasks.length },
    { id: 'files', label: 'files', badge: files.size || undefined },
    { id: 'terminal', label: 'terminal' },
  ];

  // Fall back to a tab that exists for this suite.
  const effectiveTab = tabs.some((t) => t.id === rightPaneTab) ? rightPaneTab : tabs[0].id;

  // Position the sliding underline from the active tab's real geometry —
  // percentage guesses drift as soon as a badge changes a tab's width.
  useLayoutEffect(() => {
    const rail = tabRailRef.current;
    if (!rail) return;
    const active = rail.querySelector<HTMLElement>(`[data-tab="${effectiveTab}"]`);
    if (!active) return;
    rail.style.setProperty('--tab-x', `${active.offsetLeft}px`);
    rail.style.setProperty('--tab-w', `${active.offsetWidth}px`);
  }, [effectiveTab, tabs.length, files.size, plan?.tasks.length]);

  const paneBody = (
    <>
      {effectiveTab === 'preview' && <SuiteTool />}
      {effectiveTab === 'site' && <SitePreview />}
      {effectiveTab === 'plan' && <TodoHud />}
      {effectiveTab === 'files' && <FileManager />}
      {effectiveTab === 'terminal' && <Terminal />}
    </>
  );

  return (
    <div className="sketch-ui flex h-dvh overflow-hidden" style={{ background: 'var(--bg)' }}>
      {/* Desktop: the sidebar is a real column in the layout. */}
      {sidebarOpen && (
        <div className="hidden md:block">
          <Sidebar onOpenSettings={() => setSettingsOpen(true)} />
        </div>
      )}

      {/*
        Phone: an overlay drawer.
        The desktop column above is `hidden md:block`, so on a phone the
        hamburger was toggling state that had nothing to render — the menu
        simply never opened, and with it every suite, the history and Settings
        were unreachable on the one build that ships as an app.
      */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.55)', animation: 'enter-fade var(--dur-fast) var(--ease-out)' }}
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close menu"
          />
          <div
            className="drawer-in absolute inset-y-0 left-0 flex w-[84%] max-w-[330px] flex-col overflow-hidden"
            style={{ background: 'var(--panel)', borderRight: '1.5px solid var(--stroke)' }}
          >
            <Sidebar
              onOpenSettings={() => {
                setSettingsOpen(true);
                setMobileNavOpen(false);
              }}
            />
          </div>
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <header
          className="flex shrink-0 items-center gap-2 border-b px-3 py-2"
          style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}
        >
          <button
            type="button"
            onClick={() => {
              toggleSidebar();
              setMobileNavOpen((v) => !v);
            }}
            className="press mono rounded-lg px-2 py-1 text-[12px]"
            style={{ color: 'var(--ink-faint)' }}
            aria-label="Toggle sidebar"
            title="⌘B"
          >
            ☰
          </button>

          <span className="hand text-[17px] leading-none" style={{ color: 'var(--ink-dim)' }}>
            {activeSuite}
          </span>

          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <DeployButton onOpenSettings={() => setSettingsOpen(true)} />
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="press mono rounded-lg px-2 py-1 text-[12px]"
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
            {/*
              A warning that names the fix but offers no way to reach it is just
              a complaint. The missing-key case is the one that stops the app
              working, so it gets a button straight to the field.
            */}
            {modelWarnings.some((w) => /API Keys|NVIDIA_NIM_API_KEY/i.test(w)) && (
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="press mono shrink-0 rounded-lg px-2 py-1 text-[10px] font-semibold"
                style={{ background: 'var(--accent)', color: 'var(--panel)' }}
              >
                add key
              </button>
            )}
            <button
              type="button"
              onClick={() => setWarningsDismissed(true)}
              className="mono shrink-0 text-[10px]"
              style={{ color: 'var(--color-amber)' }}
              aria-label="Dismiss"
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
                  <div className="enter-rise max-w-md text-center">
                    <div className="thinking-shell mx-auto mb-5 block h-14 w-14">
                      <span className="thinking-aurora" aria-hidden />
                      <LogoMark size={56} id="empty-state" />
                    </div>
                    <h2 className="hand text-[34px] leading-none">Chomugiri</h2>
                    <p className="mt-2 text-[12.5px] leading-[1.65]" style={{ color: 'var(--ink-dim)', textWrap: 'balance' }}>
                      Ask a technical question and it routes to <strong>Lane A</strong> — direct answers, no filler.
                      <br />
                      Describe something to build and it routes to <strong>Lane B</strong> — an atomic plan, generated
                      files, and real builds over the terminal bridge.
                    </p>
                    <p className="mono mt-5 text-[10.5px] leading-[1.9]" style={{ color: 'var(--ink-faint)', textWrap: 'balance' }}>
                      /make-apk · /build-mcpack · /build-game
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
                  {/* Indented to the message text column so the pill reads as
                      part of the assistant's turn, not a floating toast. */}
                  <div className="pb-3 pl-4 pr-4">
                    <ThinkingBubble />
                  </div>
                  <DraftPicker />
                </>
              )}
            </div>

            <nav className="flex shrink-0 gap-1.5 overflow-x-auto px-3 pb-1 pt-2 lg:hidden">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setRightPaneTab(tab.id);
                    setSheetOpen(true);
                  }}
                  className="press mono flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10.5px]"
                  style={{
                    borderColor: 'var(--line)',
                    background: 'color-mix(in oklab, var(--panel) 70%, transparent)',
                    color: 'var(--ink-dim)',
                  }}
                >
                  {tab.label}
                  {tab.badge != null && tab.badge > 0 && (
                    <span
                      className="rounded-full px-1.5 py-px text-[9px] tabular-nums"
                      style={{ background: 'color-mix(in oklab, var(--accent) 18%, transparent)', color: 'var(--accent)' }}
                    >
                      {tab.badge}
                    </span>
                  )}
                </button>
              ))}
            </nav>

            <CommandDock />
          </section>

          {/* Right pane */}
          <section
            className="hidden w-[46%] min-w-0 shrink-0 flex-col border-l lg:flex xl:w-[42%]"
            style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}
          >
            <nav
              ref={tabRailRef}
              className="tab-rail flex shrink-0 border-b"
              style={{ borderColor: 'var(--line)' }}
            >
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  data-tab={tab.id}
                  onClick={() => setRightPaneTab(tab.id)}
                  className="press mono flex items-center gap-1.5 px-3.5 py-2.5 text-[10.5px]"
                  style={{ color: effectiveTab === tab.id ? 'var(--accent)' : 'var(--ink-dim)' }}
                >
                  {tab.label}
                  {tab.badge != null && tab.badge > 0 && (
                    <span
                      className="rounded px-1 py-px text-[9px] tabular-nums"
                      style={{
                        background: effectiveTab === tab.id
                          ? 'color-mix(in oklab, var(--accent) 18%, transparent)'
                          : 'var(--surface)',
                        color: effectiveTab === tab.id ? 'var(--accent)' : 'var(--ink-faint)',
                        transition: 'background var(--dur-base) var(--ease-out), color var(--dur-base) var(--ease-out)',
                      }}
                    >
                      {tab.badge}
                    </span>
                  )}
                </button>
              ))}
            </nav>

            <div className="min-h-0 flex-1">{paneBody}</div>
          </section>
        </div>
      </main>

      {sheetOpen && (
        <div
          className="enter-fade fixed inset-0 z-40 flex flex-col justify-end lg:hidden"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }}
          onClick={() => setSheetOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label={`${effectiveTab} pane`}
        >
          <div
            className="flex h-[82dvh] flex-col overflow-hidden rounded-t-2xl border-t"
            style={{
              borderColor: 'var(--line-strong)',
              background: 'var(--panel)',
              animation: 'sheet-up 320ms var(--ease-out)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="relative flex shrink-0 items-center gap-2 border-b px-3 pb-2.5 pt-4"
              style={{ borderColor: 'var(--line)' }}
            >
              <span
                className="absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full"
                style={{ background: 'var(--line-strong)' }}
                aria-hidden
              />
              <div className="flex gap-1">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setRightPaneTab(tab.id)}
                    className="press mono rounded-lg px-2.5 py-1.5 text-[10.5px]"
                    style={{
                      background: effectiveTab === tab.id ? 'color-mix(in oklab, var(--accent) 13%, transparent)' : undefined,
                      color: effectiveTab === tab.id ? 'var(--accent)' : 'var(--ink-dim)',
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="press mono ml-auto rounded-lg px-2 py-1 text-[12px]"
                style={{ color: 'var(--ink-faint)' }}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1">{paneBody}</div>
          </div>
        </div>
      )}

      <RunNotices />

      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
