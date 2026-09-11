import { NextRequest } from 'next/server';
import { keysFromRequest, withRequestKeys } from '@/lib/providers/request-keys';
import { activeEmbedModel, embed, rerank, rerankAvailable, hasNimKey } from '@/lib/providers/nim';
import { describeAttempts, search, type SearchHit } from '@/lib/search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Search-augmented retrieval for Workdrive.
 *
 * Pipeline: search → fetch → extract → chunk → embed → rerank → return context.
 *
 * The generation step deliberately lives in the client's normal chat stream so
 * the answer renders token-by-token in the same bubble as everything else; this
 * route returns *grounded context*, not prose.
 *
 * NVIDIA publishes no hosted "web search" NIM, so search itself uses a keyless
 * HTML endpoint and NIM supplies the embeddings.
 *
 * Reranking is deliberately optional: NVIDIA's hosted reranker NIMs now answer
 * `410 Gone`, verified against a live key. The pipeline therefore ranks by
 * embedding cosine similarity, and only runs a cross-encoder pass when
 * NVIDIA_NIM_RERANK_URL points at a self-hosted reranker. Without any NIM
 * entitlement it degrades to lexical scoring — grounded-but-cruder beats
 * nothing, and each stage reports which path it took.
 */

interface ResearchRequest {
  query: string;
  maxSources?: number;
  maxChunks?: number;
  /** Restrict retrieval to these URLs instead of searching. */
  urls?: string[];
}

const UA = 'Mozilla/5.0 (compatible; Chomugiri/1.0; +research-agent)';

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCharCode(Number.parseInt(h, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'");
}

/** Crude but effective boilerplate-stripping text extraction. */
function extractText(html: string): { title: string; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim().slice(0, 200) : '';

  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  return {
    title,
    text: decodeEntities(body)
      .replace(/[ \t ]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 2)
      .join('\n')
      .slice(0, 120_000),
  };
}

async function fetchPage(url: string): Promise<{ url: string; title: string; text: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(20_000),
      redirect: 'follow',
    });
    if (!res.ok) return null;

    const type = res.headers.get('content-type') ?? '';
    if (!/text\/html|text\/plain|application\/xhtml/.test(type)) return null;

    const raw = await res.text();
    const { title, text } = extractText(raw);
    if (text.length < 200) return null;
    return { url, title: title || url, text };
  } catch {
    return null;
  }
}

