import type { EndpointRecord } from '../db/schema';

export type MediaCap = 'image' | 'video' | 'audio' | 'model3d';

/** Endpoints the user added that can do this kind of generation. Removing the endpoint removes the tab. */
export const endpointsFor = (endpoints: EndpointRecord[], cap: MediaCap) =>
  endpoints.filter((e) => e.enabled && e.capabilities.includes(cap));

// A model whose detected capabilities are entirely drawn from this set is a text model, never a
// media-generation one — including a model nobody could classify, which custom-endpoint discovery
// defaults to ['chat'] rather than leaving empty. (EndpointRecord stores capabilities as plain
// strings, not the stricter ModelCapability union, so this stays a string[] too.)
const TEXT_ONLY_CAPS: string[] = ['chat', 'reasoning', 'vision', 'tools', 'embedding', 'rerank', 'search'];

export const modelsFor = (endpoint: EndpointRecord | undefined, cap: MediaCap) => {
  const all = endpoint?.models.filter((m) => m.enabled !== false) ?? [];
  const mine = all.filter((m) => m.capabilities.includes(cap));
  if (mine.length) return mine.map((m) => m.id);
  // Nothing was tagged for this exact capability — fall back to anything that at least isn't
  // purely a text model, never to the full unfiltered list. That old "show everything" fallback
  // is the actual bug reported: a custom endpoint's model-discovery defaults an unclassified model
  // to ['chat'] (see endpoint-models.ts), and the endpoint can still show up under e.g. the 3D tab
  // because capability detection happens per endpoint too — so the picker ended up listing a chat
  // model as a "3D model". If every model here really is text-only, the honest answer is none of
  // them can do this — an empty list the UI disables "generate" for — not a guess that is wrong.
  return all.filter((m) => !m.capabilities.every((c) => TEXT_ONLY_CAPS.includes(c))).map((m) => m.id);
};
