/**
 * Lane classifier.
 *
 * Lane A = technical discourse. Lane B = autonomous execution.
 *
 * A model round-trip on every keystroke-length prompt is wasteful, so this runs
 * a deterministic scorer first and only escalates genuinely ambiguous prompts to
 * a model. ~90% of real traffic is decided locally in microseconds.
 */

import { looksLikeGame } from '../suites/godot/plan.ts';

export type Lane = 'A' | 'B';

export interface Classification {
  lane: Lane;
  confidence: number;
  reason: string;
  /** Suite the prompt most likely belongs to, if any. */
  suite?: string;
  /** Work on the machine itself (install, download, run): no plan, no research, just the commands. */
  ops?: boolean;
  /** Set when the deterministic pass was inconclusive. */
  needsModel?: boolean;
}

/** Verbs that describe producing an artifact. */
const BUILD_VERBS =
  /\b(build|create|make|generate|scaffold|implement|compile|package|bundle|deploy|export|convert|port|migrate|refactor|fix|add|write|set ?up|wire ?up|install|initialize|init|produce|render|publish|ship|banao|bana|karo|kardo)\b/i;

/** Nouns that name a deliverable. */
const ARTIFACT_NOUNS =
  /\b(apk|aab|app|application|component|module|endpoint|api|service|server|page|screen|deck|slide|presentation|pdf|spreadsheet|mcpack|mcaddon|addon|behaviou?r ?pack|resource ?pack|model|mesh|geometry|blockbench|mcp ?server|skill|script|zip|archive|repo|project|website|site|landing ?page|dashboard|test|suite|pipeline|workflow|docker|schema|migration|game|level|character|videos?|reels?|promo|slideshow)\b/i;

/** Pure-discussion signals. */
const INQUIRY_MARKERS =
  /^(what|why|how come|when|which|who|where|is|are|does|do|can|could|should|would|explain|compare|describe|tell me|difference|kya|kyu|kyun|kaise|kaisa|matlab|batao|samjhao)\b/i;

const EXPLAIN_MARKERS =
  /\b(explain|what is|what are|difference between|pros and cons|trade-?offs?|best practice|should i|which is better|how does .* work|why does|why is)\b/i;

/** Slash commands are unambiguous execution intent. */
const EXECUTION_SLASH = new Set([
  'use',
  'od',
  'opendesign',
  'open-design',
  'make-apk',
  'deploy',
  'build-mcpack',
  'build-addon',
  'jar-to-bedrock',
  'exe-to-apk',
  'audit-code',
  'build-game',
  'make-deck',
  'make-pdf',
  'gen-image',
  'research',
  'zip',
  'test',
]);

/**
 * Asking for something to be done on the machine: "download godot on the terminal", "terminal me install karo".
 * This is work, not conversation — the answer is a command that runs, not a command pasted into chat.
 */
const TERMINAL_WORDS = /\b(terminal|shell|bash|cmd|command ?line|bridge|ssh|apt(-get)?|pip3?|npm|curl|wget|chmod|unzip|sudo)\b/i;
const MACHINE_VERBS =
  /\b(download|donload|downlod|dowload|donlod|dwnld|install|uninstall|setup|set ?up|run|execute|start|launch|clone|pull|fetch|update|upgrade|kheech|kheecho|utaro|utar|chala|chalao|laga|lagao|dalo|karo|kar do|kardo)\b/i;
const MACHINE_THINGS = /\b(godot|gradle|java|jdk|node|python|android ?sdk|sdk|adb|docker|git|ffmpeg|package|toolchain|engine|tool)\b/i;
const HAS_URL = /https?:\/\/\S+|drive\.google\.com\/\S+/i;

export function wantsTerminal(text: string): boolean {
  if (INQUIRY_MARKERS.test(text.trim()) && !MACHINE_VERBS.test(text)) return false;
  if (TERMINAL_WORDS.test(text) && MACHINE_VERBS.test(text)) return true;
  return MACHINE_VERBS.test(text) && MACHINE_THINGS.test(text) && /\b(download|donload|downlod|dowload|donlod|dwnld|install|setup|set ?up|kheech\w*|utar\w*|laga\w*)\b/i.test(text);
}

/** "Ha", "ok bro", "ya wala bro", a bare link: a reply to work already under way, not a new topic. */
export function isFollowUp(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (HAS_URL.test(t) && t.length < 400) return true;
  return t.length <= 60 && !t.includes('\n') && !/\?\s*$/.test(t);
}

