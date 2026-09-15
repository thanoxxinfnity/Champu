/**
 * Choosing where a 3D model comes from.
 *
 * Four possible sources, and only one of them always works. The order matters
 * more than any individual client, so it lives here rather than being decided
 * inline at a call site where it would drift:
 *
 *   1. Meshy, if the user supplied a Meshy key. First because it is the only
 *      hosted generator that also *rigs* — and a rigged character is the thing
 *      the Godot suite is actually for.
 *   2. Tripo, if the user supplied a Tripo key. Good meshes, no rigging, so a
 *      character from here is a prop until someone rigs it by hand.
 *   3. Code-built geometry from `glb.ts` + `rig.ts`. Blocky, rigged, instant,
 *      needs no key and no network.
 *
 *   4. Microsoft TRELLIS through NVIDIA, on the NIM key. Last of the three
 *      because the two above are keys a user deliberately pasted, and this is
 *      the default that is there anyway.
 *
 * TRELLIS is reached as a real NVCF function, not through the build.nvidia.com
 * playground — that one only serves NVIDIA's own sample pictures. See
 * `trellis.ts` for which endpoint is which and what each answers.
 *
 * The floor is what makes the rest safe to attempt: every hosted source can be
 * out of credit, rate limited, or slow, and none of them failing should mean
 * the user gets no model.
 */

import { boxesFromParts, buildGlb, type Box } from './glb.ts';
import { rigFor } from './rig.ts';
import * as meshy from './meshy.ts';
import * as tripo from './tripo.ts';
import * as trellis from './trellis.ts';
import * as sketchfab from './sketchfab.ts';

export type SourceId = 'sketchfab' | 'meshy' | 'tripo' | 'trellis' | 'built';

/**
 * Set once TRELLIS has proved its deployment is down, so the rest of a build
 * does not pay ninety seconds per model to find out again. Process-lifetime
 * only — a fix on NVIDIA's side is picked up on the next run.
 */
let trellisDown: string | null = null;

/** For tests, and for a user who wants to retry after NVIDIA fixes it. */
export function resetTrellisState(): void {
  trellisDown = null;
}

export interface ModelKeys {
  /** A Sketchfab token, from sketchfab.com/settings/password. */
  sketchfab?: string;
  meshy?: string;
  tripo?: string;
  /** The NVIDIA key. Enables TRELLIS on NVIDIA's hosted NIM function. */
  nim?: string;
  /** A self-hosted TRELLIS container, overriding NVIDIA's hosted one. */
  trellisUrl?: string;
}

/**
 * What the model is for.
 *
 * Decides which generators are even offered. Meshy and Tripo are keys the user
 * paid for, and they asked for those to be spent on the things that need them —
 * the characters — with everything else coming from TRELLIS.
 */
export type ModelRole = 'character' | 'prop' | 'environment';

export interface ModelRequest {
  /** What to build, in the user's words. */
  prompt: string;
  /** What it is for. Defaults to a prop, which is the cheaper chain. */
  role?: ModelRole;
  /** The body plan, for the code-built fallback and for rig height. */
  plan: 'biped' | 'quadruped' | 'blob' | 'flying';
  /** Boxes for the code-built fallback, in 16-to-a-block units. */
  parts: Array<{ name: string; size: [number, number, number]; at: [number, number, number] }>;
  color?: [number, number, number];
}

export interface ModelOutcome {
  source: SourceId;
  /**
   * The credit the licence requires, when the model came from someone else.
   *
   * Carried out of here rather than printed and forgotten: nearly everything
   * downloadable on Sketchfab is CC Attribution, and a build that drops the
   * credit is a licence violation wearing an asset's clothes.
   */
  credit?: sketchfab.SketchfabModel;
  /** Set when the model was generated locally. */
  bytes?: Uint8Array;
  /** Set when a hosted generator produced a file to download. */
  url?: string;
  rigged: boolean;
  /**
   * Why a preferred source was not used. Shown, not swallowed: a user who
   * pasted a Meshy key and silently got a box model would think the key was
   * ignored.
   */
  notes: string[];
}

/**
 * The sources worth trying, in order, for a given set of keys.
 *
 * Split out from `generateModel` so the ordering can be tested without any
 * network at all.
 */
