import Dexie, { type Table } from 'dexie';

/**
 * Local persistence.
 *
 * Every suite gets its own logically independent, searchable history. They share
 * one IndexedDB database but are partitioned by `suite`, with compound indexes so
 * a per-suite query never scans another suite's rows.
 *
 * Nothing here leaves the browser. Bridge tokens and provider keys live in a
 * separate table that is never included in exports.
 */

export type SuiteId =
  | 'chat'
  | 'android'
  | 'minecraft'
  | 'studio'
  | 'mcp'
  | 'workdrive'
  | 'skills'
  | 'terminal'
  | 'image'
  | 'video'
  | 'audio'
  | 'model3d'
  | 'assets';

export interface SessionRecord {
  id: string;
  suite: SuiteId;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Free-text index built from the title + message content for search. */
  searchText: string;
  model?: string;
  provider?: string;
  lane?: 'A' | 'B';
  pinned?: 0 | 1;
  archived?: 0 | 1;
  tags?: string[];
  messageCount: number;
  /** Suite-specific summary shown in the history list. */
  summary?: string;
}

export interface MessageRecord {
  id: string;
  sessionId: string;
  suite: SuiteId;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  reasoning?: string;
  createdAt: number;
  model?: string;
  provider?: string;
  lane?: 'A' | 'B';
  /** Serialised plan snapshot at the time of the message. */
  plan?: unknown;
  attachments?: Array<{ name: string; kind: string; bytes: number; dataUrl?: string; text?: string }>;
  error?: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  durationMs?: number;
}

export interface ArtifactRecord {
  id: string;
  sessionId: string;
  suite: SuiteId;
  path: string;
  language: string;
  content: string;
  bytes: number;
  createdAt: number;
  updatedAt: number;
  /** Set once the file has been pushed to the bridge workspace. */
  syncedToBridge?: 0 | 1;
}

export interface RunRecord {
  id: string;
  sessionId: string;
  suite: SuiteId;
  execId?: string;
  command: string;
  cwd?: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  /** Anti-loop fingerprint of the failure, when it failed. */
  fingerprint?: string;
}

export interface AssetRecord {
  id: string;
  sessionId?: string;
  suite: SuiteId;
  kind: 'image' | 'video' | 'audio' | 'model3d' | 'binary';
  prompt?: string;
  provider: string;
  model: string;
  dataUrl?: string;
  url?: string;
  bytes?: number;
  meta?: Record<string, unknown>;
  createdAt: number;
}

export interface SkillRecord {
  id: string;
  /** Slash trigger without the leading `/`. */
  command: string;
  name: string;
  description: string;
  /** Prompt template; `{{input}}` and `{{files}}` are substituted. */
  template: string;
  suite?: SuiteId;
  kind: 'builtin' | 'custom' | 'generated';
  lane?: 'A' | 'B';
  model?: string;
  provider?: string;
  createdAt: number;
  updatedAt: number;
  usageCount: number;
  enabled: 0 | 1;
  icon?: string;
}

export interface EndpointRecord {
  id: string;
  label: string;
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  chatPath?: string;
  capabilities: string[];
  models: Array<{ id: string; label: string; capabilities: string[] }>;
  routes: string[];
  lastProbedAt?: number;
  probeOk?: 0 | 1;
  probeError?: string;
  enabled: 0 | 1;
  createdAt: number;
}

export interface ResearchRunRecord {
  id: string;
  sessionId: string;
  topic: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
  updatedAt: number;
  dueAt?: number;
  milestones: Array<{ id: string; title: string; dueAt?: number; done: 0 | 1 }>;
  sources: Array<{ url: string; title: string; score?: number; excerpt?: string }>;
  document?: string;
  error?: string;
  notified?: 0 | 1;
}

/**
 * Deployment environment variables.
 *
 * Kept in its own table, never touched by `exportSuite`, so a shared history
 * export cannot carry credentials out with it.
 */
export interface VaultRecord {
  id: string;
  name: string;
  value: string;
  scope: 'build' | 'runtime' | 'both';
  targets: Array<'production' | 'preview' | 'development'>;
  note?: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
}

export interface SettingRecord {
  key: string;
  value: unknown;
  updatedAt: number;
}

export class ChomugiriDB extends Dexie {
  sessions!: Table<SessionRecord, string>;
  messages!: Table<MessageRecord, string>;
  artifacts!: Table<ArtifactRecord, string>;
  runs!: Table<RunRecord, string>;
  assets!: Table<AssetRecord, string>;
  skills!: Table<SkillRecord, string>;
  endpoints!: Table<EndpointRecord, string>;
  research!: Table<ResearchRunRecord, string>;
  settings!: Table<SettingRecord, string>;
  vault!: Table<VaultRecord, string>;

  constructor() {
    super('chomugiri');

    this.version(1).stores({
      // Compound `[suite+updatedAt]` keeps per-suite history lists O(log n).
      sessions: 'id, suite, updatedAt, createdAt, pinned, archived, [suite+updatedAt], [suite+archived], *tags',
      messages: 'id, sessionId, suite, createdAt, [sessionId+createdAt], [suite+createdAt]',
      artifacts: 'id, sessionId, suite, path, updatedAt, [sessionId+path], [suite+updatedAt]',
      runs: 'id, sessionId, suite, startedAt, exitCode, [sessionId+startedAt], [suite+startedAt]',
      assets: 'id, sessionId, suite, kind, createdAt, [suite+createdAt], [kind+createdAt]',
      skills: 'id, command, kind, suite, enabled, updatedAt, usageCount',
      endpoints: 'id, label, enabled, createdAt',
      research: 'id, sessionId, status, createdAt, dueAt, updatedAt',
      settings: 'key',
    });

    // Secrets vault. A new store rather than a settings row so it can be wiped
    // independently and never joins a history export.
    this.version(2).stores({
      vault: 'id, name, updatedAt',
    });
  }
}

let instance: ChomugiriDB | null = null;

/** Lazily created so the module stays importable during SSR. */
export function db(): ChomugiriDB {
  if (typeof window === 'undefined') {
    throw new Error('ChomugiriDB is browser-only. Guard the call with `typeof window !== "undefined"`.');
  }
  instance ??= new ChomugiriDB();
  return instance;
}

export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined';
}

export const SUITE_LABELS: Record<SuiteId, string> = {
  chat: 'Chat',
  assets: 'Asset Studio',
  android: 'Android & Cross-Platform',
  minecraft: 'Minecraft Engineering',
  studio: 'Presentations & Canvas',
  mcp: 'MCP Builder',
  workdrive: 'Workdrive Research',
  skills: 'Skills & Commands',
  terminal: 'Terminal',
  image: 'Image Suite',
  video: 'Video Suite',
  audio: 'Audio Suite',
  model3d: '3D Suite',
};
