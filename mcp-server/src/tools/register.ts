import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ToolScope, tenantStore, type Tenant } from '../tenants/store.ts';
import { hasScope } from '../auth/rbac.ts';
import { callProvider, type Capability } from '../tools/providerProxy.ts';
import { logger } from '../logger.ts';

const promptSchema = z.object({
  prompt: z.string().min(1).max(4000).describe('What to generate, in plain language.'),
});

/** The MCP spec's own structured-error shape for a tool-level failure: `isError: true`, not a protocol error. */
function toolError(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function resolveTenant(authInfo: { extra?: Record<string, unknown> } | undefined): Tenant | undefined {
  const tenantId = authInfo?.extra?.tenantId;
  return typeof tenantId === 'string' ? tenantStore.byId(tenantId) : undefined;
}

async function runGeneration(cap: Capability, scope: string, mimeType: string, authInfo: { extra?: Record<string, unknown>; scopes: string[] } | undefined, prompt: string): Promise<CallToolResult> {
  const tenant = resolveTenant(authInfo);
  if (!tenant) return toolError('No authenticated tenant for this request.');
  // RBAC, enforced again here (not just by the HTTP layer): tools/list can legitimately show every
  // tool so a client knows what exists, but tools/call must still refuse what the token's scopes
  // don't grant — "strict RBAC before exposing any tools" means at the point of use, not just at login.
  if (!hasScope(authInfo?.scopes, scope)) {
    return toolError(`Tenant "${tenant.id}" does not have the "${scope}" scope.`);
  }
  try {
    const result = await callProvider(tenant, cap, { prompt, mimeType });
    const payload = { url: result.url, dataUri: result.dataUri, bytes: result.bytes, mimeType: result.mimeType };
    return {
      content: [
        { type: 'text', text: JSON.stringify(payload) },
        ...(result.url ? [{ type: 'resource_link' as const, uri: result.url, name: `${cap}-output`, mimeType: result.mimeType }] : []),
      ],
      structuredContent: payload,
    };
  } catch (err) {
    logger.warn({ err, tenant: tenant.id, cap }, 'Tool call failed against upstream provider.');
    return toolError((err as Error).message);
  }
}

export function registerTools(server: McpServer): void {
  server.registerTool(
    'generate_image',
    {
      title: 'Generate an image',
      description: 'Generates an image from a text prompt using this tenant\'s configured image provider.',
      inputSchema: promptSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ prompt }, extra) => runGeneration('image', ToolScope.Image, 'image/png', extra.authInfo, prompt),
  );

  server.registerTool(
    'generate_video',
    {
      title: 'Generate a video',
      description: 'Generates a short video clip from a text prompt using this tenant\'s configured video provider.',
      inputSchema: promptSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ prompt }, extra) => runGeneration('video', ToolScope.Video, 'video/mp4', extra.authInfo, prompt),
  );

  server.registerTool(
    'generate_3d_model',
    {
      title: 'Generate a 3D model',
      description: 'Generates a 3D model (glTF binary) from a text prompt using this tenant\'s configured 3D provider.',
      inputSchema: promptSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ prompt }, extra) => runGeneration('model3d', ToolScope.Model3d, 'model/gltf-binary', extra.authInfo, prompt),
  );
}
