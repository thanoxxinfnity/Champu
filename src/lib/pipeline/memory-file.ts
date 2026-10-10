/**
 * The project's memory as a file in the bridge workspace, `.chomugiri_memory.json`.
 *
 * What the app remembers lives in this browser. A project lives on the machine the bridge runs on, so the memory
 * that belongs to it is saved there too: the architecture and stack it found, the decisions made, the user's
 * preferences. Open the same project from another phone or a cleared browser and it all comes back; read the file
 * and any person (or any other tool) can see what Chomugiri knows about the project.
 */
import type { Memory } from '../memory/memory.ts';

export const MEMORY_FILE = '.chomugiri_memory.json';

export interface ProjectFacts {
  stack: string[];
  files: number;
  entry?: string;
}

export interface MemoryFile {
  version: 1;
  updatedAt: number;
  project: ProjectFacts;
  memories: Memory[];
}

const STACKS: Array<[RegExp, string]> = [
  [/(^|\/)project\.godot$/, 'Godot'],
  [/(^|\/)build\.gradle(\.kts)?$/, 'Android/Gradle'],
  [/AndroidManifest\.xml$/, 'Android'],
  [/(^|\/)package\.json$/, 'Node'],
  [/(^|\/)tsconfig\.json$/, 'TypeScript'],
  [/(^|\/)next\.config\.\w+$/, 'Next.js'],
  [/(^|\/)vite\.config\.\w+$/, 'Vite'],
  [/(^|\/)requirements\.txt$|(^|\/)pyproject\.toml$/, 'Python'],
  [/(^|\/)Cargo\.toml$/, 'Rust'],
  [/(^|\/)go\.mod$/, 'Go'],
  [/(^|\/)pom\.xml$/, 'Java/Maven'],
  [/(^|\/)manifest\.json$/, 'Minecraft Bedrock pack (manifest)'],
  [/(^|\/)Dockerfile$/, 'Docker'],
  [/(^|\/)vercel\.json$/, 'Vercel'],
  [/\.kt$/, 'Kotlin'],
  [/\.gd$/, 'GDScript'],
  [/\.tsx$/, 'React'],
];

/** What the file names alone say about the project: cheap, deterministic, no model. */
export function detectProject(paths: string[]): ProjectFacts {
  const clean = paths.filter((p) => !/(^|\/)(node_modules|\.git|\.gradle|build|dist|\.artifacts)\//.test(p));
  const stack = new Set<string>();
  for (const p of clean) for (const [re, name] of STACKS) if (re.test(p)) stack.add(name);
  const entry = clean.find((p) => /(^|\/)(index\.html|main\.\w+|app\.\w+|MainActivity\.\w+|project\.godot|src\/app\/page\.\w+)$/i.test(p));
  return { stack: [...stack].sort(), files: clean.length, ...(entry ? { entry } : {}) };
}

export function toFile(memories: Memory[], project: ProjectFacts, now = Date.now()): string {
  const body: MemoryFile = { version: 1, updatedAt: now, project, memories };
  return `${JSON.stringify(body, null, 2)}\n`;
}

/** Reads the file back, refusing anything that is not what this module wrote (a hand edit is fine, garbage is not). */
export function fromFile(text: string): MemoryFile | null {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return null; }
  if (!data || typeof data !== 'object') return null;
  const d = data as Partial<MemoryFile>;
  if (d.version !== 1 || !Array.isArray(d.memories)) return null;
  const memories = d.memories.filter((m): m is Memory => !!m && typeof m.id === 'string' && typeof m.text === 'string' && typeof m.kind === 'string' && Array.isArray(m.tags));
  const project = d.project && Array.isArray(d.project.stack) ? { stack: d.project.stack.filter((s) => typeof s === 'string'), files: Number(d.project.files) || 0, ...(typeof d.project.entry === 'string' ? { entry: d.project.entry } : {}) } : { stack: [], files: 0 };
  return { version: 1, updatedAt: Number(d.updatedAt) || 0, project, memories };
}

/** One line telling the model what the project is, from the facts in the file. */
export function projectLine(p: ProjectFacts): string {
  if (!p.stack.length && !p.files) return '';
  return `Project on the bridge: ${p.stack.length ? p.stack.join(', ') : 'unknown stack'}; ${p.files} file${p.files === 1 ? '' : 's'}${p.entry ? `; entry ${p.entry}` : ''}.`;
}
