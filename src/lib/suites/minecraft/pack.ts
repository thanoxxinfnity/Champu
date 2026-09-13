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
  /**
   * Paths inside the archive, already rebased for Minecraft.
   *
   * Content is bytes for anything binary — generated textures arrive as data
   * URLs and are decoded here, because a PNG written into a ZIP as text is a
   * corrupt PNG.
   */
  entries: Array<{ path: string; content: string | Uint8Array }>;
  packs: number;
  kinds: PackKind[];
}

/** Decodes a data URL to bytes; anything else passes through as text. */
function payload(content: string): string | Uint8Array {
  if (!content.startsWith('data:')) return content;

  const comma = content.indexOf(',');
  const meta = content.slice(0, comma);
  const body = content.slice(comma + 1);
  if (!meta.includes('base64')) return decodeURIComponent(body);

  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
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
        content: payload(f.content),
      })),
      packs: 1,
      kinds: [pack.kind],
    };
  }

  const entries: Array<{ path: string; content: string | Uint8Array }> = [];
  for (const pack of packs) {
    const folder = `${slugify(pack.name ?? base, base)}${SUFFIX[pack.kind]}`;
    const prefix = pack.root ? `${pack.root}/` : '';
    for (const f of pack.files) {
      const rel = prefix && f.path.startsWith(prefix) ? f.path.slice(prefix.length) : f.path;
      entries.push({ path: `${folder}/${rel}`, content: payload(f.content) });
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

/**
 * What would stop this pack importing, checked before it is handed over.
 *
 * A pack can be perfectly valid JSON and still fail at the Minecraft import
 * screen, or import and then show raw identifiers instead of names. Those
 * failures are silent and happen on the user's device, long after the run that
 * caused them — so they are worth catching here, where they can still be
 * explained.
 *
 * Everything below was chosen because it *blocks or visibly breaks* an import.
 * Style opinions are not the job of this function.
 */
export interface PackProblem {
  severity: 'blocker' | 'warning';
  message: string;
}

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface FullManifest {
  format_version?: number | string;
  header?: { uuid?: string; name?: string; version?: unknown; min_engine_version?: unknown };
  modules?: Array<{ uuid?: string; type?: string }>;
}

export function validatePacks(packs: DetectedPack[]): PackProblem[] {
  const problems: PackProblem[] = [];
  const seenUuids = new Map<string, string>();

  for (const pack of packs) {
    const label = pack.name ?? pack.root ?? 'pack';
    const manifestFile = pack.files.find((f) => f.path === 'manifest.json' || f.path.endsWith('/manifest.json'));
    if (!manifestFile) {
      problems.push({ severity: 'blocker', message: `${label}: no manifest.json — Minecraft will not see this as a pack.` });
      continue;
    }

    let manifest: FullManifest;
    try {
      manifest = JSON.parse(manifestFile.content) as FullManifest;
    } catch {
      problems.push({ severity: 'blocker', message: `${label}: manifest.json is not valid JSON, so the import fails immediately.` });
      continue;
    }

    if (manifest.format_version === undefined) {
      problems.push({ severity: 'blocker', message: `${label}: manifest has no format_version.` });
    }
    if (!manifest.header?.version) {
      problems.push({ severity: 'warning', message: `${label}: manifest header has no version; Minecraft may refuse to list it.` });
    }
    if (!manifest.header?.min_engine_version) {
      problems.push({ severity: 'warning', message: `${label}: no min_engine_version — older clients may reject the pack.` });
    }

    // UUIDs are the single most common reason an add-on will not import.
    const uuids: Array<[string, string | undefined]> = [
      ['header', manifest.header?.uuid],
      ...(manifest.modules ?? []).map((m, i) => [`module ${i + 1}`, m?.uuid] as [string, string | undefined]),
    ];

    for (const [where, uuid] of uuids) {
      if (!uuid) {
        problems.push({ severity: 'blocker', message: `${label}: ${where} has no uuid.` });
        continue;
      }
      if (uuid === ZERO_UUID) {
        problems.push({ severity: 'blocker', message: `${label}: ${where} uses the all-zero placeholder uuid — replace it with a real one.` });
        continue;
      }
      if (!UUID_RE.test(uuid)) {
        problems.push({ severity: 'blocker', message: `${label}: ${where} uuid "${uuid}" is not a valid UUID.` });
        continue;
      }
      const clash = seenUuids.get(uuid.toLowerCase());
      if (clash) {
        problems.push({ severity: 'blocker', message: `${label}: ${where} reuses the uuid already used by ${clash}. Every uuid must be unique.` });
      } else {
        seenUuids.set(uuid.toLowerCase(), `${label} ${where}`);
      }
    }

    if (!(manifest.modules ?? []).length) {
      problems.push({ severity: 'blocker', message: `${label}: manifest declares no modules, so the pack contains nothing.` });
    }

    // Content that will import but show wrong.
    const paths = pack.files.map((f) => f.path);
    const definesContent = paths.some((p) => /\/(items|entities|blocks)\//.test(p));
    const hasLang = paths.some((p) => /\/texts\/.*\.lang$/.test(p) || /texts\/.*\.lang$/.test(p));
    if (pack.kind === 'resource' && definesContent && !hasLang) {
      problems.push({
        severity: 'warning',
        message: `${label}: no .lang file — names will show in game as raw identifiers like "item.ns:name.name".`,
      });
    }

    const needsTexture = paths.some((p) => /item_texture\.json$|terrain_texture\.json$/.test(p));
    const hasTexture = paths.some((p) => /\.(png|tga)$/i.test(p));
    if (needsTexture && !hasTexture) {
      problems.push({
        severity: 'warning',
        message: `${label}: texture files are referenced but none are included — drop your PNGs into the textures folder before importing.`,
      });
    }
  }

  // An entity that references a geometry the pack does not contain imports
  // cleanly and is then invisible in game — the worst kind of failure, because
  // nothing reports it. Same for render controllers.
  problems.push(...validateEntityReferences(packs));

  if (packs.length === 1 && packs[0].kind === 'behavior') {
    problems.push({
      severity: 'warning',
      message: 'Behaviour pack only — without a resource pack the content works but has no textures or names.',
    });
  }

  return problems;
}

interface ClientEntity {
  'minecraft:client_entity'?: {
    description?: {
      geometry?: Record<string, string>;
      render_controllers?: Array<string | Record<string, unknown>>;
      textures?: Record<string, string>;
    };
  };
}

/**
 * Cross-checks what an entity says it needs against what the pack ships.
 *
 * Bedrock does not complain about a missing geometry: the add-on imports, the
 * entity spawns, and nothing is drawn. Catching it here is the difference
 * between a one-line fix and an afternoon of wondering why the mob is
 * invisible.
 */
function validateEntityReferences(packs: DetectedPack[]): PackProblem[] {
  const problems: PackProblem[] = [];
  const all = packs.flatMap((p) => p.files);

  // Every geometry identifier the pack actually defines.
  const defined = new Set<string>();
  for (const file of all) {
    if (!/\.geo\.json$/.test(file.path)) continue;
    try {
      const parsed = JSON.parse(file.content) as { 'minecraft:geometry'?: Array<{ description?: { identifier?: string } }> };
      for (const geo of parsed['minecraft:geometry'] ?? []) {
        if (geo?.description?.identifier) defined.add(geo.description.identifier);
      }
    } catch {
      problems.push({ severity: 'blocker', message: `${file.path} is not valid JSON, so the model will not load.` });
    }
  }

  const controllers = new Set<string>();
  for (const file of all) {
    if (!/render_controllers?.*\.json$/.test(file.path)) continue;
    try {
      const parsed = JSON.parse(file.content) as { render_controllers?: Record<string, unknown> };
      Object.keys(parsed.render_controllers ?? {}).forEach((k) => controllers.add(k));
    } catch {
      /* reported elsewhere if it matters */
    }
  }

  for (const file of all) {
    if (!/\.entity\.json$/.test(file.path)) continue;
    let desc: ClientEntity['minecraft:client_entity'];
    try {
      desc = (JSON.parse(file.content) as ClientEntity)['minecraft:client_entity'];
    } catch {
      problems.push({ severity: 'blocker', message: `${file.path} is not valid JSON.` });
      continue;
    }

    const wanted = Object.values(desc?.description?.geometry ?? {});
    if (!wanted.length) {
      problems.push({ severity: 'blocker', message: `${file.path} declares no geometry, so the entity has no model.` });
    }
    for (const id of wanted) {
      if (!defined.has(id)) {
        problems.push({
          severity: 'blocker',
          message: `${file.path} uses geometry "${id}", but no .geo.json in the pack defines it — the entity would be invisible in game.`,
        });
      }
    }

    for (const rc of desc?.description?.render_controllers ?? []) {
      const id = typeof rc === 'string' ? rc : Object.keys(rc)[0];
      if (id && !controllers.has(id)) {
        problems.push({ severity: 'warning', message: `${file.path} references render controller "${id}", which this pack does not define.` });
      }
    }
  }

  return problems;
}
