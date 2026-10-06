'use client';

import { create } from 'zustand';
import { BridgeClient, HeartbeatMonitor, INITIAL_HEARTBEAT, type HeartbeatState } from '@/lib/bridge/client';
import type { ModelDescriptor, ProviderId } from '@/lib/providers/types';
import { DEFAULT_NIM_MODEL } from '@/lib/providers/registry';
import type { Plan, Task, TaskStatus } from '@/lib/agent/planner';
import { AntiLoopGuard, type Fingerprint } from '@/lib/agent/fingerprint';
import type { EndpointRecord, SuiteId } from '@/lib/db/schema';
import type { FileArtifact } from '@/lib/agent/artifacts';
import { getSetting, setSetting } from '@/lib/db/history';
import { keyHeaders, loadKeys, loadVercel, saveVercel } from '@/lib/keys';
import { updateRunProgress } from '@/lib/shell/run-state';
import { endpointModels } from '@/lib/providers/endpoint-models';

/**
 * Workspace state.
 *
 * Deliberately one store: the to-do HUD, the terminal, the file manager and the
 * chat stream all read the same run, and splitting them into separate stores
 * produced tearing between panes during streaming.
 */

export interface ChatAttachment {
  id: string;
  name: string;
  kind: string;
  bytes: number;
  /** Inlined for images so vision models can consume them. */
  dataUrl?: string;
  /** Extracted text for code/documents. */
  text?: string;
}

/** A message sent while a run was already going. It waits its turn instead of being refused. */
export interface QueuedMessage {
  id: string;
  /** The session the user was in when they sent it (always set: a new chat is created on the spot). */
  sessionId: string;
  suite: SuiteId;
  input: string;
  attachments: ChatAttachment[];
  forceLane?: 'A' | 'B';
  at: number;
}

export interface ChatMessageView {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  reasoning?: string;
  lane?: 'A' | 'B';
  /** A terminal job (install, download, run) — its short follow-ups stay terminal jobs. */
  ops?: boolean;
  model?: string;
  provider?: ProviderId;
  createdAt: number;
  streaming?: boolean;
  error?: string;
  attachments?: ChatAttachment[];
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  durationMs?: number;
  /**
   * A file the run produced that the user can take away, built on demand from
   * the current workspace files rather than stored in the message — history
   * should not carry a second copy of every artifact.
   */
  offer?: {
    kind: 'minecraft-pack' | 'godot-project' | 'apk' | 'play';
    filename: string;
    label: string;
    /**
     * For an APK: the workspace file holding the bytes.
     *
     * A zip is rebuilt from the workspace when the button is pressed, so it is
     * never stored twice. An APK cannot be — it takes a native Godot export on
     * the bridge to make one — so the bytes are kept as a workspace file and
     * this points at it.
     */
    source?: string;
    /**
     * For a playable build: the key it is held under for this session.
     *
     * Not a workspace file. A WebAssembly build is forty-five megabytes and the
     * one artifact that is cheap to make again and expensive to keep, so it
     * lives in memory until the tab reloads.
     */
    playId?: string;
  };
}

export interface TerminalLine {
  id: string;
  stream: 'stdout' | 'stderr' | 'command' | 'system';
  text: string;
  at: number;
  execId?: string;
}

export interface ModelSelection {
  provider: ProviderId;
  model: string;
  endpointId?: string;
}

export interface RunInfo {
  /** The placeholder assistant message of the run, so coming back to the session mid-run can show it filling in. */
  assistantId: string | null;
  controller: AbortController;
  heavy: boolean;
}

export interface ThinkingState {
  active: boolean;
  phrase: string;
  since: number;
}

/** One of the parallel drafts offered for a prompt. */
export interface Draft {
  id: string;
  label: string;
  angle: string;
  content: string;
  reasoning: string;
  streaming: boolean;
  error?: string;
  model: string;
}

