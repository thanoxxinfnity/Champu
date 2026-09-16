/**
 * What must be true before a project is handed over.
 *
 * "Zero bugs, zero errors, zero glitches" is not something any generator can
 * promise, and saying it does not make a build work. What can be done is refuse
 * to ship the failures that have actually happened — so this file is not a
 * general linter, it is a list of specific mistakes, each one made for real in
 * this project and each one silent until the game ran.
 *
 * The ones that cost the most were all silent in the same way: Godot does not
 * fail to start. It opens, prints something into a log nobody is reading, and
 * the gun just does not shoot.
 */

import type { GodotFile } from './project.ts';

export interface Problem {
  file: string;
  line?: number;
  message: string;
  /** Fatal stops the ship. A warning is worth saying and not worth blocking. */
  fatal: boolean;
}

/** Nodes a scene declares, as full paths from the root. */
export function declaredNodes(scene: string): Set<string> {
  const nodes = new Set<string>(['.']);
  for (const match of scene.matchAll(/^\[node name="([^"]+)"(?:[^\]]*?)\s+parent="([^"]+)"/gm)) {
    const [, name, parent] = match;
    nodes.add(parent === '.' ? name : `${parent}/${name}`);
  }
  return nodes;
}

/**
 * `:=` through a value whose type Godot cannot see.
 *
 * A *parse* error, not a warning: the whole script fails to load, which means
 * the node it was attached to silently does nothing. Hit three times in this
 * project — `node.coins`, `event.position`, and a comparison against a value
 * that came from a Dictionary.
 */
const UNTYPED_INFER =
  /^\s*var\s+\w+\s*:=\s*(?:\w+\.(?:get_node|get_parent|get_child|find_child|get_meta)\s*\(|(?:get_node|get_parent|get_child|find_child|get_meta)\s*\(|\w+\[[^\]]+\]|\w+\.\w+\s*(?:[<>]|[=!]=))/;

/**
 * A cast or a constructor gives Godot the type, so `:=` is fine after one.
 *
 * Without this the check fires on its own scaffold: `var art := scene.instantiate()`
 * and `var label := panel.get_node("Text") as Label` both parse perfectly, and a
 * verifier that reports working code as broken is worse than no verifier —
 * people learn to ignore it, including for the three real ones.
 */
const TYPE_IS_VISIBLE = /\bas\s+[A-Z]\w*\s*(?:#.*)?$|\.(?:instantiate|duplicate|new)\s*\(/;

/** Actions read from code, so they can be checked against what the project declares. */
export function actionsPolled(script: string): string[] {
  const found = new Set<string>();
  for (const m of script.matchAll(/is_action_(?:just_)?(?:pressed|released)\("([^"]+)"\)/g)) found.add(m[1]);
  for (const m of script.matchAll(/Input\.get_vector\(([^)]*)\)/g)) {
    for (const name of m[1].match(/"([^"]+)"/g) ?? []) found.add(name.slice(1, -1));
  }
  return [...found];
}

/** `$Name` and `get_node("Name")`, which are the two ways to reach a child. */
export function nodesReferenced(script: string): string[] {
  const found = new Set<string>();
  for (const m of script.matchAll(/\$([A-Za-z_][\w/]*)/g)) found.add(m[1]);
  for (const m of script.matchAll(/get_node\("([^"]+)"\)/g)) found.add(m[1]);
  return [...found];
}

/**
 * Checks a finished project.
 *
 * Takes the files rather than a path, so it runs in the browser before anything
 * is written and in a test without a temp directory.
 */
export function verifyProject(files: GodotFile[]): Problem[] {
  const problems: Problem[] = [];

  // Binary assets arrive as data: URLs, because that is how a file travels
  // through a workspace that has no filesystem. They are files the project
  // contains — they are just not text. Filtering them out before this point is
  // what made `res://character.glb` read as missing and refused every build
  // that actually generated a model.
  const isBinary = (content: string) => content.startsWith('data:');
  const byPath = new Map(files.filter((f) => !isBinary(f.content)).map((f) => [f.path, f.content]));
  const packagedPaths = new Set(files.map((f) => f.path));
  const config = byPath.get('project.godot') ?? '';
  const declaredActions = new Set([...config.matchAll(/^([a-z_]+)=\{/gm)].map((m) => m[1]));
  // Godot's own built-ins are always available and are never in project.godot.
  for (const builtin of ['ui_accept', 'ui_cancel', 'ui_left', 'ui_right', 'ui_up', 'ui_down', 'ui_select']) {
    declaredActions.add(builtin);
  }

  const scenes = [...byPath.entries()].filter(([p]) => p.endsWith('.tscn'));

  for (const [path, scene] of scenes) {
    // A child addressed by a path its own scene never declares. This is how the
    // muzzle flash survived a reparent: the weapon moved, its mesh and grip
    // moved with it, and the light stayed behind at a path that no longer
    // existed. Nothing complained until `$Flash` came back null at runtime.
    const declared = new Set<string>(['.']);
    for (const match of scene.matchAll(/^\[node name="([^"]+)"(?:[^\]]*?)\s+parent="([^"]+)"/gm)) {
      const [, name, parent] = match;
      if (!declared.has(parent)) {
        problems.push({
          file: path,
          message: `"${name}" hangs off "${parent}", which this scene never declares. It will be missing at runtime.`,
          fatal: true,
        });
      }
      declared.add(parent === '.' ? name : `${parent}/${name}`);
    }
  }

  // One combined node set: a script can only be attached to one scene, and
  // checking against all of them is what keeps a shared script from tripping.
  const allNodes = new Set<string>();
  for (const [, scene] of scenes) for (const node of declaredNodes(scene)) allNodes.add(node);
  // A node name on its own, so `$Flash` matches `Player/Camera/Weapon/Flash`.
  const leafNames = new Set([...allNodes].map((n) => n.split('/').pop() ?? n));

  for (const [path, content] of byPath) {
    if (!path.endsWith('.gd')) continue;

    const lines = content.split('\n');
    lines.forEach((line, i) => {
      if (UNTYPED_INFER.test(line) && !TYPE_IS_VISIBLE.test(line)) {
        problems.push({
          file: path,
          line: i + 1,
          message:
            'Inferred type through a value Godot cannot see the type of. This is a parse error, not a warning — the whole script fails to load. Write the type out.',
          fatal: true,
        });
      }
      if (/^\t+ +\S/.test(line)) {
        problems.push({ file: path, line: i + 1, message: 'Indented with a tab then spaces. Godot rejects the mix.', fatal: true });
      }
    });

    for (const action of actionsPolled(content)) {
      if (!declaredActions.has(action)) {
        problems.push({
          file: path,
          message: `Polls the input action "${action}", which project.godot never declares. Godot does not error — the action simply never fires.`,
          fatal: true,
        });
      }
    }

    for (const node of nodesReferenced(content)) {
      // `$Foo/Bar` is checked leaf-first: the script may be attached anywhere.
      const leaf = node.split('/').pop() ?? node;
      if (!leafNames.has(leaf) && !allNodes.has(node)) {
        problems.push({
          file: path,
          message: `Reaches for a node called "${node}", which no scene in this project contains. It will be null.`,
          // A warning rather than fatal: the node may be created in code, which
          // is exactly what the enemy spawner does.
          fatal: false,
        });
      }
    }
  }

  // A res:// path that is not in the project loads as a missing node, and the
  // scene opens with a hole in it rather than an error.
  const packaged = packagedPaths;
  for (const [path, content] of byPath) {
    if (!path.endsWith('.tscn') && path !== 'project.godot') continue;
    for (const match of content.matchAll(/res:\/\/([^"'\s)]+)/g)) {
      if (!packaged.has(match[1])) {
        problems.push({ file: path, message: `References "res://${match[1]}", which is not in the project.`, fatal: true });
      }
    }
  }

  // Every SubResource and ExtResource a scene uses has to be declared in it.
  //
  // Not a degradation: Godot refuses the whole file. "Condition
  // !int_resources.has(id) is true" and then "Failed loading resource", and the
  // game opens to nothing. It happened by moving one style box between two
  // lists — which is exactly the kind of edit nobody re-tests.
  for (const [path, scene] of scenes) {
    const subs = new Set([...scene.matchAll(/^\[sub_resource type="[^"]+" id="([^"]+)"\]/gm)].map((m) => m[1]));
    for (const [, id] of scene.matchAll(/SubResource\("([^"]+)"\)/g)) {
      if (subs.has(id)) continue;
      problems.push({
        file: path,
        message: `SubResource("${id}") is used and never declared — Godot refuses the whole scene, not just this node.`,
        fatal: true,
      });
    }
    const exts = new Set([...scene.matchAll(/^\[ext_resource [^\]]*id="([^"]+)"\]/gm)].map((m) => m[1]));
    for (const [, id] of scene.matchAll(/ExtResource\("([^"]+)"\)/g)) {
      if (exts.has(id)) continue;
      problems.push({
        file: path,
        message: `ExtResource("${id}") is used and never declared.`,
        fatal: true,
      });
    }
  }

  return problems;
}

/** Whether the project is fit to hand over. */
export function shippable(problems: Problem[]): boolean {
  return !problems.some((p) => p.fatal);
}

/** The problems, in words worth putting in front of someone. */
export function describeProblems(problems: Problem[]): string {
  if (!problems.length) return '';
  const fatal = problems.filter((p) => p.fatal);
  const warnings = problems.filter((p) => !p.fatal);
  const lines: string[] = [];
  if (fatal.length) {
    lines.push(`**${fatal.length} thing${fatal.length === 1 ? '' : 's'} would stop this running:**`);
    for (const p of fatal) lines.push(`- \`${p.file}${p.line ? `:${p.line}` : ''}\` — ${p.message}`);
  }
  if (warnings.length) {
    if (fatal.length) lines.push('');
    lines.push('**Worth a look:**');
    for (const p of warnings) lines.push(`- \`${p.file}${p.line ? `:${p.line}` : ''}\` — ${p.message}`);
  }
  return lines.join('\n');
}
