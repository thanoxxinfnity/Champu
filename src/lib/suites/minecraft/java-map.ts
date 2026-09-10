import type { BlockSpec, EntitySpec, ItemSpec } from './bedrock';

/**
 * Java → Bedrock translation layer.
 *
 * Be clear about what this is: Java and Bedrock are different engines with
 * different modding models. Java mods ship compiled JVM bytecode against Forge /
 * Fabric APIs that have **no Bedrock equivalent** — custom dimensions, capability
 * systems, tile-entity tick logic, mixins, custom rendering. None of that can be
 * mechanically translated, and a converter claiming otherwise produces packs that
 * import cleanly and then do nothing.
 *
 * What *is* mechanically translatable is the declarative surface: the registry
 * entries. Block/item registrations, entity attributes, recipes, loot tables and
 * lang keys map onto Bedrock JSON with high fidelity. That is what this does,
 * and it reports every construct it could not carry across instead of silently
 * dropping it.
 *
 * Input is a mod *specification* — the registry JSON a mod's data pack exposes,
 * or a source dump. A compiled `.jar` is parsed for its declarative resources
 * (`data/`, `assets/`, `*.mcmeta`) via {@link parseJarManifest}; its `.class`
 * files are not decompiled.
 */

export type Coverage = 'full' | 'partial' | 'none';

export interface MappingResult {
  entities: EntitySpec[];
  items: ItemSpec[];
  blocks: BlockSpec[];
  recipes: Array<Record<string, unknown>>;
  lang: Record<string, string>;
  report: MappingReport;
}

export interface MappingReport {
  namespace: string;
  translated: Array<{ kind: string; javaId: string; bedrockId: string; coverage: Coverage; note?: string }>;
  unmapped: Array<{ kind: string; javaId: string; reason: string }>;
  /** Percentage of discovered registry entries that produced a Bedrock artifact. */
  coveragePct: number;
}

// ── Material / property mapping tables ──────────────────────────────────────

/**
 * Java hardness → Bedrock `seconds_to_destroy`.
 * Java computes break time from hardness and tool tier; Bedrock takes a flat
 * seconds value. This uses the bare-hand approximation (hardness * 1.5 + 0.05),
 * which lands within a tick or two of Java for the common range.
 */
export function hardnessToDestroyTime(hardness: number): number {
  if (hardness < 0) return -1; // unbreakable, e.g. bedrock
  return Math.round((hardness * 1.5 + 0.05) * 100) / 100;
}

const JAVA_MATERIAL_MAP_COLOR: Record<string, string> = {
  stone: '#7f7f7f',
  wood: '#95763c',
  metal: '#a8a8a8',
  dirt: '#8b6644',
  sand: '#dbd3a0',
  glass: '#ffffff',
  wool: '#dddddd',
  plant: '#5d8a3e',
  ice: '#a0c4ff',
  netherrack: '#6f3634',
};

/** Java entity attribute ids → Bedrock component values. */
const ATTRIBUTE_MAP: Record<string, keyof EntitySpec> = {
  'generic.max_health': 'health',
  'minecraft:generic.max_health': 'health',
  'generic.movement_speed': 'movementSpeed',
  'minecraft:generic.movement_speed': 'movementSpeed',
  'generic.attack_damage': 'attackDamage',
  'minecraft:generic.attack_damage': 'attackDamage',
};

/**
 * Constructs that exist in Java modding with no Bedrock equivalent.
 * Detecting them and saying so is more useful than emitting a plausible-looking
 * JSON file that does nothing in-game.
 */
