/**
 * Pluggable web search.
 *
 * There is no keyless search API with a stable contract. Every free HTML surface
 * rate-limits, serves anti-bot challenges, or changes its markup — all three were
 * observed while building this. So search is a *chain*: proper APIs first when a
 * key is present, HTML scrapers as best-effort fallbacks, and every attempt
 * reports why it failed so a dead pipeline is diagnosable instead of silent.
 *
 * Set any one of these to get reliable results (all have free tiers):
 *   BRAVE_SEARCH_API_KEY · TAVILY_API_KEY · SERPER_API_KEY · SEARXNG_URL
 */

export interface SearchHit {
  url: string;
  title: string;
  snippet: string;
}

export interface SearchOutcome {
  hits: SearchHit[];
  /** Which provider produced `hits`. */
  provider: string;
  /** Every provider that was tried and why it did not answer. */
  attempts: Array<{ provider: string; ok: boolean; reason?: string; count?: number }>;
}

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCharCode(Number.parseInt(h, 16)));
}

const strip = (s: string): string => decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

interface Provider {
  name: string;
  available: () => boolean;
  run: (query: string, limit: number) => Promise<SearchHit[]>;
}

// ── Keyed APIs ──────────────────────────────────────────────────────────────

const brave: Provider = {
  name: 'brave',
  available: () => Boolean(process.env.BRAVE_SEARCH_API_KEY),
  run: async (query, limit) => {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(Math.min(limit, 20)));

    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY! },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = (await res.json()) as { web?: { results?: Array<{ url: string; title: string; description?: string }> } };
    return (json.web?.results ?? []).map((r) => ({ url: r.url, title: strip(r.title), snippet: strip(r.description ?? '') }));
  },
};

const tavily: Provider = {
  name: 'tavily',
  available: () => Boolean(process.env.TAVILY_API_KEY),
  run: async (query, limit) => {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, max_results: Math.min(limit, 20) }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = (await res.json()) as { results?: Array<{ url: string; title: string; content?: string }> };
    return (json.results ?? []).map((r) => ({ url: r.url, title: strip(r.title), snippet: strip(r.content ?? '') }));
  },
};

