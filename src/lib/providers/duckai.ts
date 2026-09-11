import type { ModelDescriptor } from './types';

/**
 * Duck.ai adapter — free models, reached the way DuckDuckGo intends.
 *
 * Everything below was established against the live site on 2026-09-11, not from
 * documentation:
 *
 *   - The six models really exist and really are free. Their tier map in
 *     `entry.duckai.*.js` lists `availableTo: [FREE, PLUS, PRO, INTERNAL]` for
 *     every one of them, and the ids here are the exact strings duck.ai puts on
 *     the wire — not display names.
 *
 *   - Their chat API cannot be called from a server or from another web origin,
 *     and this is deliberate on DuckDuckGo's part:
 *       * `POST https://duckduckgo.com/duckchat/v1/chat` without a solved token
 *         returns **HTTP 418 `ERR_CHALLENGE`**.
 *       * The token comes from `x-vqd-hash-1` on `/duckchat/v1/status`, which is
 *         an obfuscated script carrying the literal string
 *         `DuckDuckGo Fraud & Abuse`. It fingerprints the caller — it measures a
 *         live DOM node, probes an iframe's `contentWindow`, and checks
 *         `navigator.webdriver`. It is an anti-automation control.
 *       * A CORS preflight on the chat endpoint answers **400 with no
 *         `access-control-allow-*` headers**, so a browser cannot call it
 *         cross-origin either.
 *     Chomugiri does not forge that token. Defeating a service's abuse control to
 *     borrow its capacity is not something this app does to a free provider.
 *
 *   - DuckDuckGo ships a supported way in instead: a **hand-off URL**. Their own
 *     router reads `q`, `model`, `mode` and `toolChoice` off the query string and
 *     logs `"refused the handoff value"` when it rejects one. `prompt=1` makes it
 *     auto-send; `home=1` stops the short-prompt filter from dropping one- or
 *     two-word prompts. So the prompt is carried over intact, the user stays in
 *     their own duck.ai session, and the six models answer for free — in the
 *     browser, which is where DuckDuckGo serves them.
 */

export const DUCKAI_ORIGIN = 'https://duck.ai';

/**
 * Build the first-party hand-off URL.
 *
 * `model` is the wire id (e.g. `tinfoil/gemma4-31b`); it is passed through
 * verbatim because duck.ai matches it against its own registry.
 */
export function duckaiHandoffUrl(model: string, prompt: string): string {
  const params = new URLSearchParams({ q: prompt.trim(), prompt: '1', home: '1' });
  if (model) params.set('model', model);
  return `${DUCKAI_ORIGIN}/?${params.toString()}`;
}

const FREE_TIER =
  'Free on duck.ai with no API key and no account. duck.ai serves it to a real browser only — its chat API answers HTTP 418 ERR_CHALLENGE to anything else — so Chomugiri hands the prompt off to duck.ai instead of forging that check.';

export const DUCKAI_MODELS: ModelDescriptor[] = [
  {
    id: 'gpt-5.6-luna',
    provider: 'duckai',
    label: 'GPT-5.6 Luna',
    vendor: 'OpenAI · via Duck.ai',
    capabilities: ['chat', 'reasoning'],
    contextWindow: 16_000,
    emitsReasoning: true,
    origin: 'browser-only',
    handoffUrl: DUCKAI_ORIGIN,
    note: `Best for everyday use. ${FREE_TIER}`,
  },
  {
    id: 'gpt-5.4-mini',
    provider: 'duckai',
    label: 'GPT-5.4 mini',
    vendor: 'OpenAI · via Duck.ai',
    capabilities: ['chat'],
    contextWindow: 16_000,
    origin: 'browser-only',
    handoffUrl: DUCKAI_ORIGIN,
    note: `Solid, but hits limits sooner. ${FREE_TIER}`,
  },
  {
    id: 'claude-haiku-4-5',
    provider: 'duckai',
    label: 'Claude Haiku 4.5',
    vendor: 'Anthropic · via Duck.ai',
    capabilities: ['chat'],
    contextWindow: 16_000,
    origin: 'browser-only',
    handoffUrl: DUCKAI_ORIGIN,
    note: `Solid, but hits limits sooner. ${FREE_TIER}`,
  },
  {
    id: 'mistral-small-2603',
    provider: 'duckai',
    label: 'Mistral Small 4',
    vendor: 'Mistral AI · via Duck.ai',
    capabilities: ['chat'],
    contextWindow: 16_000,
    origin: 'browser-only',
    handoffUrl: DUCKAI_ORIGIN,
    note: FREE_TIER,
  },
  {
    id: 'tinfoil/gpt-oss-120b',
    provider: 'duckai',
    label: 'gpt-oss 120B',
    vendor: 'OpenAI · via Duck.ai',
    capabilities: ['chat', 'reasoning'],
    contextWindow: 16_000,
    emitsReasoning: true,
    origin: 'browser-only',
    handoffUrl: DUCKAI_ORIGIN,
    note: `Open-weight, served in a Tinfoil enclave. ${FREE_TIER} For an API-callable substitute pick NIM gpt-oss 20B.`,
  },
  {
    id: 'tinfoil/gemma4-31b',
    provider: 'duckai',
    label: 'Gemma 4 31B',
    vendor: 'Google · via Duck.ai',
    capabilities: ['chat'],
    contextWindow: 16_000,
    origin: 'browser-only',
    handoffUrl: DUCKAI_ORIGIN,
    note: `Open-weight, served in a Tinfoil enclave. ${FREE_TIER} The same weights are API-callable on NIM as google/gemma-4-31b-it.`,
  },
];

/** The id duck.ai puts on the wire for a model Chomugiri lists. */
export function duckaiWireId(id: string): string | undefined {
  return DUCKAI_MODELS.find((m) => m.id === id)?.id;
}