export function sourceChain(keys: ModelKeys, role: ModelRole = 'prop'): SourceId[] {
  const chain: SourceId[] = [];
  // Meshy and Tripo cost the user money per generation, and they are the only
  // two that rig. Both facts point the same way: spend them on the characters,
  // and let TRELLIS do the crates and the scenery. A prop that costs a paid
  // credit is a credit not spent on the thing the player looks at.
  // Sketchfab first, and only for characters. Somebody has already modelled and
  // rigged a zombie better than a text-to-3D pass will in ninety seconds, and
  // it arrives in one download. Props are not worth a search: a crate is a
  // crate, and TRELLIS makes one faster than choosing between eight of them.
  if (role === 'character') {
    if (keys.sketchfab?.trim()) chain.push('sketchfab');
    if (keys.meshy?.trim()) chain.push('meshy');
    if (keys.tripo?.trim()) chain.push('tripo');
  }
  // An NVIDIA key alone is enough: TRELLIS is reachable as a real NVCF
  // function, not only as a self-hosted container. It sits after the keys the
  // user explicitly pasted, because those are a deliberate choice and this is
  // the default.
  if (keys.nim?.trim()) chain.push('trellis');
  chain.push('built');
  return chain;
}

/**
 * The pipeline statement, as one line naming what will actually be used.
 *
 * Built from the keys that are set rather than written into the system prompt,
 * because a model that announces "Meshy" when no Meshy key exists has just told
 * the user their key is working.
 */
export function pipelineStatement(keys: ModelKeys): string {
  const character = sourceChain(keys, 'character');
  const prop = sourceChain(keys, 'prop');

  const label: Record<SourceId, string> = {
    sketchfab: 'Sketchfab (existing rigged models, credited)',
    meshy: 'Meshy (text-to-3D, auto-rigged)',
    tripo: 'Tripo AI (text-to-3D)',
    trellis: keys.trellisUrl?.trim()
      ? 'Microsoft TRELLIS (self-hosted NIM container)'
      : 'Microsoft TRELLIS via NVIDIA NIM',
    built: 'code-built rigged geometry',
  };

  const first = character.find((id) => id !== 'built');
  if (!first) return '[3D Asset Pipeline: code-built rigged geometry — no 3D generator key is set]';

  const others = prop.find((id) => id !== 'built');
  const sameForEverything = first === others;

  return sameForEverything
    ? `[3D Asset Pipeline: ${label[first]}, with ${label.built} as the floor]`
    : `[3D Asset Pipeline: characters → ${label[first]}; props and scenery → ${others ? label[others] : label.built}; floor → ${label.built}]`;
}

/** Why TRELLIS is not being used, in words worth showing a user who asked for it. */
export function trellisAvailability(keys: ModelKeys): string | null {
  if (!keys.nim?.trim()) {
    return 'TRELLIS needs an NVIDIA key. Add one in Settings → API Keys, or use Meshy or Tripo.';
  }
  if (trellisDown) return trellisDown;
  return null;
}

/** Roughly how tall the finished character should be, in metres. */
function heightFor(request: ModelRequest): number {
  const top = Math.max(...request.parts.map((p) => p.at[1] + p.size[1]), 16);
  return Math.max(0.4, top / 16);
}

/** The always-works model: built from boxes, rigged if the plan has joints. */
export function buildLocally(request: ModelRequest): { bytes: Uint8Array; rigged: boolean } {
  const boxes: Box[] = boxesFromParts(request.parts, request.color);
  const rig = rigFor(request.plan);
  return { bytes: buildGlb(boxes, { ...(rig ? { rig } : {}), name: 'Character' }), rigged: rig !== null };
}

/**
 * Produces a model, trying each source and falling through on failure.
 *
 * Never throws and never returns nothing: the last link in every chain is the
 * code-built model, which has no way to fail that is not a bug in our own
 * geometry.
 */
