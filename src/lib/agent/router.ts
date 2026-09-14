/**
 * Lane classifier.
 *
 * Lane A = technical discourse. Lane B = autonomous execution.
 *
 * A model round-trip on every keystroke-length prompt is wasteful, so this runs
 * a deterministic scorer first and only escalates genuinely ambiguous prompts to
 * a model. ~90% of real traffic is decided locally in microseconds.
 */

export type Lane = 'A' | 'B';

export interface Classification {
  lane: Lane;
  confidence: number;
  reason: string;
  /** Suite the prompt most likely belongs to, if any. */
  suite?: string;
  /** Set when the deterministic pass was inconclusive. */
  needsModel?: boolean;
}

/** Verbs that describe producing an artifact. */
const BUILD_VERBS =
  /\b(build|create|make|generate|scaffold|implement|compile|package|bundle|deploy|export|convert|port|migrate|refactor|fix|add|write|set ?up|wire ?up|install|initialize|init|produce|render|publish|ship|banao|bana|karo|kardo)\b/i;

/** Nouns that name a deliverable. */
const ARTIFACT_NOUNS =
  /\b(apk|aab|app|application|component|module|endpoint|api|service|server|page|screen|deck|slide|presentation|pdf|spreadsheet|mcpack|mcaddon|addon|behaviou?r ?pack|resource ?pack|model|mesh|geometry|blockbench|mcp ?server|skill|script|zip|archive|repo|project|website|site|landing ?page|dashboard|test|suite|pipeline|workflow|docker|schema|migration)\b/i;

/** Pure-discussion signals. */
const INQUIRY_MARKERS =
  /^(what|why|how come|when|which|who|where|is|are|does|do|can|could|should|would|explain|compare|describe|tell me|difference|kya|kyu|kyun|kaise|kaisa|matlab|batao|samjhao)\b/i;

const EXPLAIN_MARKERS =
  /\b(explain|what is|what are|difference between|pros and cons|trade-?offs?|best practice|should i|which is better|how does .* work|why does|why is)\b/i;

/** Slash commands are unambiguous execution intent. */
const EXECUTION_SLASH = new Set([
  'make-apk',
  'deploy',
  'build-mcpack',
  'build-addon',
  'jar-to-bedrock',
  'exe-to-apk',
  'audit-code',
  'build-mcp',
  'make-deck',
  'make-pdf',
  'gen-image',
  'research',
  'zip',
  'test',
]);

const SUITE_HINTS: Array<[RegExp, string]> = [
  [/\b(apk|aab|android|gradle|jetpack ?compose|exe|\.exe|desktop app|electron|winforms|wpf|tkinter|pyqt)\b/i, 'android'],
  [/\b(minecraft|bedrock|mcpack|mcaddon|blockbench|behaviou?r ?pack|resource ?pack|\.jar mod|forge|fabric|voxel)\b/i, 'minecraft'],
  [/\b(godot|gdscript|\.tscn|game ?engine|platformer|(3d|2d) ?game|game ?jam|player ?controller)\b/i, 'godot'],
  [/\b(deck|slide|presentation|pitch|pdf|spreadsheet|landing ?page|canvas|mockup|poster|figma)\b/i, 'studio'],
  [/\b(mcp|model context protocol|tool schema|resource definition|stdio server)\b/i, 'mcp'],
  [/\b(research|investigate|find out|sources|cite|literature|competitor|market|deadline|milestone|schedule)\b/i, 'workdrive'],
  [/\b(skill|slash command|custom command|palette)\b/i, 'skills'],
];

/**
 * Whether the thing being asked for is a website.
 *
 * Websites arrive in ordinary chat — "make me a 3D landing page" — rather than
 * through a suite, so the web contract has to be attached by what is being
 * built. Deliberately requires an actual build verb near a web noun: a question
 * *about* CSS is not a request for a site, and answering it with a full page is
 * as wrong as the reverse.
 */
const SITE_NOUN = /\b(website|web ?site|web ?page|webpage|landing ?page|portfolio|homepage|one[- ]?pager|web ?app|site)\b/i;
const SITE_VERB = /\b(build|make|create|generate|design|code|write|bana|banao|chahiye|redesign|rebuild|clone)\b/i;
const SITE_TECH = /\b(three\.?js|webgl|3d (site|website|page|scene|landing)|parallax|scroll[- ]animation|glsl|shader)\b/i;

export function wantsSite(text: string): boolean {
  if (SITE_TECH.test(text) && SITE_NOUN.test(text)) return true;
  return SITE_NOUN.test(text) && SITE_VERB.test(text);
}

export function detectSuite(text: string): string | undefined {
  for (const [re, suite] of SUITE_HINTS) if (re.test(text)) return suite;
  return undefined;
}

