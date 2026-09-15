/**
 * Turning what the model wrote into a project that actually opens.
 *
 * The Godot suite had no export path at all: the model emitted `project.godot`
 * and a `.tscn` as text, they landed in the file panel, and that was the end of
 * it. The user was left to create the folder, save each file into it by hand on
 * a phone, and hope the set was complete. It usually was not — a scene
 * referencing `player.gd` that was never written opens with an inert node and
 * no error that says why.
 *
 * So this completes the set and packages it:
 *   - anything the project needs and the model did not write is filled in from
 *     `project.ts`, which is the same scaffolding the suite already trusts;
 *   - a generated `.glb` is added when the scene asks for one;
 *   - the whole thing is validated before it is offered, because a project that
 *     fails at the import screen fails on the user's device, hours later.
 *
 * Pure: takes files, returns files. The model generation that produces the .glb
 * happens in the caller, where the network lives.
 */

import { buildProject, validateProject, type GameSpec, type GodotFile } from './project.ts';
import type { GamePlan } from './plan.ts';

export interface WorkspaceFile {
  path: string;
  content: string;
}

export interface GodotExport {
  filename: string;
  entries: Array<{ path: string; content: string | Uint8Array }>;
  /** Files that were missing and had to be filled in. Reported, not hidden. */
  filledIn: string[];
  /** What would still stop it opening. Empty means it imports. */
  problems: string[];
}

/** A path inside the project folder, with any wrapper directory stripped. */
function relativePath(path: string, root: string): string {
  const prefix = root ? `${root}/` : '';
  return prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/**
 * Whether these files are a Godot project, and where its root is.
 *
 * `project.godot` is the marker — it is the only file Godot itself uses to
 * recognise a folder, so it is the right thing to key on. A model that writes
 * it under `my_game/` is not wrong, so the wrapper is found rather than
 * rejected.
 */
export function detectGodotProject(files: WorkspaceFile[]): { root: string; files: WorkspaceFile[] } | null {
  const marker = files.find((f) => f.path === 'project.godot' || f.path.endsWith('/project.godot'));
  if (!marker) return null;

  const root = marker.path.includes('/') ? marker.path.slice(0, marker.path.lastIndexOf('/')) : '';
  const prefix = root ? `${root}/` : '';
  return {
    root,
    files: files.filter((f) => (prefix ? f.path.startsWith(prefix) : true)),
  };
}

/** Decodes a data URL back to bytes; leaves plain text alone. */
export function payload(content: string): string | Uint8Array {
  if (!content.startsWith('data:')) return content;

  const comma = content.indexOf(',');
  const meta = content.slice(0, comma);
  const body = content.slice(comma + 1);
  if (!meta.includes('base64')) return decodeURIComponent(body);

  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Every `res://` path the scenes reference, so a missing one can be spotted. */
export function referencedResources(files: WorkspaceFile[], root: string): string[] {
  const out = new Set<string>();
  for (const file of files) {
    const rel = relativePath(file.path, root);
    if (!rel.endsWith('.tscn') && rel !== 'project.godot') continue;
    for (const match of file.content.matchAll(/res:\/\/([^"'\s)]+)/g)) out.add(match[1]);
  }
  return [...out];
}

/**
 * Fills in whatever the project needs and the model did not write.
 *
 * Deliberately additive: a file the model wrote is never replaced, because it
 * knows what this particular game needs and the scaffolding does not. The
 * scaffolding only covers the gap — which is where the failures were, since a
 * missing file produces no error until Godot opens the scene.
 */
export function completeProject(
  files: WorkspaceFile[],
  spec: GameSpec,
): { files: WorkspaceFile[]; filledIn: string[] } {
  const detected = detectGodotProject(files);
  const root = detected?.root ?? '';
  const present = new Set(files.map((f) => relativePath(f.path, root)));

  const filledIn: string[] = [];
  const out = [...files];

  const scaffolding: GodotFile[] = buildProject(spec);
  for (const file of scaffolding) {
    if (present.has(file.path)) continue;

    // A script is only worth adding if something actually asks for it: an
    // unreferenced player.gd in a project that wrote its own is just litter.
    const referenced = referencedResources(files, root).includes(file.path);
    const essential = file.path === 'project.godot' || file.path === 'icon.svg' || file.path === 'README.md';
    if (!referenced && !essential) continue;

    out.push({ path: root ? `${root}/${file.path}` : file.path, content: file.content });
    filledIn.push(file.path);
  }

  return { files: out, filledIn };
}

/** A filename Godot and a file manager will both accept. */
export function archiveName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${slug || 'chomugiri-game'}.zip`;
}

/**
 * The project as a zip, with the folder at its top level.
 *
 * Godot's Android editor imports a folder, so the archive has to contain one —
 * a zip of loose files extracts into whatever directory the user happened to be
 * in, and the import screen then shows nothing.
 */
export function buildGodotExport(files: WorkspaceFile[], plan: GamePlan | null, name?: string): GodotExport | null {
  const detected = detectGodotProject(files);
  if (!detected) return null;

  const projectName = name ?? plan?.name ?? 'Chomugiri Game';
  // Genre and view are carried through, not dropped. The plan read "shooter,
  // first-person" out of the prompt correctly and then this function threw both
  // away, so every genre scaffolded as the same character in a field.
  const spec: GameSpec = {
    name: projectName,
    dimension: plan?.dimension ?? '3d',
    ...(plan?.genre ? { genre: plan.genre } : {}),
    ...(plan?.view ? { view: plan.view } : {}),
  };

  const completed = completeProject(detected.files, spec);
  const folder = archiveName(projectName).replace(/\.zip$/, '');

  const entries = completed.files.map((f) => ({
    path: `${folder}/${relativePath(f.path, detected.root)}`,
    content: payload(f.content),
  }));

  // Validated on the flattened set, which is what Godot will actually see.
  const problems = validateProject(
    completed.files
      .filter((f) => !f.content.startsWith('data:'))
      .map((f) => ({ path: relativePath(f.path, detected.root), content: f.content })),
  );

  // A referenced resource that is not in the archive opens as a missing node,
  // which validateProject cannot see because it only knows about text files.
  const packaged = new Set(completed.files.map((f) => relativePath(f.path, detected.root)));
  for (const resource of referencedResources(completed.files, detected.root)) {
    if (!packaged.has(resource)) {
      problems.push(`The scene references "${resource}", which is not in the project — that node will be missing.`);
    }
  }

  return { filename: archiveName(projectName), entries, filledIn: completed.filledIn, problems };
}

/** One line describing what is in the archive. */
export function describeExport(exported: GodotExport): string {
  const scripts = exported.entries.filter((e) => e.path.endsWith('.gd')).length;
  const models = exported.entries.filter((e) => e.path.endsWith('.glb')).length;
  const parts = [`${exported.entries.length} files`];
  if (scripts) parts.push(`${scripts} script${scripts === 1 ? '' : 's'}`);
  if (models) parts.push(`${models} model${models === 1 ? '' : 's'}`);
  return `Godot 4 project — ${parts.join(', ')}.`;
}
