import { createServer } from 'node:http';
import { env } from './env.ts';
import { logger } from './logger.ts';
import { tenantStore } from './tenants/store.ts';
import { createApp } from './transport/http.ts';

async function main() {
  if (!process.env.JWT_HS256_SECRET && !process.env.JWT_JWKS_URL) {
    logger.warn('No JWT verification configured (JWT_HS256_SECRET / JWT_JWKS_URL unset) — only API-key bearer tokens will be accepted.');
  }

  await tenantStore.load();
  // Picks up provisioning changes (new tenants, revoked keys, rotated scopes) without a restart.
  setInterval(() => void tenantStore.load().catch((err) => logger.error({ err }, 'Failed to reload tenants.')), 30_000).unref();

  const { app, sessionCount } = createApp();
  const server = createServer(app);

  server.listen(env.PORT, () => {
    logger.info({ port: env.PORT, publicUrl: env.PUBLIC_URL }, 'Chomugiri MCP server listening.');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal, openSessions: sessionCount() }, 'Shutting down.');
    server.close(() => process.exit(0));
    // Don't hang forever if a connection refuses to drain.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Fatal startup error.');
  process.exit(1);
});
