/**
 * Which skill from the library a request needs, and why.
 *
 * Deterministic: words in the request are weighed against each skill's keywords by how rare they are across the
 * whole library (a skill about "kubernetes" is matched by the word kubernetes, not by "build"), plus a short list of
 * everyday situations that call for a working-method skill — an error to debug, a test to write, a diff to review.
 */
import type { LibIndex, LibSkill } from './types.ts';

const stem = (w: string): string => {
  let r = w;
  if (/ies$/.test(r)) r = r.replace(/ies$/, 'y');
  else if (/(ing|ed)$/.test(r) && r.length > 5) r = r.replace(/(ing|ed)$/, '');
  else if (/s$/.test(r) && !/ss$/.test(r) && r.length > 3) r = r.replace(/s$/, '');
  return r.replace(/(.)\1$/, '$1');
};
const STOP = new Set(['this', 'that', 'with', 'from', 'your', 'when', 'will', 'have', 'into', 'them', 'then', 'than', 'also', 'make', 'need', 'want', 'work', 'like', 'just', 'very', 'much', 'some', 'what', 'banao', 'karo', 'mujhe', 'chahiye', 'mera', 'meri', 'liye', 'wala', 'wali', 'create', 'build', 'please', 'using', 'write', 'code', 'file', 'files', 'build']);
export const tokens = (s: string): string[] => [...new Set((s.toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) ?? []).map((w) => w.replace(/[.-]+$/, '')).filter((w) => w.length >= 3 && !STOP.has(w)).map(stem))];

/** Everyday situations → the working-method skill that answers them. */
const SITUATIONS: Array<[RegExp, string]> = [
  [/\b(error|exception|traceback|stack ?trace|crash(es|ed|ing)?|bug|broken|not working|doesn'?t work|fails?|failing|failed|regression|segfault|undefined is not|kaam nahi|chal nahi|nahi chal)\b/i, 'systematic-debugging'],
  [/\b(tdd|unit tests?|write tests?|test[- ]first|test coverage|add tests?|failing test)\b/i, 'test-driven-development'],
  [/\b(code review|review (my|this|the) (code|pr|diff|pull request|changes)|pull request review|pr review)\b/i, 'requesting-code-review'],
  [/\b(review comments?|reviewer (said|asked|wants)|address (the )?feedback|pr feedback)\b/i, 'receiving-code-review'],
  [/\b(brainstorm|not sure what to build|ideas? for|options? for|kya banau|suggest (an )?idea)\b/i, 'brainstorming'],
  [/\b(implementation plan|step[- ]by[- ]step plan|roadmap|plan (out|the)|break (it )?down into)\b/i, 'writing-plans'],
  [/\b(claude api|anthropic (api|sdk)|messages api|tool use|prompt caching)\b/i, 'claude-api'],
  [/\b(playwright|e2e|end[- ]to[- ]end test|browser test|test (the|my) (web ?app|site|page)|ui test)\b/i, 'webapp-testing'],
  [/\b(status update|newsletter|company update|internal (comms|communication)|3p update|leadership update)\b/i, 'internal-comms'],
  [/\b(write|create|make|author) (a |new )?skill\b/i, 'skill-creator'],
];

export interface LibPick { id: string; why: string; score: number }

export function pickSkills(
  request: string,
  index: LibIndex,
  opts: { force?: string[]; max?: number; exclude?: Set<string> } = {},
): LibPick[] {
  const byId = new Map(index.skills.map((s) => [s.id, s]));
  const picks: LibPick[] = [];
  for (const id of opts.force ?? []) if (byId.has(id)) picks.push({ id, why: 'you asked for it by name', score: 99 });
  if (picks.length) return picks.slice(0, 3);

  const max = opts.max ?? 2;
  const req = new Set(tokens(request));
  if (!req.size) return [];

  // How rare each keyword is across the library: rare words carry the meaning.
  const df = new Map<string, number>();
  for (const s of index.skills) for (const k of new Set(s.kw.map(stem))) df.set(k, (df.get(k) ?? 0) + 1);
  const n = index.skills.length;

  const scored: LibPick[] = [];
  for (const s of index.skills) {
    if (opts.exclude?.has(s.id)) continue;
    const idWords = new Set(s.id.split('-').map(stem).filter((w) => w.length >= 2));
    let score = 0;
    let idHits = 0;
    const hits: string[] = [];
    for (const k of new Set(s.kw.map(stem))) {
      if (!req.has(k)) continue;
      const idf = Math.log(n / (df.get(k) ?? 1));
      if (idf < 1.4) continue; // a word a quarter of the library shares says nothing
      // A word in the skill's own name is worth far more than one somewhere in its description.
      const inName = idWords.has(k);
      score += inName ? idf * 2.5 : idf;
      if (inName) idHits += 1;
      hits.push(k);
    }
    if (idWords.size >= 2 && [...idWords].every((w) => req.has(w) || w.length < 3)) { score += 8; hits.unshift(s.id); }
    // Named by the request (one name word, or two description words) — and enough weight that it is not a coincidence.
    if ((idHits >= 1 || hits.length >= 3) && score >= 10) scored.push({ id: s.id, why: `it matches ${hits.slice(0, 3).join(', ')}`, score });
  }

  const found = new Map<string, LibPick>();
  for (const [re, id] of SITUATIONS) {
    if (re.test(request) && byId.has(id) && !opts.exclude?.has(id)) found.set(id, { id, why: 'this is the situation it is for', score: 30 });
  }
  for (const p of scored) if (!found.has(p.id)) found.set(p.id, p);
  // One working-method skill at most (how to go about it) and the best topic skills (what it is about): they answer
  // different questions, so a strong method match must not push the topic out.
  const all = [...found.values()].sort((a, b) => b.score - a.score);
  const method = all.filter((p) => byId.get(p.id)?.process).slice(0, 1);
  const topics = all.filter((p) => !byId.get(p.id)?.process);
  // The runner-up topic has to be nearly as good as the best one, or it is just noise sharing a word.
  const topical = topics.filter((p, i) => i === 0 || p.score >= topics[0]!.score * 0.62);
  return [...method, ...topical].slice(0, max);
}

export function searchSkills(query: string, index: LibIndex, limit = 10): LibSkill[] {
  const q = new Set(tokens(query));
  const text = query.toLowerCase().trim();
  if (!q.size && !text) return [];
  return index.skills
    .map((s) => {
      let score = s.id.includes(text) ? 6 : 0;
      for (const k of s.kw.map(stem)) if (q.has(k)) score += 2;
      for (const w of q) if (s.description.toLowerCase().includes(w)) score += 1;
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.s);
}