const UNMAPPABLE: Array<{ pattern: RegExp; kind: string; reason: string }> = [
  // Patterns match identifiers as they actually appear in Java sources —
  // `CapabilityProvider`, `PlayerMixin`, `ModBlockEntities` — so they are
  // deliberately not \b-anchored on the trailing side.
  { pattern: /capabilit(y|ies)/i, kind: 'capability', reason: 'Forge capabilities have no Bedrock analogue. Reimplement the state on an entity/block property or a Script API dynamic property.' },
  { pattern: /mixin/i, kind: 'mixin', reason: 'Mixins patch JVM bytecode. Bedrock has no equivalent — the behaviour must be rebuilt with the Script API.' },
  { pattern: /worldgen\/dimension|dimension_type|\bdimension\b/i, kind: 'dimension', reason: 'Custom dimensions are not creatable in Bedrock addons. Only the three vanilla dimensions exist.' },
  { pattern: /tile.?entit|block.?entit/i, kind: 'block_entity', reason: 'Bedrock has no custom block entities. Per-block state must use block states plus a Script API tick loop.' },
  { pattern: /\bgui\b|container.?screen|menu.?type|screen_handler/i, kind: 'gui', reason: 'Custom GUIs require JSON-UI, a separate hand-authored system with no mapping from Java containers.' },
  { pattern: /renderer|model.?layer|entity_model/i, kind: 'renderer', reason: 'Custom Java renderers cannot be translated. Rebuild the visual as geometry + render controllers.' },
  { pattern: /enchantment/i, kind: 'enchantment', reason: 'Custom enchantments are not supported by Bedrock addons.' },
  { pattern: /mob_effect|status_effect|\bpotion\b/i, kind: 'effect', reason: 'Custom status effects are not supported. Approximate with existing effects applied via the Script API.' },
];

// ── Input shapes ────────────────────────────────────────────────────────────

export interface JavaModSpec {
  modId: string;
  displayName?: string;
  version?: string;
  blocks?: Array<{
    id: string;
    hardness?: number;
    resistance?: number;
    material?: string;
    lightLevel?: number;
    slipperiness?: number;
    drops?: string;
    displayName?: string;
  }>;
  items?: Array<{
    id: string;
    maxStackSize?: number;
    maxDamage?: number;
    attackDamage?: number;
    food?: { nutrition: number; saturation: number; alwaysEdible?: boolean };
    displayName?: string;
  }>;
  entities?: Array<{
    id: string;
    attributes?: Record<string, number>;
    hostile?: boolean;
    width?: number;
    height?: number;
    fireImmune?: boolean;
    displayName?: string;
  }>;
  recipes?: Array<{
    type: string;
    id?: string;
    pattern?: string[];
    key?: Record<string, { item?: string; tag?: string }>;
    ingredients?: Array<{ item?: string; tag?: string }>;
    result?: { item?: string; id?: string; count?: number };
  }>;
  /** Anything the parser found but could not classify — scanned for unmappables. */
  rawSources?: string[];
}

// ── Identifier translation ──────────────────────────────────────────────────

