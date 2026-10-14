/**
 * Exercises JwtVerifier directly against real signed JWTs (minted with `jose`'s own SignJWT, not
 * hand-built strings), independent of the HTTP layer.
 */
import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { writeFile, rm } from 'node:fs/promises';
import { SignJWT } from 'jose';

const TENANTS_FILE = './test/.tmp-jwt-tenants.json';
const SECRET = 'a-test-secret-at-least-16-bytes-long';
const ISSUER = 'https://issuer.example.test';
const AUDIENCE = 'https://mcp.example.test';

before(async () => {
  await writeFile(TENANTS_FILE, JSON.stringify([
    { id: 'jwt-tenant', name: 'JWT Tenant', enabled: true, jwtSubject: 'user-123', scopes: ['tools:image'], providers: {} },
    { id: 'jwt-disabled-tenant', name: 'Disabled', enabled: false, jwtSubject: 'user-456', scopes: ['tools:image'], providers: {} },
  ], null, 2));
  process.env.PUBLIC_URL = AUDIENCE;
  process.env.TENANTS_FILE = TENANTS_FILE;
  process.env.JWT_HS256_SECRET = SECRET;
  process.env.JWT_ISSUER = ISSUER;
  process.env.JWT_AUDIENCE = AUDIENCE;
  process.env.LOG_LEVEL = 'silent';
  const { tenantStore } = await import('../src/tenants/store.ts');
  await tenantStore.load();
});

after(() => rm(TENANTS_FILE, { force: true }));

const key = new TextEncoder().encode(SECRET);
const sign = (claims: Record<string, unknown>, opts: { expSeconds?: number; issuer?: string; audience?: string } = {}) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(opts.issuer ?? ISSUER)
    .setAudience(opts.audience ?? AUDIENCE)
    .setExpirationTime(Math.floor(Date.now() / 1000) + (opts.expSeconds ?? 3600))
    .sign(key);

test('a correctly signed, unexpired JWT for a known tenant verifies and carries its scopes', async () => {
  const { JwtVerifier } = await import('../src/auth/verifiers.ts');
  const verifier = new JwtVerifier();
  const token = await sign({ sub: 'user-123', scope: 'tools:image tools:video' });
  const info = await verifier.verifyAccessToken(token);
  assert.equal(info.clientId, 'jwt-tenant');
  assert.deepEqual(info.scopes.sort(), ['tools:image', 'tools:video']);
  assert.ok(info.expiresAt && info.expiresAt > Date.now() / 1000);
});

test('an expired JWT is rejected', async () => {
  const { JwtVerifier } = await import('../src/auth/verifiers.ts');
  const verifier = new JwtVerifier();
  const token = await sign({ sub: 'user-123' }, { expSeconds: -60 });
  await assert.rejects(() => verifier.verifyAccessToken(token));
});

test('a JWT signed with the wrong secret is rejected', async () => {
  const { JwtVerifier } = await import('../src/auth/verifiers.ts');
  const verifier = new JwtVerifier();
  const wrongKey = new TextEncoder().encode('a-completely-different-secret-16b');
  const token = await new SignJWT({ sub: 'user-123' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime('1h')
    .sign(wrongKey);
  await assert.rejects(() => verifier.verifyAccessToken(token));
});

test('a JWT with the wrong audience is rejected (the token was not issued for this server)', async () => {
  const { JwtVerifier } = await import('../src/auth/verifiers.ts');
  const verifier = new JwtVerifier();
  const token = await sign({ sub: 'user-123' }, { audience: 'https://some-other-service.example.test' });
  await assert.rejects(() => verifier.verifyAccessToken(token));
});

test('a validly-signed JWT for an unknown subject is rejected (no tenant provisioned)', async () => {
  const { JwtVerifier } = await import('../src/auth/verifiers.ts');
  const verifier = new JwtVerifier();
  const token = await sign({ sub: 'no-such-user' });
  await assert.rejects(() => verifier.verifyAccessToken(token));
});

test('a validly-signed JWT for a disabled tenant is rejected', async () => {
  const { JwtVerifier } = await import('../src/auth/verifiers.ts');
  const verifier = new JwtVerifier();
  const token = await sign({ sub: 'user-456' });
  await assert.rejects(() => verifier.verifyAccessToken(token));
});

test('a JWT with no exp claim is rejected by the HTTP middleware contract (no expiresAt) — but jose itself does not require exp, so this checks our own handling', async () => {
  const { JwtVerifier } = await import('../src/auth/verifiers.ts');
  const verifier = new JwtVerifier();
  const token = await new SignJWT({ sub: 'user-123' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .sign(key);
  const info = await verifier.verifyAccessToken(token);
  // jose happily verifies a no-exp token; it's requireBearerAuth (tested in integration.test.ts via
  // the API-key path's expiresAt handling) that then refuses any AuthInfo without a numeric expiresAt.
  assert.equal(info.expiresAt, undefined);
});
