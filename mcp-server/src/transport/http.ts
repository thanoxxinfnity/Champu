import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { hostHeaderValidation } from '@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js';
import { env, allowedHostnames, allowedOrigins } from '../env.ts';
import { logger } from '../logger.ts';
import { CompositeVerifier } from '../auth/verifiers.ts';
import { tenantRateLimiter } from '../auth/rateLimiter.ts';
import { tenantStore, type Tenant } from '../tenants/store.ts';
import { McpHttpError, RpcErrorCode, rateLimited, unknownTenant } from '../errors.ts';
import { createMcpServer } from '../mcp/createServer.ts';

declare module 'express-serve-static-core' {
  interface Request {
    tenant?: Tenant;
  }
}

const verifier = new CompositeVerifier();

/** Resolves `req.auth` (set by requireBearerAuth) to a tenant record and rejects an otherwise-valid token for a disabled/unknown tenant. */
function resolveTenant(req: Request, _res: Response, next: NextFunction) {
  const tenantId = req.auth?.extra?.tenantId;
  const tenant = typeof tenantId === 'string' ? tenantStore.byId(tenantId) : undefined;
  if (!tenant) return next(unknownTenant());
  req.tenant = tenant;
  next();
}

/** Applies the tenant's token-bucket; on exhaustion this is a 429 with Retry-After, not a silent queue. */
async function enforceRateLimit(req: Request, _res: Response, next: NextFunction) {
  if (!req.tenant) return next(unknownTenant());
  try {
    await tenantRateLimiter.consume(req.tenant);
    next();
  } catch (rej) {
    const msBeforeNext = typeof rej === 'object' && rej !== null && 'msBeforeNext' in rej ? Number((rej as { msBeforeNext: number }).msBeforeNext) : 1000;
    next(rateLimited(Math.ceil(msBeforeNext / 1000)));
  }
}

function sendRpcError(res: Response, err: unknown) {
  if (err instanceof McpHttpError) {
    if (err.rpcCode === RpcErrorCode.RateLimited && typeof err.extra?.retryAfterSeconds === 'number') {
      res.set('Retry-After', String(err.extra.retryAfterSeconds));
    }
    res.status(err.httpStatus).json(err.toRpcEnvelope());
    return;
  }
  logger.error({ err }, 'Unhandled error.');
  res.status(500).json({ jsonrpc: '2.0', id: null, error: { code: RpcErrorCode.InternalError, message: 'Internal server error.' } });
}

/**
 * Builds the Express app. One `McpServer` + `StreamableHTTPServerTransport` pair per client
 * session (the SDK's Server owns exactly one transport at a time — see mcp/createServer.ts),
 * keyed by the `mcp-session-id` header the transport assigns on `initialize`.
 */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({
    origin: allowedOrigins.length ? allowedOrigins : false,
    exposedHeaders: ['mcp-session-id'],
    allowedHeaders: ['Content-Type', 'Authorization', 'mcp-session-id', 'last-event-id'],
  }));
  if (allowedHostnames) app.use(hostHeaderValidation(allowedHostnames));
  app.use(express.json({ limit: '2mb' }));

  app.get('/healthz', (_req, res) => res.status(200).json({ ok: true, name: 'chomugiri-mcp-server' }));

  const sessions = new Map<string, StreamableHTTPServerTransport>();

  const authChain = [
    requireBearerAuth({ verifier, resourceMetadataUrl: `${env.PUBLIC_URL.replace(/\/+$/, '')}/.well-known/oauth-protected-resource` }),
    resolveTenant,
    enforceRateLimit,
  ];

  app.post('/mcp', ...authChain, async (req: Request, res: Response) => {
    try {
      const existingId = req.headers['mcp-session-id'];
      const sessionId = typeof existingId === 'string' ? existingId : undefined;
      let transport = sessionId ? sessions.get(sessionId) : undefined;

      if (!transport) {
        if (sessionId) {
          // A session id was presented but this process has no record of it — either it expired,
          // this process restarted, or (in a multi-instance deployment without sticky routing) it
          // belongs to a different instance. Per spec this is a 404, not a silent new session.
          res.status(404).json({ jsonrpc: '2.0', id: null, error: { code: RpcErrorCode.InvalidRequest, message: 'Unknown or expired session.' } });
          return;
        }
        if (!isInitializeRequest(req.body)) {
          res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: RpcErrorCode.InvalidRequest, message: 'Expected an initialize request to open a new session.' } });
          return;
        }
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          // These tools answer directly (no server-initiated push between request and response), so
          // a plain JSON response is a correct, complete reply — not a connection a client has to
          // keep reading from. Switch this off if tools/notifications are added that need to stream.
          enableJsonResponse: true,
          onsessioninitialized: (id) => {
            sessions.set(id, transport!);
            logger.info({ sessionId: id, tenant: req.tenant?.id }, 'MCP session opened.');
          },
          onsessionclosed: (id) => {
            sessions.delete(id);
            logger.info({ sessionId: id }, 'MCP session closed.');
          },
        });
        const server = createMcpServer();
        await server.connect(transport);
      }

      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      sendRpcError(res, err);
    }
  });

  app.get('/mcp', ...authChain, async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'];
    const transport = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;
    if (!transport) { res.status(404).json({ jsonrpc: '2.0', id: null, error: { code: RpcErrorCode.InvalidRequest, message: 'Unknown or expired session.' } }); return; }
    try {
      await transport.handleRequest(req, res);
    } catch (err) {
      sendRpcError(res, err);
    }
  });

  app.delete('/mcp', ...authChain, async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'];
    const transport = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;
    if (!transport) { res.status(404).json({ jsonrpc: '2.0', id: null, error: { code: RpcErrorCode.InvalidRequest, message: 'Unknown or expired session.' } }); return; }
    try {
      await transport.handleRequest(req, res);
    } catch (err) {
      sendRpcError(res, err);
    }
  });

  // Minimal OAuth Protected Resource Metadata (RFC 9728): this server verifies tokens, it does not
  // issue them, so it points at wherever JWT_ISSUER / the tenant's own authorization server lives.
  app.get('/.well-known/oauth-protected-resource', (_req, res) => {
    res.json({
      resource: env.PUBLIC_URL,
      authorization_servers: env.JWT_ISSUER ? [env.JWT_ISSUER] : [],
      bearer_methods_supported: ['header'],
    });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => sendRpcError(res, err));

  return { app, sessionCount: () => sessions.size };
}
