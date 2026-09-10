import type { ZipEntry } from '@/lib/zip';

/**
 * Bedrock addon schema generator.
 *
 * Produces manifests, entity/item/block definitions, animation controllers,
 * render controllers, recipes and lang files that load in Minecraft Bedrock
 * without hand-editing.
 *
 * Format versions are pinned deliberately. Bedrock is unusually strict: a
 * behaviour written for 1.16.0 semantics but declared as 1.21.0 silently stops
 * firing, so the generator declares the version its component shapes actually
 * target and keeps them consistent across every file in the pack.
 */

export const FORMAT = {
  /** Pack manifest schema. */
  manifest: 2,
  /** Entity/item/block definition format_version. */
  definition: '1.21.0',
  /** Client entity definitions still use the 1.10.0 schema. */
  clientEntity: '1.10.0',
  /** Animation controllers. */
  animationController: '1.10.0',
  /** Render controllers. */
  renderController: '1.8.0',
  /** Geometry. */
  geometry: '1.16.0',
  /** Recipes. */
  recipe: '1.20.10',
  /** Minimum engine the packs declare. */
  minEngine: [1, 21, 0] as [number, number, number],
} as const;

export type UUID = string;

export function uuid(): UUID {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // RFC 4122 v4 fallback for non-secure contexts.
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Identifiers must be `namespace:name`, lowercase, no spaces. */
export function identifier(namespace: string, name: string): string {
  const ns = namespace.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'chomugiri';
  const id = name.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'thing';
  return `${ns}:${id}`;
}

export interface PackMeta {
  name: string;
  description: string;
  namespace: string;
  version: [number, number, number];
  author?: string;
}

export interface Manifest {
  format_version: number;
  header: Record<string, unknown>;
  modules: Array<Record<string, unknown>>;
  dependencies?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
}

export interface PackPair {
  behaviorUuid: UUID;
  behaviorModuleUuid: UUID;
  resourceUuid: UUID;
  resourceModuleUuid: UUID;
}

export function newPackPair(): PackPair {
  return {
    behaviorUuid: uuid(),
    behaviorModuleUuid: uuid(),
    resourceUuid: uuid(),
    resourceModuleUuid: uuid(),
  };
}

/**
 * Behaviour and resource manifests must cross-reference by UUID or the client
 * loads textures without behaviours (or the reverse) and everything looks broken
 * in-game with no error message.
 */
export function behaviorManifest(meta: PackMeta, ids: PackPair): Manifest {
  return {
    format_version: FORMAT.manifest,
    header: {
      name: `${meta.name} BP`,
      description: meta.description,
      uuid: ids.behaviorUuid,
      version: meta.version,
      min_engine_version: FORMAT.minEngine,
    },
    modules: [
      { type: 'data', uuid: ids.behaviorModuleUuid, version: meta.version, description: `${meta.name} behaviours` },
    ],
    dependencies: [{ uuid: ids.resourceUuid, version: meta.version }],
    metadata: {
      authors: [meta.author ?? 'Chomugiri'],
      generated_with: { chomugiri: ['1.0.0'] },
    },
  };
}

export function resourceManifest(meta: PackMeta, ids: PackPair): Manifest {
  return {
    format_version: FORMAT.manifest,
    header: {
      name: `${meta.name} RP`,
      description: meta.description,
      uuid: ids.resourceUuid,
      version: meta.version,
      min_engine_version: FORMAT.minEngine,
    },
    modules: [
      { type: 'resources', uuid: ids.resourceModuleUuid, version: meta.version, description: `${meta.name} resources` },
    ],
    dependencies: [{ uuid: ids.behaviorUuid, version: meta.version }],
    metadata: {
      authors: [meta.author ?? 'Chomugiri'],
      generated_with: { chomugiri: ['1.0.0'] },
    },
  };
}

// ── Entities ────────────────────────────────────────────────────────────────

export interface EntitySpec {
  name: string;
  namespace: string;
  /** Passive wanders and flees; hostile targets and attacks; ambient does neither. */
  behavior: 'passive' | 'hostile' | 'ambient';
  health: number;
  movementSpeed: number;
  attackDamage?: number;
  isSummonable?: boolean;
  isSpawnable?: boolean;
  fireImmune?: boolean;
  scale?: number;
  collisionBox?: { width: number; height: number };
  familyTypes?: string[];
  /** Texture path relative to `textures/entity/`. */
  texture?: string;
  geometryId?: string;
  spawnEgg?: { base: string; overlay: string };
  lootTable?: string;
}

export function entityBehavior(spec: EntitySpec): Record<string, unknown> {
  const id = identifier(spec.namespace, spec.name);
  const families = spec.familyTypes ?? (spec.behavior === 'hostile' ? ['monster', 'mob'] : ['mob']);

  const components: Record<string, unknown> = {
    'minecraft:type_family': { family: [spec.name.toLowerCase().replace(/\W/g, '_'), ...families] },
    'minecraft:health': { value: spec.health, max: spec.health },
    'minecraft:movement': { value: spec.movementSpeed },
    'minecraft:navigation.walk': { can_path_over_water: false, avoid_water: spec.behavior !== 'hostile' },
    'minecraft:movement.basic': {},
    'minecraft:jump.static': {},
    'minecraft:can_climb': {},
    'minecraft:physics': {},
    'minecraft:collision_box': {
      width: spec.collisionBox?.width ?? 0.6,
      height: spec.collisionBox?.height ?? 1.8,
    },
    'minecraft:nameable': {},
    'minecraft:pushable': { is_pushable: true, is_pushable_by_piston: true },
    'minecraft:despawn': { despawn_from_distance: {} },
  };

  if (spec.scale && spec.scale !== 1) components['minecraft:scale'] = { value: spec.scale };
  if (spec.fireImmune) components['minecraft:fire_immune'] = {};
  if (spec.lootTable) components['minecraft:loot'] = { table: spec.lootTable };

  if (spec.behavior === 'hostile') {
    components['minecraft:attack'] = { damage: spec.attackDamage ?? 3 };
    components['minecraft:behavior.melee_attack'] = { priority: 3, track_target: true };
    components['minecraft:behavior.nearest_attackable_target'] = {
      priority: 2,
      must_see: true,
      reselect_targets: true,
      within_radius: 16,
      entity_types: [
        { filters: { any_of: [{ test: 'is_family', subject: 'other', value: 'player' }] }, max_dist: 16 },
      ],
    };
    components['minecraft:behavior.hurt_by_target'] = { priority: 1 };
  } else if (spec.behavior === 'passive') {
    components['minecraft:behavior.panic'] = { priority: 1, speed_multiplier: 1.25 };
    components['minecraft:behavior.tempt'] = { priority: 4, speed_multiplier: 1.2, items: ['wheat'] };
  }

  components['minecraft:behavior.random_stroll'] = { priority: 6, speed_multiplier: 1 };
  components['minecraft:behavior.look_at_player'] = { priority: 7, look_distance: 6, probability: 0.02 };
  components['minecraft:behavior.random_look_around'] = { priority: 8 };

  return {
    format_version: FORMAT.definition,
    'minecraft:entity': {
      description: {
        identifier: id,
        is_spawnable: spec.isSpawnable ?? true,
        is_summonable: spec.isSummonable ?? true,
        is_experimental: false,
      },
      component_groups: {
        [`${id.split(':')[1]}_baby`]: {
          'minecraft:is_baby': {},
          'minecraft:scale': { value: (spec.scale ?? 1) * 0.5 },
        },
      },
      components,
      events: {
        'minecraft:entity_spawned': {},
        'minecraft:entity_born': { add: { component_groups: [`${id.split(':')[1]}_baby`] } },
      },
    },
  };
}

export function entityClient(spec: EntitySpec): Record<string, unknown> {
  const id = identifier(spec.namespace, spec.name);
  const short = id.split(':')[1];
  const geo = spec.geometryId ?? `geometry.${short}`;

  return {
    format_version: FORMAT.clientEntity,
    'minecraft:client_entity': {
      description: {
        identifier: id,
        materials: { default: 'entity_alphatest' },
        textures: { default: `textures/entity/${spec.texture ?? short}` },
        geometry: { default: geo },
        render_controllers: [`controller.render.${short}`],
        animations: {
          walk: `animation.${short}.walk`,
          look_at_target: `animation.${short}.look_at_target`,
        },
        scripts: {
          animate: [{ walk: 'query.modified_move_speed > 0.05' }, 'look_at_target'],
        },
        spawn_egg: spec.spawnEgg
          ? { base_colour: spec.spawnEgg.base, overlay_colour: spec.spawnEgg.overlay }
          : { base_colour: '#3f6d4a', overlay_colour: '#c4d8b0' },
      },
    },
  };
}

export function renderController(spec: EntitySpec): Record<string, unknown> {
  const short = identifier(spec.namespace, spec.name).split(':')[1];
  return {
    format_version: FORMAT.renderController,
    render_controllers: {
      [`controller.render.${short}`]: {
        geometry: 'Geometry.default',
        materials: [{ '*': 'Material.default' }],
        textures: ['Texture.default'],
      },
    },
  };
}

/**
 * Animation controller. Bedrock will not play an animation that is not routed
 * through a controller state, which is the single most common reason a generated
 * addon renders a frozen T-pose.
 */
export function animationController(spec: EntitySpec): Record<string, unknown> {
  const short = identifier(spec.namespace, spec.name).split(':')[1];
  return {
    format_version: FORMAT.animationController,
    animation_controllers: {
      [`controller.animation.${short}.move`]: {
        initial_state: 'default',
        states: {
          default: {
            animations: [],
            transitions: [{ moving: 'query.modified_move_speed > 0.05' }],
          },
          moving: {
            animations: ['walk'],
            transitions: [{ default: 'query.modified_move_speed <= 0.05' }],
            blend_transition: 0.2,
          },
        },
      },
    },
  };
}

/** A simple procedural walk cycle so the entity is not static out of the box. */
export function walkAnimation(spec: EntitySpec): Record<string, unknown> {
  const short = identifier(spec.namespace, spec.name).split(':')[1];
  return {
    format_version: '1.8.0',
    animations: {
      [`animation.${short}.walk`]: {
        loop: true,
        animation_length: 1,
        bones: {
          leg0: { rotation: ['math.cos(query.anim_time * 360) * 25', 0, 0] },
          leg1: { rotation: ['-math.cos(query.anim_time * 360) * 25', 0, 0] },
          arm0: { rotation: ['-math.cos(query.anim_time * 360) * 20', 0, 0] },
          arm1: { rotation: ['math.cos(query.anim_time * 360) * 20', 0, 0] },
        },
      },
      [`animation.${short}.look_at_target`]: {
        loop: true,
        bones: {
          head: {
            rotation: ['math.clamp(query.target_x_rotation, -40, 40)', 'math.clamp(query.target_y_rotation, -60, 60)', 0],
          },
        },
      },
    },
  };
}

// ── Items & blocks ──────────────────────────────────────────────────────────

export interface ItemSpec {
  name: string;
  namespace: string;
  category?: 'construction' | 'equipment' | 'items' | 'nature' | 'none';
  maxStackSize?: number;
  /** Turns the item into a tool/weapon with durability. */
  durability?: number;
  attackDamage?: number;
  isFood?: { nutrition: number; saturation: number; canAlwaysEat?: boolean };
  texture?: string;
}

export function itemDefinition(spec: ItemSpec): Record<string, unknown> {
  const id = identifier(spec.namespace, spec.name);
  const components: Record<string, unknown> = {
    'minecraft:icon': { texture: spec.texture ?? id.split(':')[1] },
    'minecraft:max_stack_size': spec.maxStackSize ?? (spec.durability ? 1 : 64),
    'minecraft:display_name': { value: `item.${id}.name` },
  };

  if (spec.durability) {
    components['minecraft:durability'] = { max_durability: spec.durability };
    components['minecraft:damage'] = { value: spec.attackDamage ?? 1 };
    components['minecraft:hand_equipped'] = true;
  }
  if (spec.isFood) {
    components['minecraft:food'] = {
      nutrition: spec.isFood.nutrition,
      saturation_modifier: spec.isFood.saturation,
      can_always_eat: spec.isFood.canAlwaysEat ?? false,
    };
    components['minecraft:use_modifiers'] = { use_duration: 1.6, movement_modifier: 0.35 };
  }

  return {
    format_version: FORMAT.definition,
    'minecraft:item': {
      description: { identifier: id, menu_category: { category: spec.category ?? 'items' } },
      components,
    },
  };
}

export interface BlockSpec {
  name: string;
  namespace: string;
  destroyTime?: number;
  explosionResistance?: number;
  friction?: number;
  lightEmission?: number;
  mapColor?: string;
  material?: string;
  texture?: string;
  category?: 'construction' | 'equipment' | 'items' | 'nature' | 'none';
  /** Emits a loot drop of this identifier instead of itself. */
  loot?: string;
}

export function blockDefinition(spec: BlockSpec): Record<string, unknown> {
  const id = identifier(spec.namespace, spec.name);
  const components: Record<string, unknown> = {
    'minecraft:destructible_by_mining': { seconds_to_destroy: spec.destroyTime ?? 1.5 },
    'minecraft:destructible_by_explosion': { explosion_resistance: spec.explosionResistance ?? 3 },
    'minecraft:friction': spec.friction ?? 0.6,
    'minecraft:map_color': spec.mapColor ?? '#8f8f8f',
    'minecraft:geometry': 'minecraft:geometry.full_block',
    'minecraft:material_instances': {
      '*': {
        texture: spec.texture ?? id.split(':')[1],
        render_method: 'opaque',
        ambient_occlusion: true,
        face_dimming: true,
      },
    },
  };

  if (spec.lightEmission) components['minecraft:light_emission'] = spec.lightEmission;
  if (spec.loot) components['minecraft:loot'] = spec.loot;

  return {
    format_version: FORMAT.definition,
    'minecraft:block': {
      description: { identifier: id, menu_category: { category: spec.category ?? 'construction' } },
      components,
    },
  };
}

// ── Recipes ─────────────────────────────────────────────────────────────────

export interface ShapedRecipeSpec {
  id: string;
  namespace: string;
  pattern: string[];
  key: Record<string, { item: string; data?: number }>;
  result: { item: string; count?: number };
  tags?: string[];
}

export function shapedRecipe(spec: ShapedRecipeSpec): Record<string, unknown> {
  return {
    format_version: FORMAT.recipe,
    'minecraft:recipe_shaped': {
      description: { identifier: identifier(spec.namespace, spec.id) },
      tags: spec.tags ?? ['crafting_table'],
      pattern: spec.pattern,
      key: spec.key,
      result: spec.result,
    },
  };
}

export function shapelessRecipe(spec: {
  id: string;
  namespace: string;
  ingredients: Array<{ item: string; data?: number }>;
  result: { item: string; count?: number };
  tags?: string[];
}): Record<string, unknown> {
  return {
    format_version: FORMAT.recipe,
    'minecraft:recipe_shapeless': {
      description: { identifier: identifier(spec.namespace, spec.id) },
      tags: spec.tags ?? ['crafting_table'],
      ingredients: spec.ingredients,
      result: spec.result,
    },
  };
}

// ── Pack assembly ───────────────────────────────────────────────────────────

export interface AddonInput {
  meta: PackMeta;
  entities?: EntitySpec[];
  items?: ItemSpec[];
  blocks?: BlockSpec[];
  recipes?: Array<Record<string, unknown>>;
  /** `textures/entity/foo.png` → base64 data URL. */
  textures?: Record<string, string>;
  /** Extra geometry files keyed by geometry id. */
  geometries?: Record<string, unknown>;
  scripts?: Record<string, string>;
}

export interface BuiltAddon {
  behaviorFiles: ZipEntry[];
  resourceFiles: ZipEntry[];
  ids: PackPair;
  warnings: string[];
}

const j = (value: unknown): string => JSON.stringify(value, null, 2);

export function buildAddon(input: AddonInput): BuiltAddon {
  const ids = newPackPair();
  const warnings: string[] = [];
  const behaviorFiles: ZipEntry[] = [];
  const resourceFiles: ZipEntry[] = [];

  behaviorFiles.push({ path: 'manifest.json', content: j(behaviorManifest(input.meta, ids)) });
  resourceFiles.push({ path: 'manifest.json', content: j(resourceManifest(input.meta, ids)) });

  const bpLang: string[] = [];
  const rpLang: string[] = [];

  for (const entity of input.entities ?? []) {
    const id = identifier(entity.namespace, entity.name);
    const short = id.split(':')[1];

    behaviorFiles.push({ path: `entities/${short}.json`, content: j(entityBehavior(entity)) });
    resourceFiles.push({ path: `entity/${short}.entity.json`, content: j(entityClient(entity)) });
    resourceFiles.push({ path: `render_controllers/${short}.render_controllers.json`, content: j(renderController(entity)) });
    resourceFiles.push({ path: `animation_controllers/${short}.animation_controllers.json`, content: j(animationController(entity)) });
    resourceFiles.push({ path: `animations/${short}.animation.json`, content: j(walkAnimation(entity)) });

    rpLang.push(`entity.${id}.name=${entity.name}`);
    rpLang.push(`item.spawn_egg.entity.${id}.name=Spawn ${entity.name}`);

    if (!input.textures?.[`textures/entity/${entity.texture ?? short}.png`]) {
      warnings.push(`Entity "${entity.name}" references textures/entity/${entity.texture ?? short}.png, which is not in the pack. Minecraft will render it magenta-black.`);
    }
    if (!entity.geometryId && !input.geometries?.[`geometry.${short}`]) {
      warnings.push(`Entity "${entity.name}" has no geometry. Generate one in the Blockbench tab or it will not render.`);
    }
  }

  for (const item of input.items ?? []) {
    const id = identifier(item.namespace, item.name);
    const short = id.split(':')[1];
    behaviorFiles.push({ path: `items/${short}.json`, content: j(itemDefinition(item)) });
    rpLang.push(`item.${id}.name=${item.name}`);
  }

  for (const block of input.blocks ?? []) {
    const id = identifier(block.namespace, block.name);
    const short = id.split(':')[1];
    behaviorFiles.push({ path: `blocks/${short}.json`, content: j(blockDefinition(block)) });
    rpLang.push(`tile.${id}.name=${block.name}`);
  }

  (input.recipes ?? []).forEach((recipe, i) => {
    behaviorFiles.push({ path: `recipes/recipe_${i + 1}.json`, content: j(recipe) });
  });

  // Texture registries — without these the client cannot resolve short names.
  const itemTextures = Object.fromEntries(
    (input.items ?? []).map((i) => {
      const short = identifier(i.namespace, i.name).split(':')[1];
      return [i.texture ?? short, { textures: `textures/items/${i.texture ?? short}` }];
    }),
  );
  const terrainTextures = Object.fromEntries(
    (input.blocks ?? []).map((b) => {
      const short = identifier(b.namespace, b.name).split(':')[1];
      return [b.texture ?? short, { textures: `textures/blocks/${b.texture ?? short}` }];
    }),
  );

  if (Object.keys(itemTextures).length) {
    resourceFiles.push({
      path: 'textures/item_texture.json',
      content: j({ resource_pack_name: input.meta.namespace, texture_name: 'atlas.items', texture_data: itemTextures }),
    });
  }
  if (Object.keys(terrainTextures).length) {
    resourceFiles.push({
      path: 'textures/terrain_texture.json',
      content: j({
        resource_pack_name: input.meta.namespace,
        texture_name: 'atlas.terrain',
        padding: 8,
        num_mip_levels: 4,
        texture_data: terrainTextures,
      }),
    });
  }

  for (const [geoId, geo] of Object.entries(input.geometries ?? {})) {
    resourceFiles.push({ path: `models/entity/${geoId.replace(/^geometry\./, '')}.geo.json`, content: j(geo) });
  }

  for (const [path, dataUrl] of Object.entries(input.textures ?? {})) {
    resourceFiles.push({ path, content: dataUrlToBytesSafe(dataUrl) });
  }

  for (const [path, source] of Object.entries(input.scripts ?? {})) {
    behaviorFiles.push({ path: `scripts/${path}`, content: source });
  }

  // Bedrock requires en_US.lang plus languages.json or names show as raw keys.
  resourceFiles.push({ path: 'texts/languages.json', content: j(['en_US']) });
  resourceFiles.push({ path: 'texts/en_US.lang', content: [`pack.name=${input.meta.name}`, ...rpLang].join('\n') + '\n' });
  behaviorFiles.push({ path: 'texts/languages.json', content: j(['en_US']) });
  behaviorFiles.push({ path: 'texts/en_US.lang', content: [`pack.name=${input.meta.name}`, ...bpLang].join('\n') + '\n' });

  return { behaviorFiles, resourceFiles, ids, warnings };
}

function dataUrlToBytesSafe(dataUrl: string): Uint8Array {
  try {
    const comma = dataUrl.indexOf(',');
    if (comma === -1) return new Uint8Array();
    const binary = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return new Uint8Array();
  }
}

/** `.mcaddon` = both packs in one archive, each under its own folder. */
export function addonEntries(built: BuiltAddon, meta: PackMeta): ZipEntry[] {
  const slug = meta.name.toLowerCase().replace(/\W+/g, '_');
  return [
    ...built.behaviorFiles.map((f) => ({ ...f, path: `${slug}_bp/${f.path}` })),
    ...built.resourceFiles.map((f) => ({ ...f, path: `${slug}_rp/${f.path}` })),
  ];
}

// ── Validation ──────────────────────────────────────────────────────────────

export interface ValidationIssue {
  severity: 'error' | 'warning';
  file: string;
  message: string;
}

/**
 * Static validation against the constraints Bedrock enforces at load time but
 * reports only as a silent failure or an unhelpful "pack is corrupt".
 */
export function validateAddon(built: BuiltAddon): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seenUuids = new Set<string>();

  for (const [label, files] of [['BP', built.behaviorFiles], ['RP', built.resourceFiles]] as const) {
    const manifest = files.find((f) => f.path === 'manifest.json');
    if (!manifest) {
      issues.push({ severity: 'error', file: `${label}/manifest.json`, message: 'Pack has no manifest — Minecraft will refuse to import it.' });
      continue;
    }

    try {
      const parsed = JSON.parse(String(manifest.content)) as Manifest;
      const headerUuid = (parsed.header as { uuid?: string }).uuid;

      if (!headerUuid) {
        issues.push({ severity: 'error', file: `${label}/manifest.json`, message: 'header.uuid is missing.' });
      } else if (seenUuids.has(headerUuid)) {
        issues.push({ severity: 'error', file: `${label}/manifest.json`, message: `Duplicate UUID ${headerUuid}. Every pack and module needs a distinct UUID.` });
      } else {
        seenUuids.add(headerUuid);
      }

      for (const mod of parsed.modules) {
        const modUuid = (mod as { uuid?: string }).uuid;
        if (modUuid && seenUuids.has(modUuid)) {
          issues.push({ severity: 'error', file: `${label}/manifest.json`, message: `Module UUID ${modUuid} collides with another UUID in this addon.` });
        } else if (modUuid) {
          seenUuids.add(modUuid);
        }
      }
    } catch {
      issues.push({ severity: 'error', file: `${label}/manifest.json`, message: 'Manifest is not valid JSON.' });
    }
  }

  for (const file of [...built.behaviorFiles, ...built.resourceFiles]) {
    if (!file.path.endsWith('.json') || typeof file.content !== 'string') continue;
    try {
      const parsed = JSON.parse(file.content) as Record<string, unknown>;
      if (!('format_version' in parsed) && !file.path.includes('texts/')) {
        issues.push({ severity: 'warning', file: file.path, message: 'No format_version — Bedrock may reject or silently ignore this file.' });
      }
    } catch (err) {
      issues.push({ severity: 'error', file: file.path, message: `Invalid JSON: ${(err as Error).message}` });
    }
  }

  for (const warning of built.warnings) {
    issues.push({ severity: 'warning', file: 'pack', message: warning });
  }

  return issues;
}
