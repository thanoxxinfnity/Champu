import type { FileArtifact } from '@/lib/agent/artifacts';

/**
 * Turning generated pack JSON into something Minecraft can actually install.
 *
 * The planner has always listed "Export .mcpack / .mcaddon" as a step, and
 * nothing implemented it: a Minecraft build produced a folder of correct JSON
 * and then stopped, which is indistinguishable from "it did not build my mod".
 * The only packaging path in the runtime collected artifacts from the terminal
 * bridge — but a Bedrock add-on is a ZIP of JSON and PNG with no build step at
 * all, so requiring a bridge for it was the wrong shape entirely. This packs it
 * in the browser.
 *
 * Naming, which Minecraft is strict about:
 *   .mcpack  — exactly one pack (a behaviour pack or a resource pack)
 *   .mcaddon — a bundle of several packs, each in its own folder
 * A two-pack add-on shipped as .mcpack silently imports only one half, so the
 * distinction here is not cosmetic.
 */

export type PackKind = 'behavior' | 'resource' | 'unknown';

export interface DetectedPack {
  kind: PackKind;
  /** Directory the pack lives under; '' when the pack is at the bundle root. */
  root: string;
  files: FileArtifact[];
  /** From manifest.json, when it parses. */
  name?: string;
}

/** Bedrock module types, which is what actually decides a pack's kind. */
const BEHAVIOR_MODULES = new Set(['data', 'script', 'client_data']);
const RESOURCE_MODULES = new Set(['resources', 'skin_pack', 'world_template']);

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

interface ManifestShape {
  header?: { name?: string };
  modules?: Array<{ type?: string }>;
}

/** A pack's kind comes from its manifest modules, falling back to its path. */
export function classifyManifest(content: string, root: string): { kind: PackKind; name?: string } {
  let parsed: ManifestShape | null = null;
  try {
    parsed = JSON.parse(content) as ManifestShape;
  } catch {
    parsed = null;
  }

  const types = (parsed?.modules ?? []).map((m) => (m?.type ?? '').toLowerCase());
  if (types.some((t) => BEHAVIOR_MODULES.has(t))) return { kind: 'behavior', name: parsed?.header?.name };
  if (types.some((t) => RESOURCE_MODULES.has(t))) return { kind: 'resource', name: parsed?.header?.name };

  // No usable modules: fall back to the folder name, which is conventional.
  const hint = root.toLowerCase();
  if (/(^|\/)(bp|behaviou?r)/.test(hint)) return { kind: 'behavior', name: parsed?.header?.name };
  if (/(^|\/)(rp|resource)/.test(hint)) return { kind: 'resource', name: parsed?.header?.name };
  return { kind: 'unknown', name: parsed?.header?.name };
}

/**
 * Finds every Bedrock pack among the generated files.
 *
 * A pack is defined by its manifest: the directory holding a `manifest.json`
 * is the pack root, and everything beneath it belongs to that pack. This is
 * exactly how Minecraft itself decides, so a layout it accepts is one this
 * accepts too.
 */
export function detectPacks(files: FileArtifact[]): DetectedPack[] {
  const manifests = files.filter((f) => f.path === 'manifest.json' || f.path.endsWith('/manifest.json'));
  if (!manifests.length) return [];

  // Deepest roots first, so a nested pack claims its files before a parent does.
  const roots = manifests
    .map((m) => ({ root: dirOf(m.path), manifest: m }))
    .sort((a, b) => b.root.length - a.root.length);

  const claimed = new Set<string>();
  const packs: DetectedPack[] = [];

  for (const { root, manifest } of roots) {
    const prefix = root ? `${root}/` : '';
    const owned = files.filter((f) => !claimed.has(f.path) && (root === '' || f.path.startsWith(prefix)));
    if (!owned.length) continue;
    owned.forEach((f) => claimed.add(f.path));

    const { kind, name } = classifyManifest(manifest.content, root);
    packs.push({ kind, root, files: owned, name });
  }

  // Behaviour before resource, which is the order Minecraft lists them in.
  const order: Record<PackKind, number> = { behavior: 0, resource: 1, unknown: 2 };
  return packs.sort((a, b) => order[a.kind] - order[b.kind]);
}

/** A filename-safe slug, never empty. */
export function slugify(name: string, fallback = 'chomugiri-addon'): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || fallback;
}

export interface PackExport {
  filename: string;
  /** Paths inside the archive, already rebased for Minecraft. */
  entries: Array<{ path: string; content: string }>;
  packs: number;
  kinds: PackKind[];
}

const SUFFIX: Record<PackKind, string> = { behavior: '_BP', resource: '_RP', unknown: '' };

/**
 * What to call the archive.
 *
 * The pack's own manifest name is what the author chose and what Minecraft will
 * display, so it beats the prompt — which produces filenames like
 * "build-a-minecraft-bedrock-addon-specification.mcaddon". Packs commonly
 * differ only by a BP/RP suffix, so that is trimmed to get the add-on's name.
 */
export function archiveName(packs: DetectedPack[], fallback: string): string {
  const named = packs.map((p) => p.name?.trim()).filter((n): n is string => Boolean(n));
  if (!named.length) return fallback;

  const stripped = named.map((n) =>
    n.replace(/\s*[-–—]?\s*\b(behaviou?r|resource|bp|rp)\b\s*(pack)?\s*$/i, '').trim(),
  );
  const best = stripped.find(Boolean) ?? named[0];
  return best || fallback;
}

/**
 * Lays the packs out the way Minecraft expects inside the archive.
 *
 * One pack ships flat as .mcpack — its manifest must be at the archive root.
 * Several ship as .mcaddon with one folder per pack, because a .mcaddon whose
 * packs are not separated imports as a single broken pack.
 */
export function buildPackExport(packs: DetectedPack[], projectName: string): PackExport | null {
  if (!packs.length) return null;
  const base = slugify(archiveName(packs, projectName));

  if (packs.length === 1) {
    const pack = packs[0];
    const prefix = pack.root ? `${pack.root}/` : '';
    return {
      filename: `${base}.mcpack`,
      entries: pack.files.map((f) => ({
        path: prefix && f.path.startsWith(prefix) ? f.path.slice(prefix.length) : f.path,
        content: f.content,
      })),
      packs: 1,
      kinds: [pack.kind],
    };
  }

  const entries: Array<{ path: string; content: string }> = [];
  for (const pack of packs) {
    const folder = `${slugify(pack.name ?? base, base)}${SUFFIX[pack.kind]}`;
    const prefix = pack.root ? `${pack.root}/` : '';
    for (const f of pack.files) {
      const rel = prefix && f.path.startsWith(prefix) ? f.path.slice(prefix.length) : f.path;
      entries.push({ path: `${folder}/${rel}`, content: f.content });
    }
  }

  return { filename: `${base}.mcaddon`, entries, packs: packs.length, kinds: packs.map((p) => p.kind) };
}

/** Human summary for the chat message offering the download. */
export function describeExport(exp: PackExport): string {
  const kinds = exp.kinds
    .map((k) => (k === 'behavior' ? 'behaviour pack' : k === 'resource' ? 'resource pack' : 'pack'))
    .join(' + ');
  return `${exp.filename} — ${kinds}, ${exp.entries.length} file${exp.entries.length === 1 ? '' : 's'}`;
}
