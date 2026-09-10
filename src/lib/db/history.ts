import {
  db,
  isBrowser,
  type ArtifactRecord,
  type AssetRecord,
  type MessageRecord,
  type ResearchRunRecord,
  type RunRecord,
  type SessionRecord,
  type SuiteId,
} from './schema';

/**
 * History repository — one API per suite, each partition fully independent.
 * All writes are best-effort: a storage failure degrades the workspace to
 * in-memory operation instead of taking the run down with it.
 */

export function uid(prefix = 'id'): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

function guard<T>(fallback: T): T | undefined {
  return isBrowser() ? undefined : fallback;
}

// ── Sessions ────────────────────────────────────────────────────────────────

export async function createSession(suite: SuiteId, title: string, extra: Partial<SessionRecord> = {}): Promise<SessionRecord> {
  const now = Date.now();
  const record: SessionRecord = {
    id: uid('ses'),
    suite,
    title: title.slice(0, 160) || 'Untitled',
    createdAt: now,
    updatedAt: now,
    searchText: title.toLowerCase(),
    messageCount: 0,
    pinned: 0,
    archived: 0,
    ...extra,
  };
  if (isBrowser()) await db().sessions.put(record).catch(() => undefined);
  return record;
}

export async function touchSession(id: string, patch: Partial<SessionRecord> = {}): Promise<void> {
  if (!isBrowser()) return;
  await db().sessions.update(id, { ...patch, updatedAt: Date.now() }).catch(() => undefined);
}

export async function listSessions(
  suite: SuiteId,
  opts: { limit?: number; includeArchived?: boolean } = {},
): Promise<SessionRecord[]> {
  if (!isBrowser()) return [];
  const rows = await db()
    .sessions.where('[suite+updatedAt]')
    .between([suite, 0], [suite, Infinity])
    .reverse()
    .limit(opts.limit ?? 200)
    .toArray()
    .catch(() => [] as SessionRecord[]);

  const filtered = opts.includeArchived ? rows : rows.filter((r) => !r.archived);
  // Pinned float to the top; the index already ordered the rest by recency.
  return filtered.sort((a, b) => (b.pinned ?? 0) - (a.pinned ?? 0));
}

/**
 * Full-text search across a suite's sessions and message bodies.
 * IndexedDB has no text index, so this scans the suite partition — bounded by
 * `limit` and fast enough for the tens of thousands of rows a local workspace
 * realistically accumulates.
 */
export async function searchSessions(suite: SuiteId, query: string, limit = 50): Promise<SessionRecord[]> {
  if (!isBrowser()) return [];
  const q = query.trim().toLowerCase();
  if (!q) return listSessions(suite, { limit });

  const terms = q.split(/\s+/).filter(Boolean);
  const sessions = await listSessions(suite, { limit: 1000, includeArchived: true });

  const direct = sessions.filter((s) => terms.every((t) => s.searchText.includes(t)));
  if (direct.length >= limit) return direct.slice(0, limit);

  // Widen into message bodies for the remainder.
  const seen = new Set(direct.map((s) => s.id));
  const messages = await db()
    .messages.where('[suite+createdAt]')
    .between([suite, 0], [suite, Infinity])
    .reverse()
    .limit(5000)
    .toArray()
    .catch(() => [] as MessageRecord[]);

  const extraIds = new Set<string>();
  for (const m of messages) {
    if (seen.has(m.sessionId) || extraIds.has(m.sessionId)) continue;
    const body = m.content.toLowerCase();
    if (terms.every((t) => body.includes(t))) extraIds.add(m.sessionId);
    if (direct.length + extraIds.size >= limit) break;
  }

  const byId = new Map(sessions.map((s) => [s.id, s]));
  const extra = [...extraIds].map((id) => byId.get(id)).filter((s): s is SessionRecord => Boolean(s));
  return [...direct, ...extra].slice(0, limit);
}

export async function getSession(id: string): Promise<SessionRecord | undefined> {
  if (!isBrowser()) return undefined;
  return db().sessions.get(id).catch(() => undefined);
}

