import { z } from 'zod';

/**
 * All configuration comes from the environment, validated once at startup so a misconfigured
 * deployment fails loudly at boot instead of silently misbehaving on the first request.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  PORT: z.coerce.number().int().positive().default(8787),

  // Public URL this server is reachable at (its own OAuth "resource" identifier, RFC 8707).
  PUBLIC_URL: z.string().url(),

  // Comma-separated hostnames this server will accept a Host header from (DNS-rebinding protection).
  // The literal value "any" disables the check — only use that behind a reverse proxy that already
  // enforces it (see nginx/mcp.conf), never on a directly internet-facing process.
  ALLOWED_HOSTS: z.string().default('any'),
  // Comma-separated origins allowed to make browser-based (CORS) requests.
  ALLOWED_ORIGINS: z.string().default(''),

  // JWT bearer verification. Either a static shared secret (HS256, simplest — one issuer you control)
  // or a JWKS URL (RS256/ES256, for a real external identity provider: Auth0, Okta, Keycloak, Clerk...).
  // Leave both unset to disable JWT verification entirely and run on API keys only.
  JWT_HS256_SECRET: z.string().min(16).optional(),
  JWT_JWKS_URL: z.string().url().optional(),
  JWT_ISSUER: z.string().optional(),
  JWT_AUDIENCE: z.string().optional(),

  // Where tenant records (id, scopes, rate limit tier, provider credentials) are loaded from.
  // A flat JSON file is enough for a single-instance deployment; swap tenants/store.ts's loader for
  // a real database once you need multi-instance writes or a self-serve provisioning API.
  TENANTS_FILE: z.string().default('./tenants.json'),

  // Default per-tenant rate limit, used for any tenant that doesn't set its own in tenants.json.
  RATE_LIMIT_POINTS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();

export const allowedHostnames = env.ALLOWED_HOSTS === 'any' ? null : env.ALLOWED_HOSTS.split(',').map((h) => h.trim()).filter(Boolean);
export const allowedOrigins = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