const serper: Provider = {
  name: 'serper',
  available: () => Boolean(process.env.SERPER_API_KEY),
  run: async (query, limit) => {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': process.env.SERPER_API_KEY! },
      body: JSON.stringify({ q: query, num: Math.min(limit, 20) }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = (await res.json()) as { organic?: Array<{ link: string; title: string; snippet?: string }> };
    return (json.organic ?? []).map((r) => ({ url: r.link, title: strip(r.title), snippet: strip(r.snippet ?? '') }));
  },
};

const searxng: Provider = {
  name: 'searxng',
  available: () => Boolean(process.env.SEARXNG_URL),
  run: async (query, limit) => {
    const url = new URL('/search', process.env.SEARXNG_URL!);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');

    const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(25_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!(res.headers.get('content-type') ?? '').includes('json')) {
      throw new Error('instance returned HTML — enable the json format in its settings.yml');
    }

    const json = (await res.json()) as { results?: Array<{ url: string; title: string; content?: string }> };
    return (json.results ?? []).slice(0, limit).map((r) => ({ url: r.url, title: strip(r.title), snippet: strip(r.content ?? '') }));
  },
};

// ── Keyless HTML fallbacks ──────────────────────────────────────────────────

/** Bing wraps every result in `bing.com/ck/a?...&u=a1<base64url>`. */
function unwrapBing(href: string): string | null {
  const raw = decodeEntities(href);
  const match = /[?&]u=([^&]+)/.exec(raw);
  if (!match) return /^https?:\/\/(?!www\.bing\.com|r\.bing\.com|th\.bing\.com)/.test(raw) ? raw : null;

  let payload = match[1];
  if (payload.startsWith('a1')) payload = payload.slice(2);
  payload += '='.repeat((4 - (payload.length % 4)) % 4);

  try {
    const decoded = Buffer.from(payload, 'base64url').toString('utf8');
    return /^https?:\/\//.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

const bing: Provider = {
  name: 'bing-html',
  available: () => true,
  run: async (query, limit) => {
    const url = new URL('https://www.bing.com/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(Math.min(limit * 2, 30)));

    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const html = await res.text();
    const blocks = html.split(/<li class="b_algo"/).slice(1);
    if (!blocks.length) throw new Error('no b_algo blocks — markup changed or the request was challenged');

    const hits: SearchHit[] = [];
    for (const block of blocks) {
      const anchor = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
      if (!anchor) continue;

      const target = unwrapBing(anchor[1]);
      if (!target) continue;

      const snippet = /<p[^>]*>([\s\S]*?)<\/p>/.exec(block);
      hits.push({ url: target, title: strip(anchor[2]).slice(0, 200), snippet: strip(snippet?.[1] ?? '').slice(0, 400) });
      if (hits.length >= limit) break;
    }

    if (!hits.length) throw new Error('blocks present but no result links could be decoded');
    return hits;
  },
};

const duckduckgo: Provider = {
  name: 'duckduckgo-html',
  available: () => true,
  run: async (query, limit) => {
    const res = await fetch('https://html.duckduckgo.com/html/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': BROWSER_UA },
      body: new URLSearchParams({ q: query }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const html = await res.text();
    const hits: SearchHit[] = [];
    const linkRe = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const snippets = [...html.matchAll(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => strip(m[1]));

    let i = 0;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(html)) !== null && hits.length < limit) {
      let url = decodeEntities(m[1]);
      const wrapped = /[?&]uddg=([^&]+)/.exec(url);
      if (wrapped) url = decodeURIComponent(wrapped[1]);
      if (/^https?:\/\//.test(url)) hits.push({ url, title: strip(m[2]).slice(0, 200), snippet: snippets[i] ?? '' });
      i++;
    }

    if (!hits.length) throw new Error('no result__a anchors — likely an anti-bot challenge page');
    return hits;
  },
};

/** Always reachable, no key, no rate ceiling in practice. Narrow but real. */
const wikipedia: Provider = {
  name: 'wikipedia',
  available: () => true,
  run: async (query, limit) => {
    const url = new URL('https://en.wikipedia.org/w/api.php');
    url.searchParams.set('action', 'query');
    url.searchParams.set('list', 'search');
    url.searchParams.set('srsearch', query);
    url.searchParams.set('srlimit', String(Math.min(limit, 10)));
    url.searchParams.set('format', 'json');

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Chomugiri/1.0 (research agent)', Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!(res.headers.get('content-type') ?? '').includes('json')) throw new Error('rate limited');

    const json = (await res.json()) as { query?: { search?: Array<{ title: string; snippet: string }> } };
    return (json.query?.search ?? []).map((r) => ({
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
      title: r.title,
      snippet: strip(r.snippet),
    }));
  },
};

/** Keyed providers first — they are the only ones with a stable contract. */
const CHAIN: Provider[] = [brave, tavily, serper, searxng, bing, duckduckgo, wikipedia];

// Function words and the freshness/lookup vocabulary the caller's own query
// tends to repeat (see agent/livesearch.ts's needsLiveSearch) — excluded so
// the relevance check below is judging the *subject* of the query, not
// whether it echoed its own filler words back.
const STOPWORDS = new Set([
  'what', 'which', 'who', 'where', 'when', 'why', 'how', 'does', 'do', 'did', 'is', 'are', 'was', 'were',
  'the', 'this', 'that', 'these', 'those', 'and', 'or', 'with', 'for', 'from', 'about', 'into',
  'latest', 'current', 'currently', 'newest', 'recent', 'recently', 'version', 'release', 'released',
  'update', 'updates', 'today', 'now', 'right', 'most', 'any', 'week', 'month', 'year', 'search', 'lookup',
  'find', 'check', 'online', 'browse', 'news', 'stable', 'should', 'would', 'could',
]);

function meaningfulWords(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

/**
 * A cheap sanity gate on what a provider handed back.
 *
 * Bing serves a real-looking results page — the right \`<title>\`, real
 * \`b_algo\` blocks its own scraper is built to read — that is nonetheless
 * seven unrelated news homepages (Fox News, CNN, the NYT, ...) with zero
 * connection to the query, to a request Bing's anti-bot layer decided was a
 * scraper. That page satisfies every check the provider itself makes: it
 * returns 200, the markup parses, `hits.length` is truthy. So the emptiness
 * has to be judged one level up, by asking whether anything actually on the
 * page relates to what was searched for.
 *
 * Not perfect — a query with no distinctive word (a single common noun) is
 * let through uninspected, and a legitimately obscure result could fail this
 * and get discarded. Both are the safer side to be wrong on: this exists to
 * stop a confidently-wrong citation, not to be a precise relevance ranker.
 */
export function looksRelevant(query: string, hits: SearchHit[]): boolean {
  const words = meaningfulWords(query);
  if (!words.length) return true;
  const haystack = hits.map((h) => `${h.title} ${h.snippet}`.toLowerCase()).join(' ');
  return words.some((w) => haystack.includes(w));
}

export async function search(query: string, limit = 10): Promise<SearchOutcome> {
  const attempts: SearchOutcome['attempts'] = [];

  for (const provider of CHAIN) {
    if (!provider.available()) {
      attempts.push({ provider: provider.name, ok: false, reason: 'not configured' });
      continue;
    }
    try {
      const hits = await provider.run(query, limit);
      if (hits.length) {
        if (!looksRelevant(query, hits)) {
          attempts.push({
            provider: provider.name,
            ok: false,
            reason: `${hits.length} hits, none mentioning the query — likely an anti-bot decoy page`,
          });
          continue;
        }
        attempts.push({ provider: provider.name, ok: true, count: hits.length });
        return { hits, provider: provider.name, attempts };
      }
      attempts.push({ provider: provider.name, ok: false, reason: 'returned nothing' });
    } catch (err) {
      attempts.push({ provider: provider.name, ok: false, reason: (err as Error).message.slice(0, 140) });
    }
  }

  return { hits: [], provider: 'none', attempts };
}

/** One-line summary for the retrieval notes. */
export function describeAttempts(attempts: SearchOutcome['attempts']): string {
  return attempts
    .map((a) => (a.ok ? `${a.provider}: ${a.count} hits` : `${a.provider}: ${a.reason}`))
    .join(' · ');
}
