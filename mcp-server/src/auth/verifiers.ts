import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { env } from '../env.ts';
import { tenantStore } from '../tenants/store.ts';

// requireBearerAuth (the SDK's own middleware) only maps specific error classes to the right HTTP
// status; anything else — including our own McpHttpError — falls through to a generic 500, which
// would hide a plain "bad token" behind a misleading server error. Throwing the SDK's own
// InvalidTokenError here is what makes that middleware answer 401 with a correct WWW-Authenticate
// header instead.
const reject = (message: string): never => { throw new InvalidTokenError(message); };

// API keys don't carry their own expiry — they're valid until revoked in the tenant store — but
// requireBearerAuth hard-rejects any AuthInfo without a numeric expiresAt. This is a rolling
// "re-checked every N minutes" window, not a real expiry: it just satisfies that requirement
// without claiming a lifetime the key doesn't actually have.
const API_KEY_ROLLING_WINDOW_SECONDS = 15 * 60;

/** Space-separated OAuth2 `scope` claim, or an array — either way, a clean string[]. */
function parseScopes(claim: unknown): string[] {
  if (Array.isArray(claim)) return claim.filter((s): s is string => typeof s === 'string');
  if (typeof claim === 'string') return claim.split(/\s+/).filter(Boolean);
  return [];
}

/**
 * Verifies bearer tokens as JWTs — HS256 against a shared secret for a single self-issued
 * deployment, or RS256/ES256 against a JWKS URL for a real external identity provider (Auth0,
 * Okta, Keycloak, Clerk, …). Whichever is configured, the token's `sub` claim is looked up against
 * the tenant store so an otherwise-valid JWT from an unprovisioned subject is still refused.
 */
export class JwtVerifier implements OAuthTokenVerifier {
  private readonly jwks?: JWTVerifyGetKey;

  constructor() {
    if (env.JWT_JWKS_URL) this.jwks = createRemoteJWKSet(new URL(env.JWT_JWKS_URL));
  }

  get configured(): boolean {
    return Boolean(env.JWT_HS256_SECRET || this.jwks);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    if (!this.configured) return reject('JWT verification is not configured on this server.');
    const key = this.jwks ?? new TextEncoder().encode(env.JWT_HS256_SECRET);
    let payload;
    try {
      ({ payload } = await jwtVerify(token, key as JWTVerifyGetKey, {
        issuer: env.JWT_ISSUER,
        audience: env.JWT_AUDIENCE,
        // A small window absorbs clock skew between this server and the issuer without
        // meaningfully extending a stolen token's useful life.
        clockTolerance: 5,
      }));
    } catch (err) {
      return reject(`Bearer token rejected: ${(err as Error).message}`);
    }
    const sub = typeof payload.sub === 'string' ? payload.sub : undefined;
    if (!sub) return reject('Bearer token has no subject (sub) claim.');
    const tenant = tenantStore.byJwtSubject(sub);
    if (!tenant) return reject('Token subject does not map to a known, enabled tenant.');
    return {
      token,
      clientId: tenant.id,
      scopes: parseScopes(payload.scope ?? payload['scp']),
      expiresAt: payload.exp,
      resource: env.PUBLIC_URL ? new URL(env.PUBLIC_URL) : undefined,
      extra: { tenantId: tenant.id },
    };
  }
}

/**
 * Verifies bearer tokens as plain API keys (`cmk_...`, see tenants/store.ts#generateApiKey) looked
 * up by constant-time hash comparison. This is the on-ramp for a tenant who doesn't run their own
 * OAuth authorization server — hand them a key, they put it straight in `Authorization: Bearer`.
 */
export class ApiKeyVerifier implements OAuthTokenVerifier {
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const tenant = tenantStore.byApiKey(token);
    if (!tenant) return reject('Bearer token is not a recognized API key.');
    return {
      token,
      clientId: tenant.id,
      scopes: tenant.scopes,
      expiresAt: Math.floor(Date.now() / 1000) + API_KEY_ROLLING_WINDOW_SECONDS,
      resource: env.PUBLIC_URL ? new URL(env.PUBLIC_URL) : undefined,
      extra: { tenantId: tenant.id },
    };
  }
}

/** Tries JWT verification first (if configured), then falls back to API-key lookup. */
export class CompositeVerifier implements OAuthTokenVerifier {
  private readonly jwt = new JwtVerifier();
  private readonly apiKey = new ApiKeyVerifier();

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    if (this.jwt.configured) {
      try {
        return await this.jwt.verifyAccessToken(token);
      } catch {
        // Not a valid JWT for us (or not a JWT at all, e.g. a dot-free API key) — fall through.
      }
    }
    return this.apiKey.verifyAccessToken(token);
  }
}
