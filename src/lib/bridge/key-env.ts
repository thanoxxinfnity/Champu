/**
 * The keys the app holds, as the environment variables a terminal command would look for.
 *
 * Free providers get their own name from the catalogue id (`groq` → GROQ_API_KEY, with GROQ_API_KEYS when several keys rotate
 * and GROQ_BASE_URL to call); the app's own credentials use their usual names; any other custom endpoint is named after its
 * label. Pure, so the mapping is tested without a bridge.
 */

export interface KeyEnvEndpoint {
  id: string;
  label: string;
  baseUrl: string;
  apiKey?: string;
  apiKeys?: string[];
  freeId?: string;
  enabled?: boolean | 0 | 1;
}

export interface KeyEnvKeys {
  nim?: string;
  pollinations?: string;
  tripo?: string;
  meshy?: string;
  sketchfab?: string;
  kaggle?: string;
  huggingface?: string;
  vercel?: string;
}

const APP_NAMES: Record<keyof KeyEnvKeys, string> = {
  nim: 'NVIDIA_API_KEY',
  pollinations: 'POLLINATIONS_API_KEY',
  tripo: 'TRIPO_API_KEY',
  meshy: 'MESHY_API_KEY',
  sketchfab: 'SKETCHFAB_TOKEN',
  kaggle: 'KAGGLE_API_TOKEN',
  huggingface: 'HF_TOKEN',
  vercel: 'VERCEL_TOKEN',
};

const slug = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'ENDPOINT';

export function keyEnvFrom(keys: KeyEnvKeys, endpoints: KeyEnvEndpoint[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [field, name] of Object.entries(APP_NAMES) as Array<[keyof KeyEnvKeys, string]>) {
    const v = (keys[field] ?? '').trim();
    if (v) env[name] = v;
  }
  for (const e of endpoints) {
    if (e.enabled === false || e.enabled === 0) continue;
    const list = [e.apiKey, ...(e.apiKeys ?? [])].map((k) => (k ?? '').trim()).filter(Boolean);
    if (!list.length) continue;
    let base = e.freeId ? slug(e.freeId) : `ENDPOINT_${slug(e.label)}`;
    for (let n = 2; `${base}_API_KEY` in env; n++) base = `${e.freeId ? slug(e.freeId) : `ENDPOINT_${slug(e.label)}`}_${n}`;
    env[`${base}_API_KEY`] = list[0];
    if (list.length > 1) env[`${base}_API_KEYS`] = list.join(',');
    if (e.baseUrl) env[`${base}_BASE_URL`] = e.baseUrl;
  }
  return env;
}