/** ~900-char chunks on paragraph boundaries, with a little overlap for context. */
function chunk(text: string, size = 900, overlap = 120): string[] {
  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = '';

  for (const p of paragraphs) {
    if (current.length + p.length + 2 <= size) {
      current += (current ? '\n\n' : '') + p;
      continue;
    }
    if (current) chunks.push(current);
    if (p.length <= size) {
      current = p;
    } else {
      for (let i = 0; i < p.length; i += size - overlap) chunks.push(p.slice(i, i + size));
      current = '';
    }
  }
  if (current) chunks.push(current);
  return chunks.filter((c) => c.trim().length > 80);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/** Lexical fallback when the NIM retrieval stack is unavailable. */
function lexicalScore(query: string, passage: string): number {
  const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
  const body = passage.toLowerCase();
  let score = 0;
  for (const t of terms) {
    const hits = body.split(t).length - 1;
    if (hits) score += 1 + Math.log(hits);
  }
  return score / (terms.length || 1);
}

async function handlePOST(req: NextRequest) {
  let body: ResearchRequest;
  try {
    body = (await req.json()) as ResearchRequest;
  } catch {
    return Response.json({ error: 'Request body is not valid JSON.' }, { status: 400 });
  }

  const query = body.query?.trim();
  if (!query) return Response.json({ error: '`query` is required.' }, { status: 400 });

  const maxSources = Math.min(Math.max(body.maxSources ?? 6, 1), 12);
  const maxChunks = Math.min(Math.max(body.maxChunks ?? 14, 3), 40);
  const notes: string[] = [];

  // 1. Candidate sources.
  let hits: SearchHit[];
  if (body.urls?.length) {
    hits = body.urls.slice(0, maxSources).map((url) => ({ url, title: url, snippet: '' }));
    notes.push(`Using ${hits.length} caller-supplied URL(s); search skipped.`);
  } else {
    const outcome = await search(query, maxSources * 2);
    hits = outcome.hits;

    if (!hits.length) {
      return Response.json(
        {
          error:
            'Every search backend refused or returned nothing. Free HTML search surfaces rate-limit aggressively — configure BRAVE_SEARCH_API_KEY, TAVILY_API_KEY, SERPER_API_KEY or SEARXNG_URL for a stable contract, or pass explicit `urls`.',
          code: 'search_empty',
          attempts: outcome.attempts,
        },
        { status: 502 },
      );
    }

    notes.push(`Search via ${outcome.provider} — ${describeAttempts(outcome.attempts)}`);
  }

  // 2. Fetch in parallel; dead links simply drop out.
  const pages = (await Promise.all(hits.slice(0, maxSources * 2).map((h) => fetchPage(h.url))))
    .filter((p): p is { url: string; title: string; text: string } => Boolean(p))
    .slice(0, maxSources);

  if (!pages.length) {
    return Response.json(
      { error: 'Every candidate source failed to fetch or was non-HTML.', code: 'fetch_all_failed', candidates: hits.map((h) => h.url) },
      { status: 502 },
    );
  }

  // 3. Chunk.
  const passages: Array<{ text: string; url: string; title: string }> = [];
  for (const page of pages) {
    for (const c of chunk(page.text).slice(0, 40)) {
      passages.push({ text: c, url: page.url, title: page.title });
    }
  }

  // 4. Rank — NIM retrieval stack, with graceful degradation.
  let ranked: Array<{ text: string; url: string; title: string; score: number }>;

  if (hasNimKey()) {
    try {
      const shortlistSize = Math.min(passages.length, 100);
      const [queryVec] = await embed([query], 'query');
      const passageVecs = await embed(passages.slice(0, shortlistSize).map((p) => p.text), 'passage');

      const shortlist = passages
        .slice(0, shortlistSize)
        .map((p, i) => ({ ...p, score: cosine(queryVec, passageVecs[i]) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.min(maxChunks * 3, 40));

      ranked = shortlist.slice(0, maxChunks);
      notes.push(`Ranked by embedding similarity (${activeEmbedModel() ?? 'NIM embeddings'}).`);

      // Optional cross-encoder pass — only when a reranker is actually reachable.
      if (rerankAvailable()) {
        try {
          const rankings = await rerank(query, shortlist.map((p) => p.text));
          const reranked = rankings
            .map((r) => ({ ...shortlist[r.index], score: r.score }))
            .filter((p) => p?.text)
            .slice(0, maxChunks);
          if (reranked.length) {
            ranked = reranked;
            notes.push('Refined with a cross-encoder rerank pass.');
          }
        } catch (err) {
          // A dead reranker must not discard a good embedding ranking.
          notes.push(`Rerank pass skipped: ${(err as Error).message.slice(0, 120)}`);
        }
      }
    } catch (err) {
      notes.push(`NIM embeddings unavailable (${(err as Error).message.slice(0, 160)}); fell back to lexical ranking.`);
      ranked = passages
        .map((p) => ({ ...p, score: lexicalScore(query, p.text) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, maxChunks);
    }
  } else {
    notes.push('NVIDIA_NIM_API_KEY absent — using lexical ranking. Add the key for semantic embedding ranking.');
    ranked = passages
      .map((p) => ({ ...p, score: lexicalScore(query, p.text) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxChunks);
  }

  // 5. Assemble a citation-numbered context block.
  const sourceOrder: string[] = [];
  for (const r of ranked) if (!sourceOrder.includes(r.url)) sourceOrder.push(r.url);

  const context = ranked
    .map((r) => `[${sourceOrder.indexOf(r.url) + 1}] ${r.title}\n${r.text}`)
    .join('\n\n---\n\n');

  return Response.json({
    query,
    context,
    notes,
    sources: sourceOrder.map((url, i) => {
      const page = pages.find((p) => p.url === url);
      return {
        n: i + 1,
        url,
        title: page?.title ?? url,
        score: ranked.find((r) => r.url === url)?.score ?? 0,
        excerpt: ranked.find((r) => r.url === url)?.text.slice(0, 280) ?? '',
      };
    }),
    stats: { pagesFetched: pages.length, passages: passages.length, selected: ranked.length },
  });
}

/**
 * Credentials the user saved in the app travel on the request, so the web build
 * works without anyone editing .env.local. The server's own environment is still
 * the fallback, so a self-hosted instance is unaffected.
 */
export async function POST(req: NextRequest) {
  return withRequestKeys(keysFromRequest(req), () => handlePOST(req));
}
