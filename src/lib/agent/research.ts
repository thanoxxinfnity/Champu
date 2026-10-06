/**
 * Research that happens on its own, before a build.
 *
 * A model's training data stops at a date, and tools do not: Godot 4.7.2 was
 * simply not in what the model had learned, and it wrote for the version it
 * remembered. `livesearch.ts` only fires on words like "latest" — a plain
 * "build a zombie game" never matched, so the model built from memory without
 * ever being told it might be out of date. And it only ever read search-result
 * snippets, two lines each.
 *
 * This is the stronger pass. For a build it decides what the model is most
 * likely to be stale about (the tool's current version and how its API looks
 * now, plus the thing the user named), searches for each, **reads the actual
 * pages**, and hands the model the relevant passages with their sources. The
 * fetch/extract/rank work is the existing `/api/research` route, which the
 * Android app implements natively too — so this runs in the browser, in the
 * APK, and in dev, and never needs CORS or a search key.
 *
 * It never throws and never blocks a build for long: no network, a dead search
 * backend or a timeout all mean "carry on from what the model already knows",
 * exactly as before this existed.
 */

import type { Lane } from './router.ts';

export interface ResearchQuery {
  /** Why this was searched, shown to the user. */
  why: string;
  query: string;
  /**
   * Pages to read directly instead of searching. Search engines answer a
   * specific question ("Android Gradle plugin latest version") with generic
   * pages; the project's own release page answers it exactly. Measured: the
   * search returned a Wikipedia article on Android, the release page returned
   * "Android Gradle plugin 9.4.0 (September 2026)".
   */
  urls?: string[];
}

export interface ResearchSource {
  n: number;
  url: string;
  title: string;
}

export interface ResearchFinding {
  query: string;
  why: string;
  context: string;
  sources: ResearchSource[];
}

export interface ResearchReport {
  findings: ResearchFinding[];
  /** Queries that returned nothing, so the model is told what it was NOT able to check. */
  missed: string[];
  pagesRead: number;
}

/** What `/api/research` answers with. */
interface RouteAnswer {
  context?: string;
  sources?: Array<{ n: number; url: string; title: string }>;
  stats?: { pagesFetched: number };
}

export type PostResearch = (body: { query: string; maxSources: number; maxChunks: number; urls?: string[] }) => Promise<RouteAnswer | null>;

const YEAR = () => new Date().getFullYear();

/**
 * Per-suite: the facts a model is most often wrong about. These are the
 * questions behind real failures — the engine version, the Gradle/SDK pairing,
 * the manifest format — not general curiosity.
 */
const SUITE_QUERIES: Record<string, (year: number) => ResearchQuery[]> = {
  godot: (y) => [
    {
      why: 'current Godot version',
      query: `Godot Engine latest stable release version ${y}`,
      urls: ['https://github.com/godotengine/godot/releases'],
    },
    { why: 'what changed in Godot 4.x', query: `Godot 4 release notes breaking changes GDScript ${y}` },
  ],
  android: (y) => [
    {
      why: 'current Android Gradle Plugin / SDK',
      query: `Android Gradle Plugin latest stable version compileSdk targetSdk ${y}`,
      urls: ['https://developer.android.com/build/releases/gradle-plugin'],
    },
  ],
  minecraft: (y) => [
    { why: 'current Bedrock add-on format', query: `Minecraft Bedrock add-on manifest format_version min_engine_version latest ${y}` },
  ],
  site: (y) => [
    { why: 'current web platform practice', query: `modern CSS HTML best practices ${y} browser support` },
  ],
};

/** Words that carry no search value in a build request. */
const FILLER =
  /\b(please|pls|plz|bro|yar|jaldi|karo|kar|do|de|banao|bana|ek|ka|ke|ki|ko|na|ha|hai|me|ma|sa|se|aur|tho|to|ho|wala|wali|jaisa|jasa|jase|build|make|create|generate|write|game|app|website|apk|and|the|a|an|for|with|me|my|i|want|need)\b/gi;

/** The proper-noun-ish things the user named: capitalised words, versions, acronyms. */
function namedThings(text: string): string[] {
  // Only what looks like a product or library name: FastAPI, PostgreSQL, ESP32, three.js2. A plain capitalised
  // word is far more often a sentence start, a person, or a Hindi word spelled in English ("Kharche", "Hinglish")
  // — searching for those pulled travel blogs into an expense-tracker build.
  const found =
    text.match(/\b(?:[A-Z][a-z]+[A-Z][a-zA-Z0-9]*|[A-Z]{3,}[0-9]*|[a-z]+[0-9]+(?:\.[0-9]+)*)\b/g) ?? [];
  const skip = new Set([
    'APK', 'AAB', 'API', 'APIS', 'URL', 'HTML', 'CSS', 'PDF', 'ZIP', 'GUI', 'CLI', 'JSON', 'USD', 'INR',
    'PLEASE', 'BRO', 'MAKE', 'BUILD', 'CREATE', 'THE', 'AND', 'ANDROID', 'GODOT', 'MINECRAFT', 'ENGLISH', 'HINGLISH', 'HINDI',
  ]);
  return [...new Set(found.filter((w) => !skip.has(w.toUpperCase())))].slice(0, 4);
}

