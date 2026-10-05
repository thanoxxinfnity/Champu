/**
 * The Pro Game Kit: what a shipped game has and a generated prototype lacks.
 *
 * A model asked for a game writes flat boxes on a green plane, a timer in the corner and nothing else — no title screen, no
 * pause, no sound, no feedback, a camera that sits inside the car. It is not that the model cannot be told; it is that every
 * one of those things is another hundred lines it has to write and get right, and it spends its effort on the rules instead.
 *
 * So the finish is supplied. Every Godot project gets res://kit/ — a frame (title → countdown → play → pause → results → retry),
 * UI, sound and music looked up by name, screen shake and hit-stop, particles, a lit sky and fog, a chase camera, a car that
 * drives, props that look made, and multi-touch controls — registered as autoloads, tested against real Godot in a virtual
 * display. The model writes the game and calls them; the prompt (GAME_KIT_ADDENDUM) lists the calls.
 */

import { GAME_KIT_FILES } from './kit/data.ts';

/** Autoloads in the order they must load (Save first: Sfx reads settings from it). */
export const KIT_AUTOLOADS: Array<[string, string]> = [
  ['Save', 'res://kit/save.gd'],
  ['Feel', 'res://kit/feel.gd'],
  ['Sfx', 'res://kit/sfx.gd'],
  ['Stage', 'res://kit/stage.gd'],
  ['Props', 'res://kit/props.gd'],
  ['Fx', 'res://kit/fx.gd'],
  ['UIKit', 'res://kit/ui_kit.gd'],
  ['Pad', 'res://kit/pad.gd'],
  ['Vehicle', 'res://kit/vehicle.gd'],
];

/** Adds the kit's autoloads to a project.godot, keeping any the project already has and never listing one twice. */
export function withKitAutoloads(content: string): string {
  const have = new Set([...content.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"\*?res:\/\//gm)].map((m) => m[1]));
  const lines = KIT_AUTOLOADS.filter(([name]) => !have.has(name)).map(([name, path]) => `${name}="*${path}"`);
  if (!lines.length) return content;
  if (/^\[autoload\]\s*$/m.test(content)) {
    // The kit goes first: a project's own autoload may call it from _ready.
    return content.replace(/^\[autoload\]\s*$/m, `[autoload]\n\n${lines.join('\n')}`);
  }
  return `${content.trimEnd()}\n\n[autoload]\n\n${lines.join('\n')}\n`;
}

export interface KitFile { path: string; content: string }

/**
 * The kit files a project is missing, plus the project.godot that registers them.
 * Files the model already wrote under kit/ are left alone.
 */
export function kitFor(files: Array<{ path: string; content: string }>, root: string): { add: KitFile[]; projectGodot?: { path: string; content: string } } {
  const prefix = root ? `${root}/` : '';
  const present = new Set(files.map((f) => (prefix && f.path.startsWith(prefix) ? f.path.slice(prefix.length) : f.path)));
  const add = GAME_KIT_FILES.filter((f) => !present.has(f.path)).map((f) => ({ path: `${prefix}${f.path}`, content: f.content }));
  const project = files.find((f) => f.path === `${prefix}project.godot`);
  const patched = project ? withKitAutoloads(project.content) : undefined;
  return { add, projectGodot: project && patched !== project.content ? { path: project.path, content: patched! } : undefined };
}
