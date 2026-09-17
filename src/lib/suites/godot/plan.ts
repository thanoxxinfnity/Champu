/**
 * Deciding what the game *is*, before any of it is written.
 *
 * Going straight from "make me a ninja game" to files produces the same game
 * every time — a character on a flat plane with a joystick — because that is
 * what the scene template has. The prompt's actual content never reaches the
 * output, and the user gets something that ignores what they asked for.
 *
 * So the prompt is read first, into a plan: genre, camera, what the player is,
 * what else is in the world, how you win. The plan is then what gets built, and
 * it is shown to the user before anything is written, so a wrong reading is
 * caught in a sentence rather than in a zip.
 *
 * Deliberately deterministic — no model call. The reading has to be the same
 * every time for the same prompt, and it has to work when nothing is reachable.
 * A language model elaborates *on top of* this plan; it does not replace it.
 *
 * Every guess the prompt did not answer is recorded in `assumptions` rather
 * than made silently, because a silent guess is indistinguishable from a bug.
 */

import { bodyPlan, inferPlan, type BodyPlan, type PartSpec } from '../minecraft/geometry.ts';

export type Genre = 'platformer' | 'runner' | 'shooter' | 'racing' | 'puzzle' | 'top-down' | 'survival' | 'adventure' | 'open-world';
export type View = 'third-person' | 'first-person' | 'top-down' | 'side-on';

export interface PlannedEntity {
  name: string;
  role: 'enemy' | 'pickup' | 'obstacle' | 'npc';
  description: string;
  body: BodyPlan;
}

export interface GamePlan {
  name: string;
  genre: Genre;
  view: View;
  dimension: '2d' | '3d';
  /** How the player wins, in one sentence. */
  goal: string;
  player: { description: string; body: BodyPlan };
  entities: PlannedEntity[];
  /** What the game does, as verbs. Drives which scripts get written. */
  mechanics: string[];
  /** How it is played on a phone. */
  controls: string[];
  /** Anything the prompt did not say, that had to be decided. */
  assumptions: string[];
}

/**
 * Genre cues, most specific first — "endless runner" is a runner, not a
 * platformer.
 *
 * Exported because the router matches on them too. Two lists of game words
 * drift: "zombie survival shooter" planned perfectly as a shooter and never
 * reached the suite at all, because the router only knew "first person
 * shooter". One list cannot disagree with itself.
 */
