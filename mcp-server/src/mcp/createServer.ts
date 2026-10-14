import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from '../tools/register.ts';

/**
 * One `McpServer` per transport/session (the SDK's `Server.connect()` owns a single transport at a
 * time, so a multi-session HTTP server needs a fresh instance per session — see transport/http.ts).
 * Tool handlers are stateless: they resolve the tenant and check scopes from `extra.authInfo` on
 * every call, so every instance this factory builds behaves identically.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'chomugiri-mcp-server', version: '1.0.0' }, { capabilities: { tools: {} } });
  registerTools(server);
  return server;
}
