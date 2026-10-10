/**
 * Review of what was just generated, by five independent reviewers, showing only what they are sure of.
 *
 * The five checks are the ones that catch what a build gets wrong: logic and syntax, security, whether it fits
 * the project (imports, names), style and structure, and whether the comments tell the truth. One model call plays
 * all five (a call per reviewer would repeat the whole project five times over), but each reviewer reports on its
 * own and gives every finding a confidence. Anything under the threshold is dropped, so what the user sees is
 * short and worth reading.
 */

export const REVIEW_CHECKS = [
  { id: 'bugs', label: 'Syntax and logic', ask: 'syntax errors, wrong logic, off-by-one, unhandled null/undefined, broken control flow, code that cannot run' },
  { id: 'security', label: 'Security', ask: 'leaked secrets or keys, injection (SQL, shell, HTML/XSS), unsafe eval, unvalidated input, insecure defaults' },
  { id: 'compat', label: 'Fits the project', ask: 'imports of files or packages that do not exist, wrong names or signatures, API misuse, mismatch with the other files shown' },
  { id: 'style', label: 'Style and structure', ask: 'duplicated code, dead code, needless complexity, naming that misleads, a file doing too many jobs' },
  { id: 'comments', label: 'Comments', ask: 'comments that are wrong, stale or contradict the code they sit above' },
] as const;

export type ReviewCheckId = (typeof REVIEW_CHECKS)[number]['id'];

export interface Finding {
  check: ReviewCheckId;
  file: string;
  line?: number;
  issue: string;
  /** 0-100: how sure the reviewer is that this is a real problem. */
  confidence: number;
  fix?: string;
}

export const MIN_CONFIDENCE = 80;
const MAX_CHARS = 26_000;
const SKIP = /(\.min\.(js|css)|package-lock\.json|yarn\.lock|\.lock$|\.svg$|\.(png|jpe?g|gif|webp|ico|mp3|wav|ogg|glb|gltf|zip|apk|jar|woff2?|ttf)$)/i;

export interface ReviewFile { path: string; content: string }

/** The files worth reading, trimmed to a budget: code first, small before large, binaries never. */
export function selectFiles(files: ReviewFile[], budget = MAX_CHARS): ReviewFile[] {
  const rank = (f: ReviewFile) => (/\.(tsx?|jsx?|py|kt|java|gd|rs|go|c|cpp|cs|html|css|json|ya?ml|sh|mjs|cjs)$/i.test(f.path) ? 0 : 1) * 1e7 + f.content.length;
  const out: ReviewFile[] = [];
  let used = 0;
  for (const f of [...files].filter((x) => typeof x.content === 'string' && !x.content.startsWith('data:') && !SKIP.test(x.path)).sort((a, b) => rank(a) - rank(b))) {
    const body = f.content.length > 9000 ? `${f.content.slice(0, 9000)}\n…(file continues)` : f.content;
    if (used + body.length > budget) continue;
    used += body.length;
    out.push({ path: f.path, content: body });
  }
  return out;
}

export function reviewPrompt(files: ReviewFile[]): { system: string; user: string } {
  const system = `You are five independent code reviewers working on the same files. Each reviewer looks ONLY for its own kind of problem:
${REVIEW_CHECKS.map((c, i) => `${i + 1}. "${c.id}" — ${c.label}: ${c.ask}.`).join('\n')}

Rules:
- Report a problem only if you can point at the file and say exactly what is wrong. No style opinions dressed up as bugs, no "consider…", no praise.
- Give every finding a confidence from 0 to 100: how sure you are that it is a real problem. If you are not at least 80 sure, leave it out or say so with a low number.
- Never report what the code does correctly. Fewer, real findings beat many guesses. An empty list is a good answer.
Reply with ONE JSON object and nothing else:
{"findings":[{"check":"bugs|security|compat|style|comments","file":"<path>","line":<number or null>,"issue":"<one sentence>","confidence":<0-100>,"fix":"<one short sentence, optional>"}]}`;
  const user = files.map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n');
  return { system, user };
}

/** The model's reply, read defensively: unknown checks, missing numbers and fenced JSON are all tolerated. */
export function parseReview(raw: string): Finding[] {
  const m = /\{[\s\S]*\}/.exec(raw ?? '');
  if (!m) return [];
  let data: unknown;
  try { data = JSON.parse(m[0]); } catch { return []; }
  const list = (data as { findings?: unknown }).findings;
  if (!Array.isArray(list)) return [];
  const ids = new Set<string>(REVIEW_CHECKS.map((c) => c.id));
  const out: Finding[] = [];
  for (const f of list.slice(0, 40)) {
    if (!f || typeof f !== 'object') continue;
    const r = f as Record<string, unknown>;
    const check = String(r.check ?? '');
    const issue = typeof r.issue === 'string' ? r.issue.trim() : '';
    const conf = Number(r.confidence);
    if (!ids.has(check) || !issue || !Number.isFinite(conf)) continue;
    out.push({
      check: check as ReviewCheckId,
      file: typeof r.file === 'string' ? r.file : '',
      ...(Number.isFinite(Number(r.line)) && r.line !== null ? { line: Number(r.line) } : {}),
      issue: issue.slice(0, 280),
      confidence: Math.max(0, Math.min(100, Math.round(conf))),
      ...(typeof r.fix === 'string' && r.fix.trim() ? { fix: r.fix.trim().slice(0, 220) } : {}),
    });
  }
  return out;
}

/** What the user is shown: only findings the reviewer is at least `min` sure of, sure ones first, same issue once. */
export function sure(findings: Finding[], min = MIN_CONFIDENCE): Finding[] {
  const seen = new Set<string>();
  return findings
    .filter((f) => f.confidence >= min)
    .sort((a, b) => b.confidence - a.confidence)
    .filter((f) => {
      const key = `${f.file}:${f.line ?? ''}:${f.issue.toLowerCase().slice(0, 60)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function renderReview(all: Finding[], filesChecked: number, min = MIN_CONFIDENCE): string {
  const shown = sure(all, min);
  const held = all.length - all.filter((f) => f.confidence >= min).length;
  if (!shown.length) {
    return `::shield:: Reviewed ${filesChecked} file${filesChecked === 1 ? '' : 's'} (bugs, security, fit, style, comments): nothing I am ${min}% sure of.${held ? ` ${held} weaker guess${held === 1 ? '' : 'es'} left out.` : ''}`;
  }
  const label = (id: ReviewCheckId) => REVIEW_CHECKS.find((c) => c.id === id)?.label ?? id;
  const lines = shown.map((f) => `- **${label(f.check)}** · \`${f.file || 'project'}${f.line ? `:${f.line}` : ''}\` · ${f.confidence}% — ${f.issue}${f.fix ? ` _Fix: ${f.fix}_` : ''}`);
  return `::shield:: **Review: ${shown.length} issue${shown.length === 1 ? '' : 's'} I am ${min}%+ sure of** (${filesChecked} file${filesChecked === 1 ? '' : 's'} checked)\n\n${lines.join('\n')}\n\nSay "fix these" and they are fixed.`;
}