/** Removes the session and every row that belongs to it. */
export async function deleteSession(id: string): Promise<void> {
  if (!isBrowser()) return;
  const d = db();
  await d.transaction('rw', [d.sessions, d.messages, d.artifacts, d.runs, d.assets, d.research], async () => {
    await d.sessions.delete(id);
    await d.messages.where('sessionId').equals(id).delete();
    await d.artifacts.where('sessionId').equals(id).delete();
    await d.runs.where('sessionId').equals(id).delete();
    await d.assets.where('sessionId').equals(id).delete();
    await d.research.where('sessionId').equals(id).delete();
  }).catch(() => undefined);
}

export async function clearSuite(suite: SuiteId): Promise<number> {
  if (!isBrowser()) return 0;
  const sessions = await listSessions(suite, { limit: 100000, includeArchived: true });
  for (const s of sessions) await deleteSession(s.id);
  return sessions.length;
}

// ── Messages ────────────────────────────────────────────────────────────────

export async function appendMessage(message: Omit<MessageRecord, 'id'> & { id?: string }): Promise<MessageRecord> {
  const record: MessageRecord = { id: message.id ?? uid('msg'), ...message };
  if (!isBrowser()) return record;

  const d = db();
  await d.messages.put(record).catch(() => undefined);

  const session = await d.sessions.get(record.sessionId).catch(() => undefined);
  if (session) {
    const snippet = record.content.slice(0, 4000).toLowerCase();
    await d.sessions
      .update(record.sessionId, {
        updatedAt: Date.now(),
        messageCount: (session.messageCount ?? 0) + 1,
        searchText: `${session.searchText} ${snippet}`.slice(-20000),
        summary: record.role === 'assistant' ? record.content.replace(/\s+/g, ' ').slice(0, 200) : session.summary,
      })
      .catch(() => undefined);
  }
  return record;
}

export async function updateMessage(id: string, patch: Partial<MessageRecord>): Promise<void> {
  if (!isBrowser()) return;
  await db().messages.update(id, patch).catch(() => undefined);
}

export async function listMessages(sessionId: string): Promise<MessageRecord[]> {
  if (!isBrowser()) return [];
  return db()
    .messages.where('[sessionId+createdAt]')
    .between([sessionId, 0], [sessionId, Infinity])
    .toArray()
    .catch(() => [] as MessageRecord[]);
}

// ── Artifacts ───────────────────────────────────────────────────────────────

export async function upsertArtifact(
  artifact: Omit<ArtifactRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
): Promise<ArtifactRecord> {
  const now = Date.now();
  if (!isBrowser()) return { id: artifact.id ?? uid('art'), createdAt: now, updatedAt: now, ...artifact };

  const d = db();
  const existing = await d.artifacts
    .where('[sessionId+path]')
    .equals([artifact.sessionId, artifact.path])
    .first()
    .catch(() => undefined);

  const record: ArtifactRecord = {
    id: existing?.id ?? artifact.id ?? uid('art'),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...artifact,
  };
  await d.artifacts.put(record).catch(() => undefined);
  return record;
}

export async function listArtifacts(sessionId: string): Promise<ArtifactRecord[]> {
  if (!isBrowser()) return [];
  return db().artifacts.where('sessionId').equals(sessionId).toArray().catch(() => []);
}

export async function listSuiteArtifacts(suite: SuiteId, limit = 500): Promise<ArtifactRecord[]> {
  if (!isBrowser()) return [];
  return db()
    .artifacts.where('[suite+updatedAt]')
    .between([suite, 0], [suite, Infinity])
    .reverse()
    .limit(limit)
    .toArray()
    .catch(() => []);
}

export async function deleteArtifact(id: string): Promise<void> {
  if (!isBrowser()) return;
  await db().artifacts.delete(id).catch(() => undefined);
}

// ── Runs ────────────────────────────────────────────────────────────────────

export async function recordRun(run: Omit<RunRecord, 'id'> & { id?: string }): Promise<RunRecord> {
  const record: RunRecord = { id: run.id ?? uid('run'), ...run };
  if (isBrowser()) await db().runs.put(record).catch(() => undefined);
  return record;
}