const SUITE_HINTS: Array<[RegExp | ((text: string) => boolean), string]> = [
  // "a 3D game for Android" is a game, not a native Android project: the word "android" must not win over "game".
  [(text) => wantsGame(text) && !MINECRAFT_EXPLICIT.test(text), 'godot'],
  [/\b(apk|aab|android|gradle|jetpack ?compose|exe|\.exe|desktop app|electron|winforms|wpf|tkinter|pyqt)\b/i, 'android'],
  [/\b(minecraft|bedrock|mcpack|mcaddon|blockbench|behaviou?r ?pack|resource ?pack|\.jar mod|forge|fabric|voxel)\b/i, 'minecraft'],
  // Games are matched by the planner's own genre vocabulary rather than a
  // second list here. Two lists drift, and the drift is silent: "zombie
  // survival shooter" planned perfectly as a shooter and never reached the
  // suite, because this file only knew "first person shooter".
  [looksLikeGame, 'godot'],
  [/\b(deck|slide|presentation|pitch|pdf|spreadsheet|landing ?page|canvas|mockup|poster|figma)\b/i, 'studio'],
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

/** An APK, a Gradle project or an Android app is named outright as the thing wanted. */
const ANDROID_DELIVERABLE = /\b(apk|aab|gradle)\b|\bandroid\s+(app|application|project)\b/i;
/** Words that only mean the Bedrock suite — "forge", "fabric" and "voxel" mean other things too. */
const MINECRAFT_EXPLICIT = /\b(minecraft|bedrock|mcpack|mcaddon|blockbench)\b/i;
/** "runner" alone is a test runner or a task runner; a game has to say so. */
const GAME_EXPLICIT = /\b(games?|godot|gdscript)\b/i;

/**
 * The suite a run belongs to.
 *
 * A prompt typed straight into chat — "make me an Android app", "build a
 * zombie shooter game" — was classified as belonging to a suite and then run as
 * plain chat anyway: the suite's contract (toolchain versions, icon rules, the
 * Godot rules) is attached by suite, and the detected one was never used. Only
 * a slash command or switching tabs applied it, so the same request built
 * properly from one place and not from the other.
 *
 * Call this with what the user typed, never with a skill's expanded template:
 * a template is full of words ("runner", "pack") that mean something else.
 *
 * Only the default chat view adopts a detected suite, and only for a build —
 * a question that mentions Android stays a question. A website wins over
 * "Minecraft" or a game genre ("a Minecraft-themed website" is not a Bedrock
 * add-on), but an explicit APK/Android-app request wins over a website.
 */
export function resolveSuite(base: string, input: string, lane: Lane): string {
  // The Game Studio tab is where games are made, so a build typed there is a game build. Without this the
  // tab's own name ("game") never matched the suite the game pipeline runs under ("godot"), and a request such
  // as "a 3D game for Android" was written as a plain Android project instead — no plan, no Godot rules, no check.
  // Installing or downloading Godot is a job for the terminal, not a game to be designed.
  if (wantsTerminal(input) && !ANDROID_DELIVERABLE.test(input)) return base;
  if (base === 'game') return lane === 'B' ? 'godot' : base;
  if (base !== 'chat' || lane !== 'B') return base;
  if (wantsGame(input) && !wantsSite(input) && !MINECRAFT_EXPLICIT.test(input)) return 'godot';
  if (ANDROID_DELIVERABLE.test(input)) return 'android';
  if (wantsSite(input)) return base;
  const detected = detectSuite(input);
  if (detected === 'minecraft' && MINECRAFT_EXPLICIT.test(input)) return 'minecraft';
  if (detected === 'godot' && GAME_EXPLICIT.test(input)) return 'godot';
  return base;
}

/**
 * A game, even one said to be "for Android" or shipped as an APK — Godot exports those. Only a request that names
 * the native toolchain (Gradle, Kotlin, Jetpack, Android Studio) is a native Android project.
 */
const ANDROID_NATIVE = /\b(gradle|kotlin|jetpack|compose|android studio|xml layout|java)\b/i;
export function wantsGame(text: string): boolean {
  return GAME_EXPLICIT.test(text) && looksLikeGame(text) && !ANDROID_NATIVE.test(text);
}

export function detectSuite(text: string): string | undefined {
  for (const [match, suite] of SUITE_HINTS) {
    if (typeof match === 'function' ? match(text) : match.test(text)) return suite;
  }
  return undefined;
}

export function classifyLocal(
  input: string,
  opts: { hasAttachments?: boolean; previousLane?: Lane; previousOps?: boolean } = {},
): Classification {
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

  // 2. Work on the machine itself, and the short replies that carry it on ("Ha", a link, "ok bro").
  if (wantsTerminal(text)) {
    return { lane: 'B', confidence: 0.95, reason: 'running it on the terminal — this is work, not a question', ops: true };
  }
  if (opts.previousLane === 'B' && isFollowUp(text) && !INQUIRY_MARKERS.test(text)) {
    return { lane: 'B', confidence: 0.85, reason: 'carrying on the task already under way', suite: opts.previousOps ? undefined : suite, ops: opts.previousOps };
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
  // Naming a suite is itself a statement of intent: nobody describes a zombie
  // shooter or a Bedrock add-on in order to have it discussed. Without this,
  // "a zombie survival shooter called Chomu Game" scored zero — no build verb
  // anywhere in it — and came back as conversation.
  if (suite) {
    score += 1.5;
    reasons.push(`it names something the ${suite} suite builds`);
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
