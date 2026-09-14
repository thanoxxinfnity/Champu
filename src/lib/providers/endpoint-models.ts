import type { EndpointRecord } from '@/lib/db/schema';
import type { CustomEndpointConfig, ModelCapability, ModelDescriptor } from './types.ts';

/**
 * Custom endpoints, as entries in the model switcher.
 *
 * Configuring an endpoint used to change nothing a user could see: the probe
 * ran, capability tabs appeared, and the models themselves never reached the
 * switcher — so there was no way to actually select one. This turns a stored
 * endpoint into descriptors the switcher understands, tagged with the endpoint
 * they came from so the request can be addressed later.
 */

export function endpointModels(endpoints: EndpointRecord[]): ModelDescriptor[] {
  const out: ModelDescriptor[] = [];

  for (const endpoint of endpoints) {
    if (!endpoint.enabled) continue;

    for (const model of endpoint.models) {
      out.push({
        id: model.id,
        provider: 'custom',
        // Prefixed with the endpoint, because two endpoints can serve the same
        // model id and an unqualified "gpt-4o" in the list would be ambiguous.
        label: `${endpoint.label} · ${model.label || model.id}`,
        vendor: endpoint.label,
        capabilities: (model.capabilities.length ? model.capabilities : ['chat']) as ModelCapability[],
        emitsReasoning: model.capabilities.includes('reasoning'),
        origin: endpoint.probeOk ? 'catalogue' : 'static',
        endpointId: endpoint.id,
        note: endpoint.probeOk
          ? `From ${endpoint.baseUrl}`
          : `From ${endpoint.baseUrl} — added without a successful probe, so it is unverified.`,
      });
    }
  }

  return out;
}

/**
 * The connection details for a selected custom model.
 *
 * Returns undefined for anything that is not a custom endpoint model, which is
 * what the caller passes straight through to the chat route.
 */
export function endpointConfigFor(
  endpoints: EndpointRecord[],
  selection: { provider: string; endpointId?: string },
): CustomEndpointConfig | undefined {
  if (selection.provider !== 'custom' || !selection.endpointId) return undefined;

  const endpoint = endpoints.find((e) => e.id === selection.endpointId);
  if (!endpoint) return undefined;

  return {
    baseUrl: endpoint.baseUrl,
    apiKey: endpoint.apiKey,
    headers: endpoint.headers,
    chatPath: endpoint.chatPath,
    // Without this an Anthropic or Gemini endpoint is called in OpenAI's
    // dialect — wrong route, wrong auth header, wrong body.
    dialect: endpoint.dialect,
    maxTokens: endpoint.maxTokens,
    temperature: endpoint.temperature,
  };
}