export async function updateRun(id: string, patch: Partial<RunRecord>): Promise<void> {
  if (!isBrowser()) return;
  await db().runs.update(id, patch).catch(() => undefined);
}

export async function listRuns(suite: SuiteId, limit = 200): Promise<RunRecord[]> {
  if (!isBrowser()) return [];
  return db()
    .runs.where('[suite+startedAt]')
    .between([suite, 0], [suite, Infinity])
    .reverse()
    .limit(limit)
    .toArray()
    .catch(() => []);
}

// ── Assets ──────────────────────────────────────────────────────────────────

export async function saveAsset(asset: Omit<AssetRecord, 'id' | 'createdAt'> & { id?: string }): Promise<AssetRecord> {
  const record: AssetRecord = { id: asset.id ?? uid('ast'), createdAt: Date.now(), ...asset };
  if (isBrowser()) await db().assets.put(record).catch(() => undefined);
  return record;
}

export async function listAssets(suite: SuiteId, limit = 300): Promise<AssetRecord[]> {
  if (!isBrowser()) return [];
  return db()
    .assets.where('[suite+createdAt]')
    .between([suite, 0], [suite, Infinity])
    .reverse()
    .limit(limit)
    .toArray()
    .catch(() => []);
}

export async function deleteAsset(id: string): Promise<void> {
  if (!isBrowser()) return;
  await db().assets.delete(id).catch(() => undefined);
}

// ── Research ────────────────────────────────────────────────────────────────

export async function saveResearchRun(run: ResearchRunRecord): Promise<void> {
  if (!isBrowser()) return;
  await db().research.put(run).catch(() => undefined);
}

export async function listResearchRuns(limit = 100): Promise<ResearchRunRecord[]> {
  if (!isBrowser()) return [];
  return db().research.orderBy('createdAt').reverse().limit(limit).toArray().catch(() => []);
}

export async function getResearchRun(id: string): Promise<ResearchRunRecord | undefined> {
  if (!isBrowser()) return undefined;
  return db().research.get(id).catch(() => undefined);
}

// ── Settings ────────────────────────────────────────────────────────────────

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  if (!isBrowser()) return fallback;
  const row = await db().settings.get(key).catch(() => undefined);
  return row ? (row.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  if (!isBrowser()) return;
  await db().settings.put({ key, value, updatedAt: Date.now() }).catch(() => undefined);
}

// ── Export ──────────────────────────────────────────────────────────────────

export interface SuiteExport {
  suite: SuiteId;
  exportedAt: number;
  sessions: SessionRecord[];
  messages: MessageRecord[];
  artifacts: ArtifactRecord[];
  runs: RunRecord[];
  assets: AssetRecord[];
}

/** Credentials are deliberately excluded — settings never enter an export. */
export async function exportSuite(suite: SuiteId): Promise<SuiteExport> {
  const sessions = await listSessions(suite, { limit: 100000, includeArchived: true });
  const ids = new Set(sessions.map((s) => s.id));
  const d = db();

  const [messages, artifacts, runs, assets] = await Promise.all([
    d.messages.where('suite').equals(suite).toArray().catch(() => []),
    d.artifacts.where('suite').equals(suite).toArray().catch(() => []),
    d.runs.where('suite').equals(suite).toArray().catch(() => []),
    d.assets.where('suite').equals(suite).toArray().catch(() => []),
  ]);

  return {
    suite,
    exportedAt: Date.now(),
    sessions,
    messages: messages.filter((m) => ids.has(m.sessionId)),
    artifacts: artifacts.filter((a) => ids.has(a.sessionId)),
    runs: runs.filter((r) => ids.has(r.sessionId)),
    assets: assets.filter((a) => !a.sessionId || ids.has(a.sessionId)),
  };
}

export async function storageEstimate(): Promise<{ usedBytes: number; quotaBytes: number } | null> {
  if (!isBrowser() || !navigator.storage?.estimate) return null;
  const est = await navigator.storage.estimate().catch(() => null);
  if (!est) return null;
  return { usedBytes: est.usage ?? 0, quotaBytes: est.quota ?? 0 };
}