export interface DeployResult {
  url: string | null;
  inspectorUrl: string | null;
  readyState: string;
  project: string;
  error?: string;
  at: number;
  /** How many times this project has been shipped, first launch included. */
  releases?: number;
}

/**
 * A finished background run, announced briefly and then gone.
 *
 * Deliberately not a chat message and never written to history: the user asked
 * for a notice, not a permanent entry, and a transcript that accumulates "this
 * finished" rows is worse than one that does not. It lives in memory, expires
 * on its own, and carries just enough — the topic and the session — to get the
 * user back to the work with one action.
 */
export interface RunNotice {
  id: string;
  sessionId: string;
  suite: SuiteId;
  /** What the run was about, taken from the prompt that started it. */
  topic: string;
  status: 'done' | 'failed';
  detail?: string;
  /** Replaces "run finished" / "run failed" for notices that are not about a run. */
  title?: string;
  at: number;
}

/** How long a notice stays on screen before removing itself. */
export const NOTICE_TTL_MS = 15_000;

export type ThemePref = 'system' | 'light' | 'dark';

/**
 * Writes the choice onto <html> and mirrors it to localStorage.
 *
 * The mirror is not the source of truth — IndexedDB is — it exists only so the
 * boot script in layout.tsx can apply the theme synchronously before first
 * paint. 'system' removes the attribute entirely so the CSS media query takes
 * over again rather than being pinned to whatever was last chosen.
 */
function applyTheme(theme: ThemePref) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  // Colour transitions are enabled only for the duration of the switch, so the
  // whole app does not carry a transition on every background for all time.
  root.classList.add('theme-shifting');
  window.setTimeout(() => root.classList.remove('theme-shifting'), 300);

  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;

  try {
    if (theme === 'system') localStorage.removeItem('chomugiri:theme');
    else localStorage.setItem('chomugiri:theme', theme);
  } catch {
    // Private mode or blocked storage: the theme still applies for this session.
  }
}

interface WorkspaceState {
  // ── Navigation ────────────────────────────────────────────────────────────
  activeSuite: SuiteId;
  sessionId: string | null;
  sidebarOpen: boolean;
  rightPaneTab: 'preview' | 'site' | 'files' | 'terminal' | 'plan';

  setSuite: (suite: SuiteId) => void;
  setSessionId: (id: string | null) => void;
  toggleSidebar: () => void;
  setRightPaneTab: (tab: WorkspaceState['rightPaneTab']) => void;

  // ── Models ────────────────────────────────────────────────────────────────
  models: ModelDescriptor[];
  modelWarnings: string[];
  selection: ModelSelection;
  modelsLoading: boolean;

  loadModels: (force?: boolean) => Promise<void>;
  setSelection: (selection: ModelSelection) => void;

  // ── Custom endpoints ──────────────────────────────────────────────────────
  endpoints: EndpointRecord[];
  setEndpoints: (endpoints: EndpointRecord[]) => void;
  /** Capability-driven tabs instantiated from probed endpoints. */
  capabilityTabs: SuiteId[];
  /** Media tabs (image, video, audio, model3d) the user chose to hide even though a provider exists. */
  mediaHidden: SuiteId[];
  setMediaHidden: (id: SuiteId, hidden: boolean) => void;

  // ── Chat ──────────────────────────────────────────────────────────────────
  messages: ChatMessageView[];
  pushMessage: (message: ChatMessageView) => void;
  /** Puts a message just above another, for notes that belong before an answer already on screen. */
  insertMessageBefore: (beforeId: string, message: ChatMessageView) => void;
  patchMessage: (id: string, patch: Partial<ChatMessageView>) => void;
  clearMessages: () => void;

  // ── Thinking indicator ────────────────────────────────────────────────────
  /** What each running session is doing right now. Every session has its own, so two runs never share a bubble. */
  thinkingBy: Record<string, ThinkingState>;
  setThinking: (active: boolean, phrase: string | undefined, sessionId: string) => void;