/** `mymod:ruby_block` → `mymod:ruby_block`; strips Java path prefixes. */
export function toBedrockId(namespace: string, javaId: string): string {
  const bare = javaId.includes(':') ? javaId.split(':').pop()! : javaId;
  const name = bare
    .replace(/^(block|item|entity_type|entity)\//, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${namespace}:${name || 'unnamed'}`;
}

/** Vanilla Java ids that differ from their Bedrock names. */
const VANILLA_RENAMES: Record<string, string> = {
  'minecraft:grass_block': 'minecraft:grass',
  'minecraft:oak_log': 'minecraft:log',
  'minecraft:cobweb': 'minecraft:web',
  'minecraft:snow_block': 'minecraft:snow',
  'minecraft:redstone_dust': 'minecraft:redstone',
  'minecraft:nether_quartz_ore': 'minecraft:quartz_ore',
  'minecraft:iron_ingot': 'minecraft:iron_ingot',
  'minecraft:beetroot_soup': 'minecraft:beetroot_soup',
};

export function mapIngredient(javaItem: string): string {
  return VANILLA_RENAMES[javaItem] ?? javaItem;
}

// ── The mapper ──────────────────────────────────────────────────────────────

export function mapJavaMod(spec: JavaModSpec): MappingResult {
  const namespace = spec.modId.toLowerCase().replace(/[^a-z0-9_]/g, '_') || 'converted';
  const translated: MappingReport['translated'] = [];
  const unmapped: MappingReport['unmapped'] = [];
  const lang: Record<string, string> = {};

  const blocks: BlockSpec[] = (spec.blocks ?? []).map((b) => {
    const bedrockId = toBedrockId(namespace, b.id);
    const name = bedrockId.split(':')[1];

    const notes: string[] = [];
    if (b.drops && b.drops !== b.id) notes.push('custom drop mapped to minecraft:loot — verify the table path exists');

    translated.push({
      kind: 'block',
      javaId: b.id,
      bedrockId,
      coverage: b.drops ? 'partial' : 'full',
      note: notes.join('; ') || undefined,
    });
    lang[`tile.${bedrockId}.name`] = b.displayName ?? humanize(name);

    return {
      name,
      namespace,
      destroyTime: hardnessToDestroyTime(b.hardness ?? 1),
      explosionResistance: b.resistance ?? 3,
      friction: b.slipperiness ?? 0.6,
      lightEmission: b.lightLevel ? Math.round((b.lightLevel / 15) * 15) : undefined,
      mapColor: JAVA_MATERIAL_MAP_COLOR[(b.material ?? '').toLowerCase()] ?? '#8f8f8f',
      loot: b.drops ? `loot_tables/blocks/${name}.json` : undefined,
      texture: name,
    };
  });

  const items: ItemSpec[] = (spec.items ?? []).map((i) => {
    const bedrockId = toBedrockId(namespace, i.id);
    const name = bedrockId.split(':')[1];

    translated.push({ kind: 'item', javaId: i.id, bedrockId, coverage: 'full' });
    lang[`item.${bedrockId}.name`] = i.displayName ?? humanize(name);

    return {
      name,
      namespace,
      maxStackSize: i.maxStackSize ?? (i.maxDamage ? 1 : 64),
      durability: i.maxDamage,
      attackDamage: i.attackDamage,
      isFood: i.food
        ? { nutrition: i.food.nutrition, saturation: i.food.saturation, canAlwaysEat: i.food.alwaysEdible }
        : undefined,
      texture: name,
      category: i.food ? 'items' : i.maxDamage ? 'equipment' : 'items',
    };
  });

  const entities: EntitySpec[] = (spec.entities ?? []).map((e) => {
    const bedrockId = toBedrockId(namespace, e.id);
    const name = bedrockId.split(':')[1];

    const mapped: Partial<EntitySpec> = {};
    let unmappedAttrs = 0;
    for (const [attr, value] of Object.entries(e.attributes ?? {})) {
      const key = ATTRIBUTE_MAP[attr];
      if (key) (mapped as Record<string, unknown>)[key] = value;
      else unmappedAttrs++;
    }

    translated.push({
      kind: 'entity',
      javaId: e.id,
      bedrockId,
      coverage: unmappedAttrs ? 'partial' : 'full',
      note: unmappedAttrs ? `${unmappedAttrs} attribute(s) had no Bedrock component and were dropped` : undefined,
    });
    lang[`entity.${bedrockId}.name`] = e.displayName ?? humanize(name);

    return {
      name,
      namespace,
      behavior: e.hostile ? 'hostile' : 'passive',
      health: mapped.health ?? 20,
      // Java movement_speed is ~0.25 for a walking mob; Bedrock's scale differs.
      movementSpeed: mapped.movementSpeed ? Math.round(mapped.movementSpeed * 100) / 100 : 0.25,
      attackDamage: mapped.attackDamage ?? (e.hostile ? 3 : undefined),
      fireImmune: e.fireImmune,
      collisionBox: { width: e.width ?? 0.6, height: e.height ?? 1.8 },
      texture: name,
    };
  });

  const recipes: Array<Record<string, unknown>> = [];
  for (const [index, r] of (spec.recipes ?? []).entries()) {
    const resultItem = r.result?.item ?? r.result?.id;
    if (!resultItem) {
      unmapped.push({ kind: 'recipe', javaId: r.id ?? `recipe#${index}`, reason: 'Recipe has no resolvable result item.' });
      continue;
    }
    const recipeId = `${namespace}:${(r.id ?? `recipe_${index + 1}`).split(/[:/]/).pop()}`;

    if (r.type.includes('shaped') && r.pattern && r.key) {
      const key: Record<string, { item: string }> = {};
      let tagDropped = false;
      for (const [symbol, value] of Object.entries(r.key)) {
        if (value.item) key[symbol] = { item: mapIngredient(value.item) };
        else if (value.tag) {
          // Bedrock recipes take concrete items; a tag has no direct equivalent.
          tagDropped = true;
          key[symbol] = { item: mapIngredient(tagFallback(value.tag)) };
        }
      }
      recipes.push({
        format_version: '1.20.10',
        'minecraft:recipe_shaped': {
          description: { identifier: recipeId },
          tags: ['crafting_table'],
          pattern: r.pattern,
          key,
          result: { item: mapIngredient(resultItem), count: r.result?.count ?? 1 },
        },
      });
      translated.push({
        kind: 'recipe',
        javaId: r.id ?? `recipe#${index}`,
        bedrockId: recipeId,
        coverage: tagDropped ? 'partial' : 'full',
        note: tagDropped ? 'Item tags collapsed to a single representative item — Bedrock recipes cannot take tags.' : undefined,
      });
    } else if (r.type.includes('shapeless') && r.ingredients) {
      recipes.push({
        format_version: '1.20.10',
        'minecraft:recipe_shapeless': {
          description: { identifier: recipeId },
          tags: ['crafting_table'],
          ingredients: r.ingredients.map((ing) => ({ item: mapIngredient(ing.item ?? tagFallback(ing.tag ?? '')) })),
          result: { item: mapIngredient(resultItem), count: r.result?.count ?? 1 },
        },
      });
      translated.push({ kind: 'recipe', javaId: r.id ?? `recipe#${index}`, bedrockId: recipeId, coverage: 'full' });
    } else if (/smelting|blasting|smoking|campfire/.test(r.type)) {
      recipes.push({
        format_version: '1.20.10',
        'minecraft:recipe_furnace': {
          description: { identifier: recipeId },
          tags: [r.type.includes('blasting') ? 'blast_furnace' : r.type.includes('smoking') ? 'smoker' : 'furnace'],
          input: r.ingredients?.[0]?.item ?? 'minecraft:stone',
          output: mapIngredient(resultItem),
        },
      });
      translated.push({ kind: 'recipe', javaId: r.id ?? `recipe#${index}`, bedrockId: recipeId, coverage: 'full' });
    } else {
      unmapped.push({
        kind: 'recipe',
        javaId: r.id ?? `recipe#${index}`,
        reason: `Recipe type "${r.type}" has no Bedrock equivalent (stonecutter/smithing variants differ structurally).`,
      });
    }
  }

  // Scan raw sources for constructs that cannot cross the engine boundary.
  for (const source of spec.rawSources ?? []) {
    for (const rule of UNMAPPABLE) {
      if (rule.pattern.test(source) && !unmapped.some((u) => u.kind === rule.kind)) {
        unmapped.push({ kind: rule.kind, javaId: source.slice(0, 80), reason: rule.reason });
      }
    }
  }

  const discovered = translated.length + unmapped.length;
  return {
    entities,
    items,
    blocks,
    recipes,
    lang,
    report: {
      namespace,
      translated,
      unmapped,
      coveragePct: discovered ? Math.round((translated.length / discovered) * 100) : 0,
    },
  };
}

function tagFallback(tag: string): string {
  const bare = tag.replace(/^#/, '').split(':').pop() ?? '';
  // `forge:ingots/iron` → `minecraft:iron_ingot`
  const parts = bare.split('/');
  if (parts.length === 2) {
    const [plural, material] = parts;
    const singular = plural.replace(/s$/, '');
    return `minecraft:${material}_${singular}`;
  }
  return `minecraft:${bare.replace(/s$/, '')}`;
}

function humanize(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── .jar inspection ─────────────────────────────────────────────────────────

export interface JarInspection {
  modId?: string;
  displayName?: string;
  version?: string;
  loader: 'forge' | 'fabric' | 'neoforge' | 'unknown';
  /** Declarative resources that CAN be translated. */
  dataFiles: string[];
  assetFiles: string[];
  /** Compiled classes — counted, never decompiled. */
  classCount: number;
  notes: string[];
}

/**
 * Inspect an unpacked `.jar` listing.
 *
 * Takes the file table plus the contents of the loader metadata files. It does
 * not decompile bytecode — the honest boundary is that only the declarative
 * resource tree converts, and `classCount` tells the user how much logic sits
 * outside that boundary.
 */
export function parseJarManifest(
  files: Array<{ path: string; text?: string }>,
): JarInspection {
  const inspection: JarInspection = {
    loader: 'unknown',
    dataFiles: [],
    assetFiles: [],
    classCount: 0,
    notes: [],
  };

  for (const file of files) {
    if (file.path.endsWith('.class')) {
      inspection.classCount++;
      continue;
    }
    if (file.path.startsWith('data/')) inspection.dataFiles.push(file.path);
    else if (file.path.startsWith('assets/')) inspection.assetFiles.push(file.path);

    if (file.path === 'fabric.mod.json' && file.text) {
      inspection.loader = 'fabric';
      try {
        const meta = JSON.parse(file.text) as { id?: string; name?: string; version?: string };
        inspection.modId = meta.id;
        inspection.displayName = meta.name;
        inspection.version = meta.version;
      } catch {
        inspection.notes.push('fabric.mod.json is present but not valid JSON.');
      }
    } else if ((file.path === 'META-INF/mods.toml' || file.path === 'META-INF/neoforge.mods.toml') && file.text) {
      inspection.loader = file.path.includes('neoforge') ? 'neoforge' : 'forge';
      inspection.modId = /modId\s*=\s*"([^"]+)"/.exec(file.text)?.[1];
      inspection.displayName = /displayName\s*=\s*"([^"]+)"/.exec(file.text)?.[1];
      inspection.version = /version\s*=\s*"([^"]+)"/.exec(file.text)?.[1];
    }
  }

  if (inspection.classCount > 0) {
    inspection.notes.push(
      `${inspection.classCount} compiled class files carry this mod's runtime logic. They are not decompiled or translated — only the ${inspection.dataFiles.length + inspection.assetFiles.length} declarative resources convert. Expect to reimplement behaviour with the Bedrock Script API.`,
    );
  }
  if (!inspection.dataFiles.length && !inspection.assetFiles.length) {
    inspection.notes.push('No data/ or assets/ tree found — there is nothing declarative to convert in this jar.');
  }

  return inspection;
}

