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

export interface ChatMessageView {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  reasoning?: string;
  lane?: 'A' | 'B';
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

  // ── Chat ──────────────────────────────────────────────────────────────────
  messages: ChatMessageView[];
  pushMessage: (message: ChatMessageView) => void;
  patchMessage: (id: string, patch: Partial<ChatMessageView>) => void;
  clearMessages: () => void;

  // ── Thinking indicator ────────────────────────────────────────────────────
  thinking: ThinkingState;
  setThinking: (active: boolean, phrase?: string) => void;

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
  setRunningExecId: (id: string | null) => void;

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
  abortController: AbortController | null;
  setAbortController: (controller: AbortController | null) => void;
  cancelRun: () => void;

  hydrate: () => Promise<void>;
}

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
  patchMessage: (id, patch) =>
    set((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),
  clearMessages: () => set({ messages: [] }),

  thinking: { active: false, phrase: '', since: 0 },
  setThinking: (active, phrase) =>
    set((s) => {
      // Every narrated step goes through here, so this is the one place that
      // can keep the background notification in step with the transcript
      // without every call site in runtime.ts having to remember to say so.
      // A browser tab has no shell to tell; updateRunProgress is a no-op there.
      if (active && phrase && phrase !== s.thinking.phrase) {
        void updateRunProgress(phrase);
      }
      return {
        thinking: active
          ? { active: true, phrase: phrase ?? s.thinking.phrase, since: s.thinking.active ? s.thinking.since : Date.now() }
          : { active: false, phrase: '', since: 0 },
      };
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
  setRunningExecId: (id) => set({ runningExecId: id }),

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

  abortController: null,
  setAbortController: (controller) => set({ abortController: controller }),
  cancelRun: () => {
    const { abortController, runningExecId, bridge } = get();
    abortController?.abort();
    if (runningExecId) void bridge.kill(runningExecId).catch(() => undefined);
    set({ abortController: null, runningExecId: null });
    // Any draft still streaming is dead the moment the controller aborts; leaving
    // them marked `streaming` would spin their placeholders forever.
    set((s) => ({ drafts: s.drafts?.map((d) => (d.streaming ? { ...d, streaming: false } : d)) ?? null }));
    get().setThinking(false);
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

/** Cyclical status phrases for the thinking bubble. */
export const THINKING_PHRASES = [
  'Analyzing architecture...',
  'Verifying terminal heartbeat...',
  'Synthesizing logic...',
  'Auditing code graph...',
  'Resolving dependency graph...',
  'Fingerprinting failure modes...',
  'Mapping execution lanes...',
  'Validating output schema...',
  'Reading between your lines...',
  'Checking what could go wrong first...',
  'Sketching the shape of an answer...',
  'Weighing two approaches...',
  'Discarding the clever one...',
  'Looking for the boring, correct path...',
  'Tracing the edge cases...',
  'Asking whether this is really the question...',
  'Counting the moving parts...',
  'Pinning down the exact requirement...',
  'Rehearsing the failure first...',
  'Reaching for the smallest thing that works...',
  'Separating what matters from what is loud...',
  'Testing the premise before the code...',
  'Following the data, not the guess...',
  'Naming the thing properly...',
  'Cutting the scope to what was asked...',
  'Checking the assumption nobody stated...',
  'Working out what you already know...',
  'Deciding what not to build...',
  'Finding where this has broken before...',
  'Preferring evidence over confidence...',
]

export const LANE_B_PHRASES = [
  'Decomposing into atomic steps...',
  'Checking toolchain availability...',
  'Emitting project files...',
  'Compiling artifacts...',
  'Packaging outputs...',
  'Laying out the file tree...',
  'Writing the manifest first...',
  'Wiring the pieces together...',
  'Making the first version run...',
  'Removing what was not needed...',
  'Checking the build would survive a rerun...',
  'Naming files the way you would...',
  'Leaving nothing half-written...',
  'Closing the loop on every step...',
]

/**
 * The phrases for one run, in an order that is not last run's order.
 *
 * The bubble used to walk the same list from the top every time, so the first
 * three phrases were the same three forever and the app felt like it was
 * replaying a recording. Shuffled per run, and the pool is large enough that
 * two runs rarely open the same way.
 */
export function phrasesForRun(lane: 'A' | 'B'): string[] {
  const pool = lane === 'B' ? [...LANE_B_PHRASES, ...THINKING_PHRASES] : [...THINKING_PHRASES];

  // Fisher-Yates: every order equally likely, which a sort-by-random is not.
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}
