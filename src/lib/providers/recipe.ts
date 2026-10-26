import { customChatConfig } from './custom.ts';
import { buildBody } from './openai-compat.ts';
import { USER_AGENT } from './blocked.ts';
import type { ChatMessage, CustomEndpointConfig, ProviderId } from './types.ts';

/**
 * A model call written out in full, so the terminal bridge can make it while the app is closed.
 *
 * The app normally calls /api/chat on its own server, which holds the NVIDIA key and does the provider-specific shaping. A background job
 * cannot lean on the app being open, so the app resolves the call itself — final URL, headers (with the endpoint's key) and body, the same ones
 * the server would have sent — and the bridge just posts it. Only providers whose key the app knows can do this: custom endpoints (every free
 * provider is one) and Pollinations. NVIDIA NIM's key lives on the server, so a NIM choice answers `null` and the message is sent normally.
 */

export interface Recipe {
  label: string;
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  /** Whether the reply streams (OpenAI-style). Other wire formats are asked for in one piece. */
  stream: boolean;
  timeoutMs: number;
}

export interface RecipeCandidate {
  provider: ProviderId;
  model: string;
  label?: string;
  custom?: CustomEndpointConfig;
}

export interface RecipeOptions {
  maxTokens?: number;
  temperature?: number;
}

export function recipeFor(c: RecipeCandidate, messages: ChatMessage[], opts: RecipeOptions = {}): Recipe | null {
  const req = { provider: c.provider, model: c.model, messages, maxTokens: opts.maxTokens, temperature: opts.temperature, custom: c.custom };
  if (c.provider === 'custom' && c.custom) {
    const cfg = customChatConfig(c.custom, c.model);
    const dialect = cfg.dialect ?? 'openai';
    const stream = dialect === 'openai';
    let body = buildBody({ ...req, stream }, c.model, stream, dialect);
    if (cfg.shapeBody) body = cfg.shapeBody(body, { ...req, stream });
    return { label: c.label ?? c.model, url: cfg.urlFor?.(stream) ?? cfg.url, headers: { 'User-Agent': USER_AGENT, ...cfg.headers }, body, stream, timeoutMs: 20 * 60 * 1000 };
  }
  if (c.provider === 'pollinations') {
    const body = buildBody({ ...req, stream: true }, c.model, true, 'openai');
    body.referrer = 'chomugiri';
    delete body.stream_options;
    return { label: c.label ?? `Pollinations · ${c.model}`, url: 'https://text.pollinations.ai/openai', headers: { Referer: 'chomugiri', 'User-Agent': USER_AGENT }, body, stream: true, timeoutMs: 10 * 60 * 1000 };
  }
  return null;
}

/** The recipes for a list of candidates, in order, skipping any the bridge could not call. */
export function recipesFor(candidates: RecipeCandidate[], messages: ChatMessage[], opts: RecipeOptions = {}, max = 5): Recipe[] {
  const out: Recipe[] = [];
  for (const c of candidates) {
    const r = recipeFor(c, messages, opts);
    if (r) out.push(r);
    if (out.length >= max) break;
  }
  return out;
}
