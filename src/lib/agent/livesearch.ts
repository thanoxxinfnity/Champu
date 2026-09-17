/**
 * Deciding whether a chat message needs the live web, and asking it.
 *
 * Chomugiri's own model is trained on a fixed snapshot, the same limit any
 * model has — it does not know a version shipped last week, and it will
 * answer confidently anyway unless something outside it corrects the record.
 * `search()` in `@/lib/search` already does that lookup with no required key
 * (Brave/Tavily/Serper/SearXNG when configured, Bing and DuckDuckGo's HTML
 * pages and Wikipedia's API when not), it was just never called from the
 * normal chat path — only from the separate Workdrive research panel, which
 * needs the user to go and start a run by hand.
 *
 * This wires the same free chain into the normal turn: a deterministic
 * pattern check decides whether the question is the kind a fixed snapshot
 * answers badly, and if so the result is handed to the model as a labelled
 * context block it can use, cite, or set aside — the same shape
 * `buildSystemPrompt` already uses for bridge status and the to-do ledger.
 */

import { describeAttempts, search, type SearchHit } from '../search/index.ts';

/**
 * Freshness signals: words that only make sense answered against *now*, not
 * against a training cutoff. Deliberately biased toward triggering rather
 * than staying quiet — a search that turns out unnecessary costs a second of
 * latency against a free chain, while a live question answered from stale
 * memory costs the user a wrong answer they have no reason to doubt.
 */
const FRESHNESS =
  /\b(latest|newest|current(ly)?|up[- ]to[- ]date|most recent|recent(ly)?|today|this (week|month|year)|right now|as of (now|today)|nowadays|abhi( ka| tak)?|aaj\s?kal|naya|abhi wala)\b/i;

/** Explicit "go find out" requests — the clearest possible signal. */
const LOOKUP_VERBS =
  /\b(search( the (web|internet))?|look ?up|google|find out|check online|browse the web|what'?s new|any updates?)\b/i;

/** "the current/latest version of X", "which version of X", release/changelog language. */
const VERSION_TALK =
  /\b(version|release(d)?|changelog|update[sd]?|roadmap|news (about|on)|price (of|for)|who is the current)\b/i;

/** A near-present year is exactly where a fixed training cutoff is most likely wrong. */
const RECENT_YEAR = /\b20(2[4-9]|[3-9]\d)\b/;

export interface LiveSearchDecision {
  needed: boolean;
  /** Which pattern fired, for the transient notice and for debugging a bad call. */
  reason?: string;
}

/**
 * A cheap, deterministic pre-filter — the same "scorer first, model only for
 * the ambiguous remainder" shape `router.ts` already uses for lane
 * classification, and for the same reason: most messages decide themselves in
 * microseconds, and a network round trip should not sit in front of "write me
 * a for loop".
 */
export function needsLiveSearch(text: string): LiveSearchDecision {
  if (FRESHNESS.test(text)) return { needed: true, reason: 'freshness word' };
  if (LOOKUP_VERBS.test(text)) return { needed: true, reason: 'explicit lookup request' };
  if (VERSION_TALK.test(text) && RECENT_YEAR.test(text)) return { needed: true, reason: 'version + recent year' };
  if (VERSION_TALK.test(text) && /\b(what|which|latest|current)\b/i.test(text)) {
    return { needed: true, reason: 'version question' };
  }
  return { needed: false };
}

export interface LiveSearchResult {
  query: string;
  hits: SearchHit[];
  provider: string;
  attempts: string;
}

/** The user's message, trimmed to something a search box would accept. A full
 *  paragraph makes a worse query than its own first sentence. */
function queryFrom(text: string): string {
  const firstSentence = text.split(/[.!?\n]/)[0]?.trim();
  const query = (firstSentence && firstSentence.length >= 8 ? firstSentence : text).trim();
  return query.slice(0, 200);
}

/**
 * Runs the search and returns what a prompt needs — never throws: a failed
 * or empty search means the model answers from its own knowledge, exactly as
 * it would have before this existed, not a broken turn.
 */
export async function liveSearchContext(
  text: string,
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<LiveSearchResult | null> {
  const query = queryFrom(text);
  if (!query) return null;

  try {
    const outcome = await search(query, options.limit ?? 5);
    if (!outcome.hits.length) return null;
    return { query, hits: outcome.hits, provider: outcome.provider, attempts: describeAttempts(outcome.attempts) };
  } catch {
    // search() itself already catches per-provider failures; this is the
    // floor under a provider throwing something the chain did not expect.
    return null;
  }
}

/** The block `buildSystemPrompt` appends — plain enough for every model this
 *  app talks to, none of which are guaranteed to support tool-call results. */
export function formatLiveSearch(result: LiveSearchResult): string {
  const lines = result.hits
    .map((h, i) => `${i + 1}. ${h.title} — ${h.url}\n   ${h.snippet || '(no summary given)'}`)
    .join('\n');
  return (
    `## LIVE SEARCH RESULTS for "${result.query}" (via ${result.provider})\n` +
    `These are current as of this turn, not from training data. Use them when they help, cite the URL when you rely on one, and say plainly if none of them actually answer the question rather than forcing a citation onto an unrelated result.\n\n${lines}`
  );
}