export function classifyLocal(input: string, opts: { hasAttachments?: boolean } = {}): Classification {
  const text = input.trim();
  const suite = detectSuite(text);

  if (!text) return { lane: 'A', confidence: 1, reason: 'Empty prompt.' };

  // 1. Slash commands short-circuit everything.
  const slash = /^\/([a-z0-9-]+)/i.exec(text);
  if (slash) {
    const cmd = slash[1].toLowerCase();
    if (EXECUTION_SLASH.has(cmd)) {
      return { lane: 'B', confidence: 1, reason: `Slash command /${cmd} is an execution skill.`, suite };
    }
    return { lane: 'A', confidence: 0.8, reason: `Slash command /${cmd} is informational.`, suite };
  }

  let score = 0;
  const reasons: string[] = [];

  const hasVerb = BUILD_VERBS.test(text);
  const hasNoun = ARTIFACT_NOUNS.test(text);

  if (hasVerb && hasNoun) {
    score += 3;
    reasons.push('you asked for something to be built');
  } else if (hasVerb) {
    score += 1.5;
    reasons.push('phrased as an instruction');
  } else if (hasNoun) {
    score += 0.5;
    reasons.push('mentions something buildable');
  }

  if (INQUIRY_MARKERS.test(text)) {
    score -= 2.5;
    reasons.push('opens as a question');
  }
  if (EXPLAIN_MARKERS.test(text)) {
    score -= 2;
    reasons.push('asks for an explanation');
  }
  if (text.endsWith('?') && !hasVerb) {
    score -= 1.5;
    reasons.push('ends in a question mark');
  }
  if (opts.hasAttachments) {
    score += 1;
    reasons.push('files attached');
  }
  // Multi-clause imperatives ("do X, then Y and Z") are almost always work orders.
  if (/\b(then|after that|and then|uske baad|phir)\b/i.test(text) && hasVerb) {
    score += 1;
    reasons.push('lists steps to carry out');
  }
  // A pasted error or stack trace is someone asking for it to be fixed, even
  // when the message around it is only a few words.
  if (/\b(error|exception|traceback|stack ?trace|failed|cannot find|undefined is not|NullPointer|SyntaxError)\b/i.test(text)) {
    score += 1;
    reasons.push('contains an error to fix');
  }

  // Long prompts with requirement lists are specs, not questions.
  if (text.length > 400 && /(\n\s*[-*\d]|\brequirements?\b|\bmust\b|\bshould\b)/i.test(text)) {
    score += 1.5;
    reasons.push('reads like a spec');
  }

  const lane: Lane = score >= 2 ? 'B' : 'A';
  const margin = Math.abs(score - 2);
  const confidence = Math.min(0.98, 0.5 + margin / 5);

  const because = reasons.length ? reasons.join(', ') : 'nothing here asks for a build';
  return {
    lane,
    confidence,
    // Leads with the action so the line answers "what is it about to do?".
    reason: lane === 'B' ? `building it — ${because}` : `answering directly — ${because}`,
    suite,
    needsModel: margin < 0.75,
  };
}

/** Prompt used when the local scorer is inconclusive. */
export const CLASSIFIER_PROMPT = `You are an intent router. Reply with ONE JSON object and nothing else:
{"lane":"A"|"B","reason":"<12 words max>"}

"B" = the user wants an artifact produced, code written, something compiled, packaged, deployed, converted, or a multi-step build executed.
"A" = the user wants an explanation, comparison, opinion, review, or discussion.

Ambiguity rule: if the user would be annoyed by receiving a wall of generated files, answer "A".`;

export async function classifyWithModel(
  input: string,
  complete: (messages: Array<{ role: 'system' | 'user'; content: string }>) => Promise<string>,
): Promise<Classification | null> {
  try {
    const raw = await complete([
      { role: 'system', content: CLASSIFIER_PROMPT },
      { role: 'user', content: input.slice(0, 4000) },
    ]);
    const match = /\{[\s\S]*\}/.exec(raw);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as { lane?: string; reason?: string };
    if (parsed.lane !== 'A' && parsed.lane !== 'B') return null;
    return {
      lane: parsed.lane,
      confidence: 0.85,
      reason: parsed.reason ?? 'model-classified',
      suite: detectSuite(input),
    };
  } catch {
    return null;
  }
}

/**
 * Full classification: deterministic first, model only when it matters.
 * Falls back to the local verdict if the model round-trip fails — routing must
 * never be the thing that breaks a request.
 */
export async function classify(
  input: string,
  opts: {
    hasAttachments?: boolean;
    complete?: (messages: Array<{ role: 'system' | 'user'; content: string }>) => Promise<string>;
  } = {},
): Promise<Classification> {
  const local = classifyLocal(input, opts);
  if (!local.needsModel || !opts.complete) return local;

  const remote = await classifyWithModel(input, opts.complete);
  return remote ?? local;
}