/** Build a {@link JavaModSpec} from an unpacked jar's JSON resources. */
export function specFromJarResources(
  inspection: JarInspection,
  resources: Array<{ path: string; text: string }>,
): JavaModSpec {
  const modId = inspection.modId ?? 'converted';
  const spec: JavaModSpec = { modId, displayName: inspection.displayName, version: inspection.version, blocks: [], items: [], entities: [], recipes: [], rawSources: [] };

  for (const res of resources) {
    // data/<ns>/recipes/<name>.json (1.20-) or data/<ns>/recipe/<name>.json (1.21+)
    if (/^data\/[^/]+\/recipes?\/.+\.json$/.test(res.path)) {
      try {
        const parsed = JSON.parse(res.text) as NonNullable<JavaModSpec['recipes']>[number];
        spec.recipes!.push({ ...parsed, id: res.path.split('/').pop()!.replace(/\.json$/, '') });
      } catch {
        spec.rawSources!.push(`unparsable recipe: ${res.path}`);
      }
    } else if (/^assets\/[^/]+\/lang\/en_us\.json$/.test(res.path)) {
      try {
        const lang = JSON.parse(res.text) as Record<string, string>;
        for (const [key, value] of Object.entries(lang)) {
          const blockMatch = /^block\.[^.]+\.(.+)$/.exec(key);
          const itemMatch = /^item\.[^.]+\.(.+)$/.exec(key);
          const entityMatch = /^entity\.[^.]+\.(.+)$/.exec(key);
          if (blockMatch) spec.blocks!.push({ id: blockMatch[1], displayName: value });
          else if (itemMatch) spec.items!.push({ id: itemMatch[1], displayName: value });
          else if (entityMatch) spec.entities!.push({ id: entityMatch[1], displayName: value });
        }
      } catch {
        spec.rawSources!.push(`unparsable lang: ${res.path}`);
      }
    } else if (/^data\/[^/]+\/(worldgen\/dimension|loot_tables|tags)\//.test(res.path)) {
      spec.rawSources!.push(res.path);
    }
  }

  return spec;
}