/** Does this message deserve research before any work starts? */
export function needsResearch(input: string, suite: string, lane: Lane): boolean {
  const text = input.trim();
  if (text.length < 12 || text.startsWith('/')) return false;
  // Building something is where a stale version costs a whole broken project.
  if (lane === 'B' && suite !== 'chat') return true;
  // Explicit requests are handled by livesearch's lookup verbs; research is for builds.
  return false;
}

/**
 * The searches worth making, at most three. Deterministic, so the same request
 * researches the same things — and so a user can see why each one ran.
 */
export function planResearch(input: string, suite: string, now = YEAR()): ResearchQuery[] {
  const queries: ResearchQuery[] = [...(SUITE_QUERIES[suite]?.(now) ?? [])];

  const named = namedThings(input);
  if (named.length) {
    queries.push({ why: `what ${named.join(' ')} is and how it works now`, query: `${named.join(' ')} ${now}`.slice(0, 160) });
  } else {
    const topic = input
      .split(/[.!?\n]/)[0]!
      .replace(FILLER, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
    if (topic.split(' ').length >= 2) queries.push({ why: 'background on what you asked for', query: `${topic} ${now}` });
  }
  return queries.slice(0, 3);
}

// Version facts rarely change within a session; asking again costs seconds a
// user feels. A short memo keeps a second build in the same chat instant.
const memo = new Map<string, { at: number; finding: ResearchFinding | null }>();
const MEMO_MS = 6 * 60 * 60 * 1000;

/**
 * Runs the queries in parallel and keeps what came back. `post` is injected so
 * this file stays free of browser-only imports and can be tested in Node.
 */
export async function runResearch(
  queries: ResearchQuery[],
  post: PostResearch,
  options: { timeoutMs?: number; now?: number } = {},
): Promise<ResearchReport> {
  const now = options.now ?? Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), options.timeoutMs ?? 40_000);
  });

  const one = async (q: ResearchQuery): Promise<{ q: ResearchQuery; finding: ResearchFinding | null; pages: number }> => {
    const key = `${q.query}|${(q.urls ?? []).join(',')}`;
    const hit = memo.get(key);
    if (hit && now - hit.at < MEMO_MS && hit.finding) return { q, finding: hit.finding, pages: 0 };
    try {
      // Few sources, few passages: three searches' worth must still fit a prompt.
      const answer = await post({ query: q.query, maxSources: 4, maxChunks: 5, ...(q.urls?.length ? { urls: q.urls } : {}) });
      if (!answer?.context?.trim()) return { q, finding: null, pages: 0 };
      const finding: ResearchFinding = {
        query: q.query,
        why: q.why,
        context: answer.context,
        sources: (answer.sources ?? []).map((s) => ({ n: s.n, url: s.url, title: s.title })),
      };
      memo.set(key, { at: now, finding });
      return { q, finding, pages: answer.stats?.pagesFetched ?? finding.sources.length };
    } catch {
      return { q, finding: null, pages: 0 };
    }
  };

  const settled = await Promise.race([Promise.all(queries.map(one)), deadline]);
  clearTimeout(timer);
  if (settled === 'timeout') return { findings: [], missed: queries.map((q) => q.query), pagesRead: 0 };

  return {
    findings: settled.flatMap((s) => (s.finding ? [s.finding] : [])),
    missed: settled.filter((s) => !s.finding).map((s) => s.q.query),
    pagesRead: settled.reduce((n, s) => n + s.pages, 0),
  };
}

/** One line for the transcript: what was looked up and how much was really read. */
export function summarizeResearch(report: ResearchReport): string {
  if (!report.findings.length) return '';
  const hosts = new Set<string>();
  for (const f of report.findings) {
    for (const s of f.sources) {
      try {
        hosts.add(new URL(s.url).hostname.replace(/^www\./, ''));
      } catch {
        // A malformed source URL is not worth failing the note over.
      }
    }
  }
  const list = [...hosts].slice(0, 5).join(', ');
  const topics = report.findings.map((f) => f.why).join('; ');
  return `🔎 Researched before building — ${topics}. Read ${report.pagesRead || 'several'} live page${report.pagesRead === 1 ? '' : 's'}${list ? ` (${list})` : ''}.`;
}

const PER_FINDING_CHARS = 2600;

/**
 * The block the system prompt carries. The rule at the top is the point of the
 * whole feature: what was read this turn outranks what the model remembers.
 */
export function formatResearch(report: ResearchReport): string {
  const body = report.findings
    .map((f) => {
      const srcs = f.sources.map((s) => `[${s.n}] ${s.title} — ${s.url}`).join('\n');
      return `### ${f.why}  (searched: "${f.query}")\n${f.context.slice(0, PER_FINDING_CHARS)}\n\nSources:\n${srcs}`;
    })
    .join('\n\n');
  const missed = report.missed.length
    ? `\n\nCould NOT be checked (no result): ${report.missed.map((m) => `"${m}"`).join(', ')}. For those, say plainly that you are going from memory.`
    : '';
  return (
    `## RESEARCH FROM LIVE WEB PAGES (read this turn, after your training cutoff)\n` +
    `Your training data ends at a fixed date and the tools you are building with keep releasing. Anything below that states a version, a flag, a file format or an API **overrides what you remember** — build for what is written here. ` +
    `If a page contradicts your memory, trust the page and say so in one line ("Godot is now 4.x, so I am using …"). If the pages do not cover something, do not invent it; say what you assumed.\n\n${body}${missed}`
  );
}