export async function generateModel(
  request: ModelRequest,
  keys: ModelKeys,
  options: {
    onStage?: (source: SourceId, message: string) => void;
    timeoutMs?: number;
    signal?: AbortSignal;
    /**
     * How long to keep asking TRELLIS for one model before giving up on it.
     *
     * "Ask until a model comes back" is a deadline, not an infinity: a
     * deployment that answers 500 in four seconds would loop forever and the
     * build would never finish. Ten minutes by default.
     */
    trellisBudgetMs?: number;
  } = {},
): Promise<ModelOutcome> {
  const notes: string[] = [];
  const chain = sourceChain(keys, request.role ?? 'prop');

  for (const source of chain) {
    if (source === 'built') {
      options.onStage?.('built', 'Building the model in code.');
      const { bytes, rigged } = buildLocally(request);
      return { source: 'built', bytes, rigged, notes };
    }

    if (source === 'sketchfab') {
      options.onStage?.('sketchfab', 'Looking for a model somebody has already made.');
      const found = await sketchfab.searchModels(request.prompt, {
        // A character is what this source is for, so prefer one that already
        // has a walk cycle over one that has to be rigged afterwards.
        animatedOnly: true,
        count: 4,
        ...(options.signal ? { signal: options.signal } : {}),
      });

      // Nothing animated is not nothing: fall back to a static model rather
      // than skipping a source that had eleven usable results.
      const models = found.models.length
        ? found.models
        : (await sketchfab.searchModels(request.prompt, { count: 4, ...(options.signal ? { signal: options.signal } : {}) })).models;

      if (!models.length) {
        notes.push(found.error ?? `Sketchfab had nothing usable for "${request.prompt}".`);
        continue;
      }

      const pick = models[0];
      options.onStage?.('sketchfab', `Downloading "${pick.name}" by ${pick.author}.`);
      const got = await sketchfab.fetchModel(pick.uid, keys.sketchfab!, {
        ...(options.signal ? { signal: options.signal } : {}),
      });

      if (got.bytes && sketchfab.isGlb(got.bytes)) {
        return {
          source: 'sketchfab',
          bytes: got.bytes,
          // Reported from the model's own metadata rather than assumed: an
          // animated model has a skeleton, a static one does not, and telling
          // the user the wrong one sends them looking for a bug in the scene.
          rigged: pick.animations > 0,
          credit: pick,
          notes,
        };
      }
      if (got.bytes) notes.push(`Sketchfab sent something that is not a .glb for "${pick.name}".`);
      if (got.error) notes.push(got.error);
      continue;
    }

    if (source === 'meshy') {
      options.onStage?.('meshy', 'Asking Meshy for a model, then rigging it.');
      const result = await meshy.generateRiggedModel(keys.meshy!, request.prompt, {
        heightMetres: heightFor(request),
        timeoutMs: options.timeoutMs,
        signal: options.signal,
        onProgress: (stage, r) => options.onStage?.('meshy', `Meshy ${stage}: ${r.status} ${r.progress ?? 0}%`),
      });
      if (result.warning) notes.push(result.warning);
      if (result.modelUrl) return { source: 'meshy', url: result.modelUrl, rigged: result.rigged, notes };
      if (result.error) notes.push(result.error);
      continue;
    }

    if (source === 'tripo') {
      options.onStage?.('tripo', 'Asking Tripo for a model.');
      const started = await tripo.startTextToModel(keys.tripo!, request.prompt, options.signal);
      if (!started.taskId) {
        if (started.error) notes.push(started.error);
        continue;
      }
      const result = await tripo.waitForModel(keys.tripo!, started.taskId, {
        timeoutMs: options.timeoutMs,
        signal: options.signal,
        onProgress: (r) => options.onStage?.('tripo', `Tripo: ${r.status} ${r.progress ?? 0}%`),
      });
      if (result.modelUrl) {
        // Tripo does not rig, so this is a prop rather than a character.
        notes.push('Tripo does not rig its models, so this one has no skeleton and will not animate.');
        return { source: 'tripo', url: result.modelUrl, rigged: false, notes };
      }
      if (result.error) notes.push(result.error);
      continue;
    }

    if (source === 'trellis') {
      // A build makes several models, and re-learning that NVIDIA's deployment
      // is down costs the whole budget each time — but only skip on that memo
      // when something else in this chain can actually produce a model. When
      // TRELLIS is the only generator, "it was down a minute ago" is not a
      // reason to stop asking; that is the whole point of persisting.
      const hasAlternative = chain.some((id) => id === 'meshy' || id === 'tripo');
      if (trellisDown && hasAlternative) {
        notes.push(trellisDown);
        continue;
      }

      options.onStage?.('trellis', 'Asking TRELLIS for a model.');
      const result = await trellis.generateModel({ prompt: request.prompt }, keys.nim!, {
        baseUrl: keys.trellisUrl,
        signal: options.signal,
        // Detail is steered through the prompt, because TRELLIS has no
        // parameter for it and every documented one makes it 500.
        detail: 'high',
        // Keeps asking rather than trying a fixed three rounds and settling for
        // boxes. Backs off between rounds so a down service is not hammered.
        budgetMs: options.trellisBudgetMs ?? 10 * 60_000,
        onProgress: (note) => options.onStage?.('trellis', note),
      });

      if (result.model) {
        notes.push('TRELLIS does not rig its models, so this one has no skeleton and will not animate.');
        return { source: 'trellis', bytes: result.model, rigged: false, notes };
      }
      if (result.upstreamBroken && result.error) {
        // Remembered for the rest of the process, not written to disk: a
        // deployment NVIDIA repairs should start working on the next run
        // without the user having to clear anything.
        trellisDown = result.error;
      }
      if (result.error) notes.push(result.error);
      continue;
    }
  }

  // Unreachable: sourceChain always ends in 'built'. Kept so a future edit to
  // the chain cannot silently return nothing.
  const { bytes, rigged } = buildLocally(request);
  return { source: 'built', bytes, rigged, notes };
}