  // ── Plan / HUD ────────────────────────────────────────────────────────────
  plan: Plan | null;
  setPlan: (plan: Plan | null) => void;
  updateTask: (id: string, patch: Partial<Task>) => void;
  setTaskStatus: (id: string, status: TaskStatus, detail?: string) => void;

  // ── Files ─────────────────────────────────────────────────────────────────
  files: Map<string, FileArtifact>;
  activeFile: string | null;
  setFiles: (files: Map<string, FileArtifact>) => void;
  upsertFile: (file: FileArtifact) => void;
  removeFile: (path: string) => void;
  setActiveFile: (path: string | null) => void;

  // ── Terminal ──────────────────────────────────────────────────────────────
  terminal: TerminalLine[];
  appendTerminal: (line: Omit<TerminalLine, 'id' | 'at'> & { at?: number }) => void;
  clearTerminal: () => void;
  runningExecId: string | null;
  /** The command behind runningExecId, so the chat can light up the very block that is running. */
  runningCommand: string | null;
  setRunningExecId: (id: string | null, command?: string) => void;

  // ── Bridge ────────────────────────────────────────────────────────────────
  bridge: BridgeClient;
  heartbeat: HeartbeatState;
  monitor: HeartbeatMonitor | null;
  configureBridge: (config: { url: string; token: string; via?: 'direct' | 'proxy' }) => void;
  startHeartbeat: () => void;
  stopHeartbeat: () => void;

  // ── Anti-loop ─────────────────────────────────────────────────────────────
  guard: AntiLoopGuard;
  fingerprints: Fingerprint[];
  refreshFingerprints: () => void;
  resetGuard: () => void;

  // ── Deployment ────────────────────────────────────────────────────────────
  vercelToken: string;
  vercelTeamId: string;
  setVercelCredentials: (token: string, teamId?: string) => void;
  lastDeploy: DeployResult | null;
  setLastDeploy: (result: DeployResult | null) => void;

  // ── Run notices ───────────────────────────────────────────────────────────
  notices: RunNotice[];
  pushNotice: (notice: Omit<RunNotice, 'id' | 'at'>) => void;
  dismissNotice: (id: string) => void;
  clearNotices: () => void;

  // ── Drafts ────────────────────────────────────────────────────────────────
  drafts: Draft[] | null;
  setDrafts: (drafts: Draft[] | null) => void;
  patchDraft: (id: string, patch: Partial<Draft>) => void;
  draftsEnabled: boolean;
  /** Which image model paints generated textures and assets. */
  imageModel: string;
  setImageModel: (model: string) => void;
  /** 'system' follows the OS; the other two are an explicit override. */
  theme: ThemePref;
  setTheme: (theme: ThemePref) => void;
  setDraftsEnabled: (enabled: boolean) => void;

  // ── Run control ───────────────────────────────────────────────────────────
  /**
   * Every run in flight, by session. Sessions run side by side: "running" is a fact about one session,
   * and every session without an entry here is idle and must look it.
   */
  runs: Record<string, RunInfo>;
  /** Registers a run. Only one run at a time owns the shared plan/files/terminal slot (`heavy`); see runtime.ts. */
  beginRun: (sessionId: string, info: { controller: AbortController; heavy: boolean }) => void;
  patchRun: (sessionId: string, patch: Partial<Pick<RunInfo, 'assistantId'>>) => void;
  endRun: (sessionId: string) => void;
  /** The session whose run owns the shared plan/files/terminal slot right now (a build, or drafts). null = nobody. */
  runSessionId: string | null;
  /** Whose plan and files are in the shared live slot. Stays set after the run ends, so a follow-up in that session finds its work. */
  slotSessionId: string | null;
  setSlotOwner: (id: string | null) => void;
  queue: QueuedMessage[];
  enqueue: (item: QueuedMessage) => void;
  /** Takes the first queued message that `canStart` accepts, leaving the rest in order. */
  takeQueued: (canStart: (item: QueuedMessage) => boolean) => QueuedMessage | undefined;
  removeQueued: (id: string) => void;
  cancelRun: () => void;