export const GENRE_CUES: Array<[Genre, RegExp]> = [
  // Before racing, deliberately. "GTA" is the clearest statement of intent
  // anyone gives this suite, and it contains a car — matched as racing it
  // became a lap circuit, which is the one thing GTA is not. "Forza Horizon"
  // is the same shape of mistake with a different franchise: it is a
  // free-roam open map you drive around, not a closed circuit, and "horizon"
  // named the wrong genre entirely — matched as neither cue it fell through
  // to "adventure" and built a walking character with no car at all.
  ['open-world', /\b(gta|grand theft|open[- ]?world|sandbox city|free roam|freeroam|city game|drive around|forza)\b/],
  ['racing', /\b(racing|race|kart|rally|drift|lap|circuit|car game|bike game|need for speed|nfs|gran turismo|motorsport)\b/],
  ['runner', /\b(runner|endless|infinite|temple run|subway|auto[- ]?run|dodge obstacles)\b/],
  ['shooter', /\b(shooter|shooting|fps|gun|shoot|blaster|bullet|turret|arena)\b/],
  ['puzzle', /\b(puzzle|match|sudoku|riddle|maze|sokoban|tile|block game|brain)\b/],
  ['survival', /\b(survival|survive|craft|crafting|hunger|base building|zombie|horde|wave)\b/],
  ['platformer', /\b(platformer|platform|jump|jumping|mario|parkour|climb|ledge)\b/],
  ['top-down', /\b(top[- ]?down|bird'?s eye|overhead|twin[- ]?stick|rogue|dungeon crawl)\b/],
  ['adventure', /\b(adventure|explore|exploration|quest|story|rpg|open world)\b/],
];

/** The camera a genre wants, unless the prompt says otherwise. */
const VIEW_FOR: Record<Genre, View> = {
  platformer: 'side-on',
  runner: 'third-person',
  shooter: 'first-person',
  racing: 'third-person',
  puzzle: 'top-down',
  'top-down': 'top-down',
  survival: 'third-person',
  adventure: 'third-person',
  'open-world': 'third-person',
};

const MECHANICS_FOR: Record<Genre, string[]> = {
  platformer: ['Run and jump between platforms', 'Fall off and restart from the last checkpoint', 'Collect pickups along the way'],
  runner: ['Run forward automatically, faster over time', 'Swipe or steer to dodge obstacles', 'Score counts distance survived'],
  shooter: ['Aim and fire at enemies', 'Enemies spawn in waves and chase', 'Health drops when they reach you'],
  racing: ['Accelerate, brake and steer', 'Lap a circuit against the clock', 'Going off the track slows you down'],
  puzzle: ['Pick up and place pieces', 'A level is solved when the goal state is reached', 'Move count is scored'],
  survival: ['Gather resources from the world', 'Enemies arrive in waves after dark', 'Health and hunger drain over time'],
  'top-down': ['Move in any direction', 'Fight or avoid what wanders the level', 'Find the exit to reach the next room'],
  adventure: ['Explore a connected world', 'Talk to characters and pick up items', 'Reach the objective to finish'],
  'open-world': [
    'Walk anywhere in the city, camera orbiting behind you',
    'Get into a parked car and drive it',
    'Missions given out around the map, in any order',
  ],
};

const GOAL_FOR: Record<Genre, string> = {
  platformer: 'Reach the end of the level without falling.',
  runner: 'Run as far as possible without hitting anything.',
  shooter: 'Clear every wave of enemies without losing all health.',
  racing: 'Finish the laps in the best time.',
  puzzle: 'Solve each level in as few moves as possible.',
  survival: 'Stay alive through the night.',
  'top-down': 'Reach the exit of every room.',
  adventure: 'Finish the quest.',
  'open-world': 'Run the city: take the jobs, drive what you find, stay standing.',
};

const CONTROLS_FOR: Record<View, string[]> = {
  'third-person': ['Left thumb stick to move', 'Tap the right side to jump', 'Drag the right side to swing the camera'],
  'first-person': ['Left thumb stick to move', 'Drag the right side to look', 'Tap to fire'],
  'top-down': ['Left thumb stick to move', 'Tap a tile to act on it'],
  'side-on': ['Left thumb stick to run', 'Tap the right side to jump'],
};

/** What the prompt is asking for, as a genre. */
export function inferGenre(prompt: string): { genre: Genre; stated: boolean } {
  const text = prompt.toLowerCase();
  for (const [genre, cue] of GENRE_CUES) {
    if (cue.test(text)) return { genre, stated: true };
  }
  // Third-person adventure is the safest default: it is the genre whose
  // template — a character, a world, a goal — is closest to every other one.
  return { genre: 'adventure', stated: false };
}

/** The camera, preferring anything the prompt actually said. */
export function inferView(prompt: string, genre: Genre): { view: View; stated: boolean } {
  const text = prompt.toLowerCase();
  if (/\b(first[- ]?person|fps|through (his|her|their|the character'?s) eyes)\b/.test(text)) {
    return { view: 'first-person', stated: true };
  }
  if (/\b(third[- ]?person|over the shoulder|behind the (player|character))\b/.test(text)) {
    return { view: 'third-person', stated: true };
  }
  if (/\b(top[- ]?down|bird'?s eye|overhead)\b/.test(text)) return { view: 'top-down', stated: true };
  if (/\b(side[- ]?(on|scroll|scroller|view)|2\.5d|sidescrolling)\b/.test(text)) return { view: 'side-on', stated: true };
  return { view: VIEW_FOR[genre], stated: false };
}

/** 2D only when the prompt asks for it; Godot's 3D nodes are what the suite writes. */
export function inferDimension(prompt: string): { dimension: '2d' | '3d'; stated: boolean } {
  const text = prompt.toLowerCase();
  if (/\b2d\b|\bpixel art\b|\bsprite\b|\btop[- ]?down 2d\b/.test(text)) return { dimension: '2d', stated: true };
  if (/\b3d\b|\bthree[- ]?d\b/.test(text)) return { dimension: '3d', stated: true };
  return { dimension: '3d', stated: false };
}

/**
 * A name for the project.
 *
 * Taken from the prompt where the user gave one — "a game called Sky Runner" —
 * because a project named after the first three words of a sentence is the kind
 * of detail that makes generated work feel generated.
 */
export function inferName(prompt: string): { name: string; stated: boolean } {
  // Quotes bound the name exactly, so try them first and trust them fully.
  const bare = /["“']([^"”']{2,40})["”']/.exec(prompt);
  if (bare) return { name: titleCase(bare[1].trim()), stated: true };

  // `named` has to precede `name` in the alternation, or "named Sky Dash" matches
  // the `name` branch and the title comes out as "D Sky Dash". Hinglish asks for
  // it as often as English does — "name Chomu Game", "iska naam Chomu Game" —
  // and without those the name is thrown away and the fallback picks adjectives.
  // The lookbehind keeps the bare `name` branch imperative: "name Chomu Game" is
  // a title, "a name generator for levels" is a feature, and without it the
  // second one named the project "Generator".
  const quoted =
    /(?:called|named|titled|naam|(?<!\b(?:a|an|the|any|no|its|his|her|their|new)\s)name)\s+([^"”'.,\n]{2,60})/i
      .exec(prompt);
  if (quoted) {
    // "called Sky Dash where a ninja dodges robots" — the name is the first few
    // words, and the clause after it is the rest of the sentence. Without a
    // boundary the project ends up named after the whole prompt.
    const words = quoted[1].trim().split(/\s+/);
    const name: string[] = [];
    for (const word of words) {
      if (NAME_BOUNDARY.has(word.toLowerCase()) || name.length >= 4) break;
      name.push(word);
    }
    if (name.length) return { name: titleCase(name.join(' ')), stated: true };
  }

  // Fall back to the nouns that carry the idea, not the first words of the
  // sentence — "make me a" is not a title.
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  const picked = words.slice(0, 2);
  return { name: picked.length ? titleCase(picked.join(' ')) : 'Chomugiri Game', stated: false };
}

/** Words that end a title and start a clause about it. */
const NAME_BOUNDARY = new Set([
  'where', 'which', 'that', 'with', 'in', 'on', 'about', 'for', 'and', 'when', 'while',
  'you', 'the', 'a', 'an', 'set', 'featuring', 'starring',
  // Hinglish puts the verb after the name — "naam Chomu Game hai", "naam Chomu
  // Game rakho" — so without these the copula ends up inside the title.
  'hai', 'hain', 'ha', 'ho', 'hoga', 'rakho', 'rakh', 'rakhna', 'do', 'dena', 'de',
]);

const STOP_WORDS = new Set([
  'make', 'build', 'create', 'want', 'need', 'please', 'game', 'the', 'and', 'for', 'with', 'can', 'you',
  'like', 'that', 'this', 'some', 'kind', 'type', 'where', 'which', 'have', 'has', 'should', 'would',
  'godot', 'android', 'phone', 'mobile', 'simple', 'basic', 'small', 'little', 'new',
  // Words about how good the game should be. They are the loudest adjectives in
  // a prompt and they carry none of the idea, so the fallback used to name a
  // zombie shooter "Accha High" off "ek accha sa high resolution ... zombie".
  'accha', 'acha', 'good', 'nice', 'cool', 'best', 'great', 'proper', 'real', 'realistic',
  'high', 'resolution', 'detail', 'details', 'detailed', 'quality', 'big', 'bada', 'huge',
  // Hinglish scaffolding around the request.
  'bana', 'banao', 'banana', 'banade', 'karo', 'kardo', 'kar', 'chahiye', 'mujhe', 'muja',
  'wala', 'wali', 'jaisa', 'jasa', 'jaise', 'aur', 'bro', 'yaar', 'yar', 'ek',
]);

function titleCase(text: string): string {
  return text
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .slice(0, 40);
}

/**
 * What the player is.
 *
 * The whole prompt is a poor description — "make me a game where a ninja fights
 * robots" would make the player a ninja *and* a robot. So the subject is pulled
 * out where the sentence offers one, and the body plan is inferred from that.
 */
/**
 * Verbs that mark the noun before them as the player.
 *
 * Kept broad on purpose: a verb missing from this list does not degrade the
 * reading a little, it drops the subject entirely and the player becomes
 * "the player character" — which is how "a ninja dodges robots" ended up with
 * no ninja in it.
 */
const PLAYER_VERBS = [
  'fights', 'runs', 'jumps', 'explores', 'races', 'shoots', 'must', 'has to',
  'dodges', 'collects', 'escapes', 'survives', 'flies', 'drives', 'sneaks',
  'battles', 'defeats', 'avoids', 'climbs', 'slides', 'travels', 'searches',
  'hunts', 'rides', 'swims', 'solves', 'builds', 'tries',
].join('|');

export function inferPlayer(prompt: string): { description: string; body: BodyPlan; stated: boolean } {
  const patterns = [
    /\b(?:you (?:are|play as|control)|player is|playing as|control)\s+(?:an?\s+)?([a-z][a-z\s-]{2,30})/i,
    new RegExp(String.raw`\bwhere\s+(?:an?\s+)?([a-z][a-z\s-]{2,30}?)\s+(?:${PLAYER_VERBS})`, 'i'),
    new RegExp(String.raw`\b(?:a|an)\s+([a-z-]+(?:\s+[a-z-]+)?)\s+(?:that|who)\s+(?:${PLAYER_VERBS})`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(prompt);
    if (match) {
      const description = match[1].trim().replace(/\s+(and|with|in|on)$/i, '');
      return { description, body: inferPlan(description), stated: true };
    }
  }
  // No subject in the sentence: infer from the prompt as a whole, which at
  // least picks up "dragon" or "wolf" if either is in there.
  return { description: 'the player character', body: inferPlan(prompt), stated: false };
}

/**
 * The singular of a plural entity name.
 *
 * A node called "Zombies" for one zombie is wrong in the scene tree and in
 * every script that refers to it. The irregulars are listed rather than derived
 * because a rule that turns "zombies" into "zomby" is worse than no rule — and
 * that is exactly what the "-ies to -y" rule does here.
 */
export function singular(word: string): string {
  const irregular: Record<string, string> = {
    wolves: 'wolf',
    enemies: 'enemy',
    bunnies: 'bunny',
  };
  const lower = word.toLowerCase();
  if (irregular[lower]) return irregular[lower];
  // "-ss" is not a plural: "glass", "grass", "boss".
  if (lower.endsWith('s') && !lower.endsWith('ss')) return lower.slice(0, -1);
  return lower;
}

/** "a" or "an", so a generated sentence does not read as a typo. */
export function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

/**
 * Things in the world besides the player, read from the prompt.
 *
 * `playerDescription` is excluded: "a wolf jumps between islands" had the wolf
 * matched by the enemy list and listed as its own enemy, which is both wrong
 * and the sort of thing that makes a plan look unread.
 */
export function inferEntities(prompt: string, genre: Genre, playerDescription = ''): PlannedEntity[] {
  const text = prompt.toLowerCase();
  const player = singular(playerDescription.trim().toLowerCase());
  const found: PlannedEntity[] = [];
  const add = (name: string, role: PlannedEntity['role'], description: string) => {
    if (player && singular(description.toLowerCase()) === player) return;
    if (found.some((e) => e.name === name)) return;
    found.push({ name, role, description, body: inferPlan(description) });
  };

  const enemies = /\b(zombie|zombies|robot|robots|monster|monsters|alien|aliens|enemy|enemies|dragon|dragons|ghost|ghosts|slime|slimes|bandit|bandits|wolf|wolves|skeleton|skeletons)\b/g;
  for (const match of text.matchAll(enemies)) {
    const name = singular(match[1]);
    add(titleCase(name), 'enemy', name);
  }

  const pickups = /\b(coin|coins|gem|gems|star|stars|key|keys|treasure|apple|apples|crystal|crystals|orb|orbs|power[- ]?up)\b/g;
  for (const match of text.matchAll(pickups)) {
    const name = singular(match[1]);
    add(titleCase(name), 'pickup', name);
  }

  // Every genre needs *something* to interact with, or the game is a walking
  // simulator on an empty plane. Fill in the genre's own staple.
  if (!found.some((e) => e.role === 'enemy') && ['shooter', 'survival', 'top-down', 'adventure'].includes(genre)) {
    add('Enemy', 'enemy', 'a hostile creature');
  }
  if (!found.some((e) => e.role === 'pickup') && ['platformer', 'runner', 'adventure', 'top-down'].includes(genre)) {
    add('Coin', 'pickup', 'a coin');
  }
  if (genre === 'runner' || genre === 'racing' || genre === 'platformer') {
    add('Obstacle', 'obstacle', 'a block');
  }
  // A city with nobody in it is a car park. Open world planned with *no*
  // entities at all, which is the same failure the puzzle case below was
  // written for — and the same one that made the puzzle case necessary.
  if (genre === 'open-world') {
    if (!found.some((e) => e.role === 'npc')) add('Pedestrian', 'npc', 'a person walking the street');
    if (!found.some((e) => e.role === 'obstacle')) add('Car', 'obstacle', 'a parked car you can drive');
    if (!found.some((e) => e.role === 'pickup')) add('Parcel', 'pickup', 'a package to deliver');
  }

  // A puzzle with nothing in it is an empty room. It was the one genre that
  // came out of the planner with no entities at all — the exact failure the
  // rest of this function exists to prevent.
  if (genre === 'puzzle' && !found.length) {
    add('Block', 'obstacle', 'a pushable crate');
    add('Goal', 'pickup', 'a marked target tile');
  }

  // A cap, because a plan with fifteen entity types is a plan nothing will
  // finish building.
  return found.slice(0, 6);
}

/** Reads a prompt into a plan for what to build. */
export function planGame(prompt: string): GamePlan {
  const trimmed = prompt.trim();
  const genre = inferGenre(trimmed);
  const view = inferView(trimmed, genre.genre);
  const dimension = inferDimension(trimmed);
  const name = inferName(trimmed);
  const player = inferPlayer(trimmed);
  const entities = inferEntities(trimmed, genre.genre, player.stated ? player.description : '');

  const assumptions: string[] = [];
  if (!genre.stated) assumptions.push(`No genre was given, so this is ${article(genre.genre)} ${genre.genre} game.`);
  if (!view.stated) {
    assumptions.push(`Camera is ${view.view}, which is what ${article(genre.genre)} ${genre.genre} usually wants.`);
  }
  if (!dimension.stated) assumptions.push('Built in 3D. Say "2D" and it will use sprites instead.');
  if (!name.stated) assumptions.push(`Named "${name.name}" from the prompt — say what to call it and it will use that.`);
  if (!player.stated) assumptions.push(`The player is a ${player.body}-shaped character; the prompt did not say what you play as.`);

  return {
    name: name.name,
    genre: genre.genre,
    view: view.view,
    dimension: dimension.dimension,
    goal: GOAL_FOR[genre.genre],
    player: { description: player.description, body: player.body },
    entities,
    mechanics: MECHANICS_FOR[genre.genre],
    controls: CONTROLS_FOR[view.view],
    assumptions,
  };
}

/**
 * The plan as something to show a user before building.
 *
 * Written to be read in about ten seconds and corrected in one sentence. The
 * assumptions go last and are never hidden: they are the part most likely to be
 * wrong, and the cheapest to fix before any files exist.
 */
export function planSummary(plan: GamePlan): string {
  const lines = [
    `**${plan.name}** — a ${plan.dimension.toUpperCase()} ${plan.genre} game, ${plan.view}.`,
    '',
    `**Goal.** ${plan.goal}`,
    '',
    `**You play** ${plan.player.description} (${plan.player.body} build).`,
  ];

  if (plan.entities.length) {
    lines.push('', '**In the world**');
    for (const entity of plan.entities) lines.push(`- ${entity.name} — ${entity.role}`);
  }

  lines.push('', '**How it plays**');
  for (const mechanic of plan.mechanics) lines.push(`- ${mechanic}`);

  lines.push('', '**Controls**');
  for (const control of plan.controls) lines.push(`- ${control}`);

  if (plan.assumptions.length) {
    lines.push('', '**Guessed, so say if any of this is wrong**');
    for (const assumption of plan.assumptions) lines.push(`- ${assumption}`);
  }

  return lines.join('\n');
}

/** The parts to build the player's model from, ready for `model-source.ts`. */
export function playerParts(plan: GamePlan, scale = 1): PartSpec[] {
  return bodyPlan(plan.player.body, scale);
}

/**
 * The plan as instructions for the language model that writes the files.
 *
 * Separate from `planSummary`, which is for a person. This one is terse and
 * imperative, because a plan phrased as prose gets treated as background rather
 * than as the thing to build.
 */
export function planBrief(plan: GamePlan): string {
  const entities = plan.entities.length
    ? plan.entities.map((e) => `${e.name} (${e.role})`).join(', ')
    : 'none beyond the player';

  return [
    '## THE PLAN — build exactly this',
    `Name: ${plan.name}`,
    `Genre: ${plan.genre}   View: ${plan.view}   Dimension: ${plan.dimension}`,
    `Goal: ${plan.goal}`,
    `Player: ${plan.player.description} (${plan.player.body} body plan)`,
    `Entities: ${entities}`,
    'Mechanics, each of which needs code that actually runs:',
    ...plan.mechanics.map((m) => `- ${m}`),
    'Touch controls:',
    ...plan.controls.map((c) => `- ${c}`),
    '',
    'Do not substitute a different genre or camera. If the plan cannot be built',
    'as written, say which part and why, rather than quietly building something',
    'simpler and presenting it as what was asked for.',
  ].join('\n');
}


/**
 * Whether a prompt is asking for a game at all.
 *
 * The same cues the planner reads, so anything it can plan is something the
 * router will send it. Plus the ways people ask without naming a genre.
 */
export function looksLikeGame(prompt: string): boolean {
  const text = prompt.toLowerCase();
  if (GENRE_CUES.some(([, cue]) => cue.test(text))) return true;
  return /\b(godot|gdscript|\.tscn|game ?engine|game ?jam|player ?controller)\b/.test(text)
    || /\b(2d|3d) ?game\b/.test(text)
    || /\b(make|build|create) (me )?an? [\w\s-]{0,24}game\b/.test(text);
}
