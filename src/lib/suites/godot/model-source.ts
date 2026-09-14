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
 * TRELLIS is deliberately absent from the default chain. NVIDIA's hosted
 * deployment only accepts its own sample images — see the evidence in
 * `trellis.ts` — so it would cost ninety seconds and then fail on every run. It
 * is used when, and only when, the user points at a self-hosted NIM container,
 * where the same code works properly.
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

export type SourceId = 'meshy' | 'tripo' | 'trellis' | 'built';

export interface ModelKeys {
  meshy?: string;
  tripo?: string;
  /** The NIM key. Only usable with a self-hosted TRELLIS. */
  nim?: string;
  /** A self-hosted TRELLIS NIM container. Without one, TRELLIS is skipped. */
  trellisUrl?: string;
}

export interface ModelRequest {
  /** What to build, in the user's words. */
  prompt: string;
  /** The body plan, for the code-built fallback and for rig height. */
  plan: 'biped' | 'quadruped' | 'blob' | 'flying';
  /** Boxes for the code-built fallback, in 16-to-a-block units. */
  parts: Array<{ name: string; size: [number, number, number]; at: [number, number, number] }>;
  color?: [number, number, number];
}

export interface ModelOutcome {
  source: SourceId;
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
export function sourceChain(keys: ModelKeys): SourceId[] {
  const chain: SourceId[] = [];
  if (keys.meshy?.trim()) chain.push('meshy');
  if (keys.tripo?.trim()) chain.push('tripo');
  // Only a self-hosted container; the hosted endpoint cannot serve real input.
  if (keys.trellisUrl?.trim() && keys.nim?.trim()) chain.push('trellis');
  chain.push('built');
  return chain;
}

/** Why TRELLIS is not being used, in words worth showing a user who asked for it. */
export function trellisAvailability(keys: ModelKeys): string | null {
  if (keys.trellisUrl?.trim() && keys.nim?.trim()) return null;
  if (keys.trellisUrl?.trim()) return 'A TRELLIS URL is set but there is no NVIDIA key to authenticate with it.';
  return "NVIDIA's hosted TRELLIS only serves its own sample images, so it cannot build from a prompt. Set a self-hosted TRELLIS URL to use it, or add a Meshy or Tripo key.";
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
  } = {},
): Promise<ModelOutcome> {
  const notes: string[] = [];

  for (const source of sourceChain(keys)) {
    if (source === 'built') {
      options.onStage?.('built', 'Building the model in code.');
      const { bytes, rigged } = buildLocally(request);
      return { source: 'built', bytes, rigged, notes };
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
      options.onStage?.('trellis', 'Asking the self-hosted TRELLIS for a model.');
      const result = await trellis.generateModel(request.prompt, keys.nim!, {
        baseUrl: keys.trellisUrl,
        signal: options.signal,
      });
      if (result.model) {
        notes.push('TRELLIS does not rig its models, so this one has no skeleton and will not animate.');
        return { source: 'trellis', bytes: result.model, rigged: false, notes };
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
