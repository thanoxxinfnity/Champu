/**
 * Permanent memory: what the user told the app to remember, and what earlier work decided or learned.
 *
 * The idea is claude-mem's (github.com/thedotmack/claude-mem): capture compact observations as work happens, bring the relevant
 * ones back into later sessions, so nobody has to explain themselves twice. That project is a Claude Code plugin (hooks, a local
 * worker, SQLite and a vector index) and cannot run inside a browser app, so this is the same loop built to fit here: short
 * observations in IndexedDB, recalled by relevance, shown to the user and deletable by them.
 *
 * Everything in this file is pure: the store, the model call and the UI live elsewhere.
 */

export type MemoryKind = 'preference' | 'fact' | 'decision' | 'project' | 'lesson';

export interface Memory {
  id: string;
  kind: MemoryKind;
  text: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  /** How many times it was brought into a prompt. */
  uses: number;
  /** Told to the app by the user (kept first, pruned last) rather than noticed by it. */
  pinned: boolean;
}

export const MAX_MEMORIES = 300;
export const MAX_TEXT = 240;
const KINDS: MemoryKind[] = ['preference', 'fact', 'decision', 'project', 'lesson'];

const STOP = new Set(('a an the and or but if then of to in on at for with from by is are was were be been it its this that these those i you he she we they me my your our their ' +
  'do does did can could should would will just not no yes ko ka ki ke se me mein pe par hai hain ho hoga tha thi kar karo kya aur ya bhi to toh ye yeh wo woh isko usko apna apne').split(' '));

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9ऀ-ॿ][a-z0-9ऀ-ॿ.+#-]*/g) ?? [])
    .map((w) => w.replace(/[.+#-]+$/, ''))
    .map((w) => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, '') : w))
    .filter((w) => w.length > 1 && !STOP.has(w));
}

export const newMemoryId = (): string => `mem_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ── Never remember a secret ─────────────────────────────────────────────────

const SECRET = /\b(sk-[A-Za-z0-9_-]{12,}|vc[ap]_[A-Za-z0-9]{12,}|hf_[A-Za-z0-9]{12,}|gh[pousr]_[A-Za-z0-9]{12,}|AKIA[0-9A-Z]{12,}|xox[abp]-[A-Za-z0-9-]{10,}|nvapi-[A-Za-z0-9_-]{10,}|AIza[0-9A-Za-z_-]{20,})\b|\b(password|passwd|pwd|passcode|otp|api[ _-]?key|secret|token|bearer)\b\s*(?:is|=|:|hai)?\s*\S{6,}/i;
export const looksSecret = (text: string): boolean => SECRET.test(text);

// ── Making a memory ─────────────────────────────────────────────────────────

export function makeMemory(input: { kind?: string; text: string; tags?: string[] }, opts: { pinned?: boolean; now?: number } = {}): Memory | null {
  const text = input.text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  if (text.length < 6 || looksSecret(text)) return null;
  const kind = (KINDS as string[]).includes(input.kind ?? '') ? (input.kind as MemoryKind) : 'fact';
  const tags = [...new Set((input.tags ?? []).map((t) => String(t).toLowerCase().replace(/[^a-z0-9._+# -]/g, '').trim()).filter((t) => t && t.length < 30))].slice(0, 6);
  const now = opts.now ?? Date.now();
  return { id: newMemoryId(), kind, text, tags, createdAt: now, updatedAt: now, uses: 0, pinned: Boolean(opts.pinned) };
}

const jaccard = (a: Set<string>, b: Set<string>): number => {
  if (!a.size || !b.size) return 0;
  let both = 0;
  for (const x of a) if (b.has(x)) both++;
  return both / (a.size + b.size - both);
};

/** Adds `incoming` to `list`; one that says nearly the same as an existing memory refreshes that memory instead. */
export function addMemories(list: Memory[], incoming: Memory[]): { list: Memory[]; added: Memory[]; merged: number } {
  const next = [...list];
  const added: Memory[] = [];
  let merged = 0;
  for (const m of incoming) {
    const t = new Set(tokenize(m.text));
    const at = next.findIndex((x) => jaccard(new Set(tokenize(x.text)), t) >= 0.6);
    if (at >= 0) {
      const old = next[at];
      next[at] = { ...old, text: m.text.length >= old.text.length ? m.text : old.text, tags: [...new Set([...old.tags, ...m.tags])].slice(0, 6), updatedAt: m.updatedAt, pinned: old.pinned || m.pinned };
      merged++;
    } else {
      next.push(m);
      added.push(m);
    }
  }
  return { list: prune(next), added, merged };
}

/** Keeps the list bounded: what the user pinned stays, then what is used and recent. */
export function prune(list: Memory[], max = MAX_MEMORIES): Memory[] {
  if (list.length <= max) return list;
  const value = (m: Memory) => (m.pinned ? 1e9 : 0) + m.uses * 3 + m.updatedAt / 1e11;
  return [...list].sort((a, b) => value(b) - value(a)).slice(0, max);
}

// ── Recall ──────────────────────────────────────────────────────────────────

/**
 * The memories this request needs. Preferences about how the user wants to be worked with apply to everything, so the most recent
 * few always come; the rest have to share real words with the request, rare words counting for more.
 */
export function recall(list: Memory[], query: string, opts: { limit?: number; maxChars?: number; minScore?: number } = {}): Memory[] {
  const { limit = 7, maxChars = 1700, minScore = 1.2 } = opts;
  if (!list.length) return [];
  const q = new Set(tokenize(query));
  const docs = list.map((m) => new Set([...tokenize(m.text), ...m.tags.flatMap(tokenize)]));
  const df = new Map<string, number>();
  for (const d of docs) for (const w of d) df.set(w, (df.get(w) ?? 0) + 1);
  const idf = (w: string) => Math.log(1 + list.length / (df.get(w) ?? 1));

  const scored = list.map((m, i) => {
    let s = 0;
    for (const w of q) if (docs[i].has(w)) s += idf(w);
    s += Math.min(m.uses, 5) * 0.05 + (m.pinned ? 0.4 : 0);
    return { m, s };
  });

  const always = list.filter((m) => m.kind === 'preference').sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3);
  const picked = new Map(always.map((m) => [m.id, m]));
  for (const { m } of scored.filter((x) => x.s >= minScore).sort((a, b) => b.s - a.s)) {
    if (picked.size >= limit) break;
    picked.set(m.id, m);
  }
  const out: Memory[] = [];
  let size = 0;
  for (const m of picked.values()) {
    if (size + m.text.length + 20 > maxChars) break;
    size += m.text.length + 20;
    out.push(m);
  }
  return out;
}

export function formatMemory(list: Memory[]): string {
  if (!list.length) return '';
  return `## MEMORY (kept from earlier sessions, chosen for this request)
Things the user told you to remember, and what earlier work decided or learned. Use them quietly: follow the preferences, build on the decisions, do not ask the user to repeat any of it, and do not recite this list back. If something here is plainly out of date or contradicted by the user now, the user wins.
${list.map((m) => `- (${m.kind}) ${m.text}`).join('\n')}`;
}

export const memoryNote = (list: Memory[]): string => `::brain:: Remembered from before — ${list.length} thing${list.length === 1 ? '' : 's'} used.`;

// ── Commands ("/memory …" and plain words) ──────────────────────────────────

export type MemoryCommand =
  | { kind: 'help' }
  | { kind: 'list'; query: string }
  | { kind: 'add'; text: string; natural: boolean }
  | { kind: 'forget'; query: string; natural: boolean }
  | { kind: 'clear' }
  | { kind: 'toggle'; on?: boolean };

const REMEMBER = /^(?:please\s+|plz\s+|bro\s+)?(?:yaad\s+rakh(?:o|na|na hai|lo)|yaad\s+kar\s+lo|yaad\s+rakhna|remember(?:\s+that|\s+this)?|note\s+(?:this|that)\s+down|save\s+(?:this\s+)?(?:to|in)\s+memory)\s*[:,;-]?\s+(.{6,})$/is;
const FORGET = /^(?:please\s+|plz\s+)?(?:bhool\s+jao|bhul\s+ja(?:o)?|forget(?:\s+that|\s+about)?|yaad\s+mat\s+rakho|delete\s+(?:the\s+)?memory(?:\s+about)?)\s*[:,;-]?\s+(.{3,})$/is;

export const MEMORY_HELP = `**Memory** keeps what matters so you do not have to repeat it.

- Say it plainly: "yaad rakho: mujhe Hinglish mein jawab chahiye" or "remember that my app is called Chai Time".
- It also notices things by itself after a task (your preferences, decisions, fixes that worked) — never passwords or keys.
- The right ones come back by themselves when a request needs them; the chat says when.
- \`/memory\` lists everything · \`/memory chai\` searches · \`/memory add <text>\` · \`/memory forget <words>\` · \`/memory off\` or \`on\` · \`/memory clear\`
- "bhool jao <words>" forgets too. Everything stays on this device and can be edited in Skills → Memory.`;

export function parseMemory(input: string): MemoryCommand | null {
  const t = input.trim();
  const slash = /^\/(?:memory|mem|remember)(?:\s+([\s\S]*))?$/i.exec(t);
  if (slash) {
    const rest = (slash[1] ?? '').trim();
    const isRemember = /^\/remember/i.test(t);
    if (isRemember) return rest ? { kind: 'add', text: rest, natural: false } : { kind: 'help' };
    if (!rest) return { kind: 'list', query: '' };
    const [head, ...tail] = rest.split(/\s+/);
    const arg = tail.join(' ').trim();
    switch (head.toLowerCase()) {
      case 'help': case '?': return { kind: 'help' };
      case 'on': return { kind: 'toggle', on: true };
      case 'off': return { kind: 'toggle', on: false };
      case 'clear': case 'reset': return { kind: 'clear' };
      case 'add': case 'save': return arg ? { kind: 'add', text: arg, natural: false } : { kind: 'help' };
      case 'forget': case 'delete': case 'remove': return arg ? { kind: 'forget', query: arg, natural: false } : { kind: 'help' };
      case 'list': case 'search': case 'find': return { kind: 'list', query: arg };
      default: return { kind: 'list', query: rest };
    }
  }
  if (t.length > 500 || t.includes('\n\n')) return null;
  const f = FORGET.exec(t);
  if (f) return { kind: 'forget', query: f[1].trim(), natural: true };
  const r = REMEMBER.exec(t);
  if (r) return { kind: 'add', text: r[1].trim(), natural: true };
  return null;
}

/** The memories a "forget …" means: by id, or by words in common. */
export function findToForget(list: Memory[], query: string): Memory[] {
  const q = query.trim();
  const byId = list.filter((m) => m.id === q);
  if (byId.length) return byId;
  const w = new Set(tokenize(q));
  if (!w.size) return [];
  return list.filter((m) => {
    const d = new Set([...tokenize(m.text), ...m.tags.flatMap(tokenize)]);
    let hit = 0;
    for (const x of w) if (d.has(x)) hit++;
    return hit >= Math.max(1, Math.ceil(w.size * 0.6));
  });
}

export function renderList(list: Memory[], query: string): string {
  const shown = (query ? list.filter((m) => tokenize(query).some((w) => tokenize(m.text).includes(w) || m.tags.includes(w))) : list)
    .slice().sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  if (!list.length) return 'Nothing remembered yet. Say "yaad rakho: …" and it will be kept, or just work: preferences and decisions are noticed after a task.';
  if (!shown.length) return `Nothing remembered about "${query}" (${list.length} other thing${list.length === 1 ? '' : 's'} kept).`;
  return `**${shown.length} remembered${query ? ` about "${query}"` : ''}**\n\n${shown.slice(0, 40).map((m) => `- (${m.kind}${m.pinned ? ', pinned' : ''}) ${m.text}`).join('\n')}${shown.length > 40 ? `\n…and ${shown.length - 40} more (Skills → Memory)` : ''}`;
}

// ── Noticing things after a task ────────────────────────────────────────────

export const CAPTURE_SYSTEM = `You keep a long-term memory for a coding assistant. From the exchange below, extract the few things worth remembering for FUTURE sessions: the user's preferences and how they like to work, facts about their project (name, stack, paths, versions, decisions), and lessons (a fix that worked, something that failed and why).
Rules:
- 0 to 4 items. Most exchanges deserve 0 or 1. Return [] when nothing is durable.
- Each item is one short, self-contained sentence (under 200 characters) that makes sense with no other context.
- Never include passwords, tokens, keys, OTPs or personal contact details.
- Do not record what was merely asked or built in this one exchange unless it is a decision the next session needs.
- Reply with JSON only: [{"kind":"preference|fact|decision|project|lesson","text":"…","tags":["a","b"]}]`;

export function captureInput(parts: { request: string; outcome: string; files?: string[]; commands?: string[] }): string {
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
  return [
    `USER ASKED:\n${clip(parts.request, 900)}`,
    `ASSISTANT RESULT:\n${clip(parts.outcome, 1500)}`,
    parts.files?.length ? `FILES WRITTEN: ${parts.files.slice(0, 12).join(', ')}` : '',
    parts.commands?.length ? `COMMANDS RUN: ${parts.commands.slice(0, 6).map((c) => clip(c, 100)).join(' | ')}` : '',
  ].filter(Boolean).join('\n\n');
}

export function parseObservations(reply: string, now = Date.now()): Memory[] {
  const m = /\[[\s\S]*\]/.exec(reply ?? '');
  if (!m) return [];
  let raw: unknown;
  try { raw = JSON.parse(m[0]); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const out: Memory[] = [];
  for (const o of raw.slice(0, 4)) {
    if (!o || typeof o !== 'object') continue;
    const r = o as { kind?: unknown; text?: unknown; tags?: unknown };
    if (typeof r.text !== 'string') continue;
    const mem = makeMemory({ kind: typeof r.kind === 'string' ? r.kind : undefined, text: r.text, tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string') : [] }, { now });
    if (mem) out.push(mem);
  }
  return out;
}

/** Whether an exchange is worth the model call that notices things: real work, not a greeting or a one-word reply. */
export function worthCapturing(request: string, outcome: string): boolean {
  return request.trim().length >= 25 && outcome.trim().length >= 80 && !/^\/(?:od|skills|use|memory)\b/i.test(request.trim());
}