  hydrate: () => Promise<void>;
}

/** True while this very session has a run going (other sessions may be running too). */
export const isRunningHere = (s: Pick<WorkspaceState, 'runs' | 'sessionId'>) => s.sessionId !== null && s.runs[s.sessionId] !== undefined;

const NO_FILES = new Map<string, FileArtifact>();
/**
 * The plan and files are one live slot shared by the whole app, written by whichever run is going.
 * While a run belongs to a different session they are not this session's, so they are not shown.
 */
export const visiblePlan = (s: WorkspaceState) => (s.slotSessionId && s.slotSessionId !== s.sessionId ? null : s.plan);
export const visibleFiles = (s: WorkspaceState) => (s.slotSessionId && s.slotSessionId !== s.sessionId ? NO_FILES : s.files);

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const DEFAULT_SELECTION: ModelSelection = {
  provider: 'nim',
  model: DEFAULT_NIM_MODEL,
};

/** Capability → dedicated workspace tab. */
const CAPABILITY_SUITES: Record<string, SuiteId> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  model3d: 'model3d',
};

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  activeSuite: 'chat',
  sessionId: null,
  sidebarOpen: true,
  rightPaneTab: 'preview',

  setSuite: (suite) => set({ activeSuite: suite }),
  setSessionId: (id) => set({ sessionId: id }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setRightPaneTab: (tab) => set({ rightPaneTab: tab }),

  models: [],
  modelWarnings: [],
  selection: DEFAULT_SELECTION,
  modelsLoading: false,

  loadModels: async (force = false) => {
    set({ modelsLoading: true });
    try {
      const res = await fetch(`/api/models${force ? '?refresh=1' : ''}`, {
        // Without the user's key the catalogue comes back with no NIM models at
        // all, so this has to carry it like every other provider call.
        headers: keyHeaders(),
        cache: force ? 'no-store' : 'default',
        // No timeout at all meant a stalled models endpoint blocked app boot
        // itself (this also runs from hydrate()), not just a refresh button.
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`models endpoint returned ${res.status}`);

      const data = (await res.json()) as { models: ModelDescriptor[]; warnings: string[] };
      const models = data.models ?? [];

      // The catalogue is server-side and knows nothing about custom endpoints,
      // which live on the device — so they are added back on every reload.
      const withCustom = [...models, ...endpointModels(get().endpoints)];
      set({ models: withCustom, modelWarnings: data.warnings ?? [] });

      // If the persisted selection no longer exists, fall back to something real
      // rather than letting every request 404.
      const current = get().selection;
      const stillValid = withCustom.some((m) => m.provider === current.provider && m.id === current.model);
      if (!stillValid && withCustom.length) {
        const selectable = withCustom.filter((m) => m.origin !== 'partner-only');
        // Without a key there are no NIM models at all, so a NIM-first fallback
        // would leave a fresh install pointed at something that cannot answer.
        const hasNim = selectable.some((m) => m.provider === 'nim');
        const preferred =
          (hasNim ? selectable.find((m) => m.id === DEFAULT_NIM_MODEL) : undefined) ??
          (hasNim ? selectable.find((m) => m.capabilities.includes('reasoning') && m.provider === 'nim') : undefined) ??
          selectable.find((m) => m.capabilities.includes('chat')) ??
          selectable[0];
        if (!preferred) return;
        set({ selection: { provider: preferred.provider, model: preferred.id } });
        void setSetting('selection', { provider: preferred.provider, model: preferred.id });
      }
    } catch (err) {
      set({ modelWarnings: [`Could not load the model catalogue: ${(err as Error).message}`] });
    } finally {
      set({ modelsLoading: false });
    }
  },

  setSelection: (selection) => {
    set({ selection });
    void setSetting('selection', selection);
  },

  endpoints: [],
  capabilityTabs: [],
  mediaHidden: [],
  setMediaHidden: (id, hidden) => {
    const next = hidden ? [...new Set([...get().mediaHidden, id])] : get().mediaHidden.filter((x) => x !== id);
    set({ mediaHidden: next });
    void setSetting('mediaHidden', next);
  },
  setEndpoints: (endpoints) => {
    const tabs = new Set<SuiteId>();
    for (const endpoint of endpoints) {
      if (!endpoint.enabled) continue;
      for (const capability of endpoint.capabilities) {
        const suite = CAPABILITY_SUITES[capability];
        if (suite) tabs.add(suite);
      }
    }
    set((prev) => ({
      endpoints,
      capabilityTabs: [...tabs],
      // Merged in here as well as in loadModels, so adding an endpoint puts its
      // models in the switcher immediately rather than after the next refresh.
      models: [...prev.models.filter((m) => m.provider !== 'custom'), ...endpointModels(endpoints)],
    }));
  },

  messages: [],
  pushMessage: (message) => set((s) => ({ messages: [...s.messages, message] })),
  insertMessageBefore: (beforeId, message) =>
    set((s) => {
      const at = s.messages.findIndex((m) => m.id === beforeId);
      if (at < 0) return { messages: [...s.messages, message] };
      return { messages: [...s.messages.slice(0, at), message, ...s.messages.slice(at)] };
    }),
  patchMessage: (id, patch) =>
    set((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),
  clearMessages: () => set({ messages: [] }),

  thinkingBy: {},
  setThinking: (active, phrase, sessionId) =>
    set((s) => {
      const before = s.thinkingBy[sessionId];
      // Every narrated step goes through here, so this is the one place that
      // can keep the background notification in step with the transcript
      // without every call site in runtime.ts having to remember to say so.
      // A browser tab has no shell to tell; updateRunProgress is a no-op there.
      if (active && phrase && phrase !== before?.phrase) {
        void updateRunProgress(phrase);
      }
      const thinkingBy = { ...s.thinkingBy };
      if (active) thinkingBy[sessionId] = { active: true, phrase: phrase ?? before?.phrase ?? '', since: before?.active ? before.since : Date.now() };
      else delete thinkingBy[sessionId];
      return { thinkingBy };
    }),

  plan: null,
  setPlan: (plan) => set({ plan }),
  updateTask: (id, patch) =>
    set((s) =>
      s.plan
        ? { plan: { ...s.plan, tasks: s.plan.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) } }
        : {},
    ),
  setTaskStatus: (id, status, detail) =>
    set((s) => {
      if (!s.plan) return {};
      const now = Date.now();
      return {
        plan: {
          ...s.plan,
          tasks: s.plan.tasks.map((t) =>
            t.id === id
              ? {
                  ...t,
                  status,
                  detail: detail ?? t.detail,
                  startedAt: status === 'in_progress' ? now : t.startedAt,
                  endedAt: status === 'completed' || status === 'failed' ? now : t.endedAt,
                }
              : t,
          ),
        },
      };
    }),

  files: new Map(),
  activeFile: null,
  setFiles: (files) => set({ files }),
  upsertFile: (file) =>
    set((s) => {
      const next = new Map(s.files);
      next.set(file.path, file);
      return { files: next, activeFile: s.activeFile ?? file.path };
    }),
  removeFile: (path) =>
    set((s) => {
      const next = new Map(s.files);
      next.delete(path);
      return { files: next, activeFile: s.activeFile === path ? null : s.activeFile };
    }),
  setActiveFile: (path) => set({ activeFile: path }),

  terminal: [],
  appendTerminal: (line) =>
    set((s) => {
      const next = [...s.terminal, { id: uid(), at: line.at ?? Date.now(), ...line }];
      // Cap the buffer; an unbounded terminal pane will eventually stall the tab.
      return { terminal: next.length > 4000 ? next.slice(-3000) : next };
    }),
  clearTerminal: () => set({ terminal: [] }),
  runningExecId: null,
  runningCommand: null,
  setRunningExecId: (id, command) => set({ runningExecId: id, runningCommand: id ? (command ?? null) : null }),

  bridge: new BridgeClient({
    url: process.env.NEXT_PUBLIC_DEFAULT_BRIDGE_URL ?? '',
    token: process.env.NEXT_PUBLIC_DEFAULT_BRIDGE_TOKEN ?? '',
    via: 'direct',
  }),
  heartbeat: INITIAL_HEARTBEAT,
  monitor: null,

  configureBridge: (config) => {
    const { bridge, monitor } = get();
    bridge.update(config);
    void setSetting('bridge', config);
    set({ heartbeat: { ...INITIAL_HEARTBEAT, status: 'connecting' } });
    void monitor?.ping();
  },

  startHeartbeat: () => {
    const existing = get().monitor;
    if (existing) {
      existing.start();
      return;
    }
    const monitor = new HeartbeatMonitor(get().bridge, (heartbeat) => set({ heartbeat }));
    set({ monitor });
    monitor.start();
  },

  stopHeartbeat: () => get().monitor?.stop(),

  guard: new AntiLoopGuard(),
  fingerprints: [],
  refreshFingerprints: () => set({ fingerprints: get().guard.entries() }),
  resetGuard: () => {
    get().guard.reset();
    set({ fingerprints: [] });
  },

  vercelToken: '',
  vercelTeamId: '',
  setVercelCredentials: (token, teamId = '') => {
    set({ vercelToken: token, vercelTeamId: teamId });
    // Written through the shell in the APK, where IndexedDB does not outlive a
    // change of origin.
    void saveVercel(token, teamId);
  },
  lastDeploy: null,
  setLastDeploy: (result) => {
    set({ lastDeploy: result });
    // Persisted, so the app still knows which project it owns after a reload.
    // Without this every visit looked like a first launch, and "update the site
    // I already made" was impossible — it would have created a second project.
    void setSetting('deploy', result);
  },

  notices: [],
  pushNotice: (notice) => {
    const id = `notice_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    // Capped, so a long unattended session cannot stack notices off-screen.
    set((s) => ({ notices: [...s.notices, { ...notice, id, at: Date.now() }].slice(-4) }));
    if (typeof window !== 'undefined') {
      window.setTimeout(() => get().dismissNotice(id), NOTICE_TTL_MS);
    }
  },
  dismissNotice: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
  clearNotices: () => set({ notices: [] }),

  drafts: null,
  setDrafts: (drafts) => set({ drafts }),
  patchDraft: (id, patch) =>
    set((s) => ({ drafts: s.drafts?.map((d) => (d.id === id ? { ...d, ...patch } : d)) ?? null })),
  draftsEnabled: false,

  imageModel: 'nim:black-forest-labs/flux.1-dev',
  setImageModel: (model) => {
    set({ imageModel: model });
    void setSetting('imageModel', model);
  },


  theme: 'system',
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
    void setSetting('theme', theme);
  },

  setDraftsEnabled: (enabled) => {
    set({ draftsEnabled: enabled });
    void setSetting('draftsEnabled', enabled);
  },

  runs: {},
  runSessionId: null,
  slotSessionId: null,
  setSlotOwner: (id) => set({ slotSessionId: id }),
  beginRun: (sessionId, { controller, heavy }) =>
    set((s) => {
      // The slot goes to whoever starts while nobody else holds it; a build holds it until it ends.
      const free = s.runSessionId === null || s.runSessionId === sessionId;
      return {
        runs: { ...s.runs, [sessionId]: { assistantId: null, controller, heavy } },
        runSessionId: heavy && free ? sessionId : s.runSessionId,
        slotSessionId: free ? sessionId : s.slotSessionId,
      };
    }),
  patchRun: (sessionId, patch) =>
    set((s) => (s.runs[sessionId] ? { runs: { ...s.runs, [sessionId]: { ...s.runs[sessionId], ...patch } } } : {})),
  endRun: (sessionId) =>
    set((s) => {
      const runs = { ...s.runs };
      delete runs[sessionId];
      const thinkingBy = { ...s.thinkingBy };
      delete thinkingBy[sessionId];
      return { runs, thinkingBy, runSessionId: s.runSessionId === sessionId ? null : s.runSessionId };
    }),
  queue: [],
  enqueue: (item) => set((s) => ({ queue: [...s.queue, item] })),
  takeQueued: (canStart) => {
    const queue = get().queue;
    // A message may not jump ahead of an earlier one from its own session, even when the earlier one is stuck waiting.
    const blocked = new Set<string>();
    for (const item of queue) {
      if (!blocked.has(item.sessionId) && canStart(item)) {
        set({ queue: queue.filter((q) => q.id !== item.id) });
        return item;
      }
      blocked.add(item.sessionId);
    }
    return undefined;
  },
  removeQueued: (id) => set((s) => ({ queue: s.queue.filter((q) => q.id !== id) })),
  /** Stops the run of the session being looked at. Other sessions keep going. */
  cancelRun: () => {
    const { sessionId, runs, runSessionId, runningExecId, bridge } = get();
    if (!sessionId) return;
    runs[sessionId]?.controller.abort();
    const ownsSlot = runSessionId === sessionId;
    if (ownsSlot && runningExecId) void bridge.kill(runningExecId).catch(() => undefined);
    if (ownsSlot) {
      set({ runningExecId: null, runningCommand: null });
      // Any draft still streaming is dead the moment the controller aborts; leaving
      // them marked `streaming` would spin their placeholders forever.
      set((s) => ({ drafts: s.drafts?.map((d) => (d.streaming ? { ...d, streaming: false } : d)) ?? null }));
    }
    get().setThinking(false, undefined, sessionId);
  },

  hydrate: async () => {
    // Before anything else: the catalogue load below needs the key in hand.
    await loadKeys();

    const [selection, bridgeConfig, vercel] = await Promise.all([
      getSetting<ModelSelection | null>('selection', null),
      getSetting<{ url: string; token: string; via?: 'direct' | 'proxy' } | null>('bridge', null),
      getSetting<{ token: string; teamId: string } | null>('vercel', null),
    ]);

    if (selection) set({ selection });
    if (bridgeConfig?.url) get().bridge.update(bridgeConfig);
    // Prefers the native store in the APK, falling back to IndexedDB.
    const vercelCreds = await loadVercel();
    if (vercelCreds.token) set({ vercelToken: vercelCreds.token, vercelTeamId: vercelCreds.teamId });
    else if (vercel?.token) set({ vercelToken: vercel.token, vercelTeamId: vercel.teamId ?? '' });

    // Restore which site this workspace has already shipped, so the deploy
    // control can offer to update it rather than launch a second one.
    const priorDeploy = await getSetting<DeployResult | null>('deploy', null);
    if (priorDeploy?.project) set({ lastDeploy: priorDeploy });
    set({ draftsEnabled: await getSetting<boolean>('draftsEnabled', false) });
    set({ mediaHidden: await getSetting<SuiteId[]>('mediaHidden', []) });
    set({ imageModel: await getSetting<string>('imageModel', 'nim:black-forest-labs/flux.1-dev') });

    // The boot script already painted the stored theme; this re-syncs the store
    // with it and covers the case where the localStorage mirror was cleared.
    const theme = await getSetting<ThemePref>('theme', 'system');
    set({ theme });
    applyTheme(theme);

    get().startHeartbeat();
    await get().loadModels();
  },
}));
