/**
 * The quality gate for a generated game: is this a finished-feeling game or a prototype?
 *
 * Nothing here judges whether the game is fun — only whether it has what every shipped game has, which the kit supplies and the
 * model has to actually use: the shell (title, pause, results), sound, feedback, a lit and furnished world, a camera that is not
 * inside the car, touch controls. Each check is a plain reading of the code the model wrote, so a failure names the missing thing
 * and the model can be sent back to add it.
 */

export interface GameFile { path: string; content: string }

const base = (p: string) => p.split('/').pop() ?? p;
const isKit = (p: string) => /(^|\/)kit\//.test(p);

/** The scripts the model wrote (not the kit's). */
export function gameScripts(files: GameFile[]): GameFile[] {
  return files.filter((f) => f.path.endsWith('.gd') && !isKit(f.path) && typeof f.content === 'string');
}

const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;

export interface QualityReport {
  /** What is missing, in words the model can act on. */
  problems: string[];
  /** The script that should hold the game's frame. */
  main?: GameFile;
}

export function checkGameQuality(files: GameFile[]): QualityReport {
  const scripts = gameScripts(files);
  const all = scripts.map((s) => s.content).join('\n');
  const main = scripts.find((s) => /extends\s+["']res:\/\/kit\/game_shell\.gd["']/.test(s.content));
  const problems: string[] = [];
  const is3d = /\b(Node3D|Camera3D|MeshInstance3D|CharacterBody3D|RigidBody3D|VehicleBody3D)\b/.test(all) || files.some((f) => /\.tscn$/.test(f.path) && /Node3D|Camera3D/.test(f.content));

  if (!main) {
    const guess = scripts.find((s) => base(s.path) === 'main.gd') ?? scripts[0];
    problems.push('The main script does not start with `extends "res://kit/game_shell.gd"`. Without the shell the game has no title screen, countdown, pause menu, results screen with a best score, or retry. Make main.gd extend it, set game_title/tagline/score_key in _ready() and call super(), and write _build_world(), _begin() and _update(delta) instead of your own menu code.');
    return { problems, main: guess };
  }
  if (!/\bfinish\s*\(/.test(all)) problems.push('The run never ends through `finish(score, headline, lines, won)`, so there is no results screen and no best score. Call it when the player wins or loses.');
  const sounds = new Set([...all.matchAll(/Sfx\.play\(\s*["']([a-z_0-9]+)["']/g)].map((m) => m[1]));
  if (sounds.size < 3) problems.push(`The game plays ${sounds.size === 0 ? 'no sounds' : `only ${sounds.size} distinct sound${sounds.size === 1 ? '' : 's'}`}. Use Sfx.play(...) for at least three events (pickup "coin", hit "hit" or "crash", jump, boost, win/lose happen in the shell) — silence reads as a demo.`);
  if (count(all, /\bFeel\.(shake|hit_stop|flash|pop|float_text|slow_mo)\(/g) + count(all, /\bFx\.(burst|dust|confetti)\(/g) < 2) problems.push('There is almost no feedback. Every pickup, hit, crash and boost needs a reaction: Feel.shake(...), Fx.burst(...), Feel.pop(...), Feel.float_text(...), Feel.flash(...).');
  if (is3d) {
    if (!/\bStage\.environment\(/.test(all)) problems.push('The 3D world has no designed look. Call Stage.environment(parent, "day"|"sunset"|"night"|"overcast"|"snow"|"desert") for sky, sun with shadows, fog and tone mapping; a default grey-blue sky with flat lighting is the prototype look.');
    if (!/\bProps\.[a-z_]+\(|\.glb["']/.test(all) && !/\bVehicle\.create\(/.test(all)) problems.push('The world is built from bare boxes. Use Props.car/coin/tree/rock/crate/cone/building/lamp_post/barrier (or a generated .glb) so things look made, and Stage.scatter(...) to dress the level.');
    if (/\bCamera3D\.new\(\)/.test(all) && !/Stage\.chase_camera\(/.test(all) && /VehicleBody3D|Vehicle\.create/.test(all)) problems.push('The car has a hand-made camera. Use Stage.chase_camera(parent, car) — it follows from behind with a speed-based field of view and stays out of the car.');
    if (/VehicleBody3D\.new\(\)/.test(all) && !/Vehicle\.create\(/.test(all)) problems.push('The car is built by hand. Use Vehicle.create(...) and Vehicle.drive(...): it is tuned not to flip, steers less at speed and recovers when upside down.');
  }
  if (!/\bPad\.(add|add_stick)\(/.test(all) && !/InputEventScreenTouch|TouchScreenButton/.test(all)) problems.push('There are no touch controls and the game is for a phone. Use Pad.add(self, [...]) for buttons and Pad.add_stick(...) for a movement stick.');
  if (/\b(title_label|game_over|GameOver|PauseMenu|pause_menu|main_menu|MainMenu)\b/.test(all) && !problems.length) { /* the shell already supplies these; nothing to flag */ }
  return { problems, main };
}

/** The follow-up asked of the model when the check found problems. */
export function qualityRepairPrompt(problems: string[]): string {
  return `The game is written and runs, but it still feels like a prototype. Fix exactly these, using the kit (res://kit/) calls from the instructions:

${problems.map((p, i) => `${i + 1}. ${p}`).join('\n')}

Rewrite main.gd in full — and any other script you change — as fenced files with their paths, keeping the rules and the design of the game as they are. Do not touch the kit, do not add new menu or HUD code, and do not explain.`;
}
