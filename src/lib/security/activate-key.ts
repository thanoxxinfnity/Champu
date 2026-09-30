'use client';

import { saveKeys, saveVercel } from '@/lib/keys';
import { db, isBrowser, type EndpointRecord } from '@/lib/db/schema';
import type { Dialect } from '@/lib/providers/dialects';
import type { SecretKind, SecretMatch } from './secrets';

/**
 * Turning a detected credential into something Chomugiri can actually call.
 *
 * Finding a key in a paste and then telling the user to go copy it into a
 * settings screen is the same round trip whether or not the app already knows
 * exactly what kind of key it is and where it belongs. For the kinds it does
 * recognise, this skips that round trip: the key is wired in the moment it is
 * detected, with no screen to open and no name to type.
 */

interface ProviderPreset {
  baseUrl: string;
  dialect: Dialect;
  label: string;
}

const PROVIDER_PRESETS: Partial<Record<SecretKind, ProviderPreset>> = {
  openai: { baseUrl: 'https://api.openai.com/v1', dialect: 'openai', label: 'OpenAI' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', dialect: 'anthropic', label: 'Anthropic' },
  google: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', dialect: 'gemini', label: 'Google Gemini' },
};

/** Kinds this can wire in directly, without a settings screen or a name prompt. */
export function isActivatable(kind: SecretKind): boolean {
  return kind === 'nvidia' || kind === 'huggingface' || kind === 'vercel' || kind in PROVIDER_PRESETS;
}

export interface ActivationResult {
  ok: boolean;
  summary: string;
}

/**
 * Best-effort model list for the preset endpoint. A provider that publishes no
 * list, or a key that turns out wrong, still gets the endpoint saved — same
 * "add without a successful probe" allowance the guided wizard gives, and the
 * summary says plainly when nothing came back rather than pretending it did.
 */
async function probeModels(preset: ProviderPreset, apiKey: string): Promise<EndpointRecord['models']> {
  try {
    const res = await fetch('/api/endpoints/probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: preset.baseUrl, apiKey, dialect: preset.dialect }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return [];
    const result = (await res.json()) as { models?: Array<{ id: string; label: string; capabilities: string[] }> };
    return (result.models ?? []).map((m) => ({ id: m.id, label: m.label, capabilities: m.capabilities }));
  } catch {
    return [];
  }
}

/** Activates a detected credential. Only ever called on a kind `isActivatable` accepted. */
export async function activateKey(match: SecretMatch): Promise<ActivationResult> {
  if (match.kind === 'nvidia') {
    await saveKeys({ nim: match.value });
    return { ok: true, summary: 'NVIDIA NIM key detected — saved and ready. Its models are already in the switcher.' };
  }

  if (match.kind === 'huggingface') {
    await saveKeys({ huggingface: match.value });
    return { ok: true, summary: 'Hugging Face token detected — saved for the suites that use it.' };
  }

  if (match.kind === 'vercel') {
    await saveVercel(match.value, '');
    return { ok: true, summary: 'Vercel token detected — saved. Deploys will use it automatically.' };
  }

  const preset = PROVIDER_PRESETS[match.kind];
  if (!preset || !isBrowser()) return { ok: false, summary: '' };

  const models = await probeModels(preset, match.value);

  // Re-activating the same provider updates its existing endpoint (by base
  // URL) rather than piling up duplicates, whether that endpoint was created
  // this way before or added by hand through the guided wizard.
  const all = await db().endpoints.toArray();
  const existing = all.find((e) => e.baseUrl === preset.baseUrl);

  const record: EndpointRecord = {
    id: existing?.id ?? `ep_auto_${match.kind}`,
    label: existing?.label ?? preset.label,
    baseUrl: preset.baseUrl,
    apiKey: match.value,
    headers: existing?.headers,
    dialect: preset.dialect,
    maxTokens: existing?.maxTokens,
    temperature: existing?.temperature,
    capabilities: models.length ? ['chat'] : (existing?.capabilities ?? ['chat']),
    models: models.length ? models : (existing?.models ?? []),
    routes: existing?.routes ?? ['activated from a detected key'],
    lastProbedAt: Date.now(),
    probeOk: models.length ? 1 : (existing?.probeOk ?? 0),
    enabled: 1,
    createdAt: existing?.createdAt ?? Date.now(),
  };
  await db().endpoints.put(record);

  return {
    ok: true,
    summary: models.length
      ? `${preset.label} key detected — activated, ${models.length} model${models.length === 1 ? '' : 's'} ready in the switcher.`
      : `${preset.label} key detected and saved, but it didn't answer a model list — check it's the right key if nothing shows up.`,
  };
}
