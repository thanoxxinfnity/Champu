# Chomugiri MCP Server

A production remote MCP (Model Context Protocol) server: any MCP-compatible client — Claude's
Custom Connectors, Claude Code, a custom agent — can add this server's URL and immediately get
three real tools (`generate_image`, `generate_video`, `generate_3d_model`), gated by proper OAuth2/
JWT or API-key auth, per-tenant RBAC, and per-tenant rate limiting.

## Architecture

- **Transport**: [MCP Streamable HTTP](https://modelcontextprotocol.io/specification) (JSON-RPC
  2.0 over HTTP, with SSE available for streaming) via the official
  [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) — not a
  hand-rolled JSON-RPC parser. This supersedes the older plain-SSE transport (`SSEServerTransport`
  in the SDK, now deprecated); Streamable HTTP includes SSE internally and is what current clients,
  including Claude's Custom Connectors, speak.
- **Sessions**: stateful. `POST /mcp` with no `mcp-session-id` header and an `initialize` body opens
  a new session; the server assigns an id (returned as the `mcp-session-id` response header) and
  every later request on that session must carry it. An unrecognized session id is a `404`, not a
  silently-started new session (see `src/transport/http.ts`).
- **Auth**: every `/mcp` request — including `initialize` — passes through
  `requireBearerAuth` (the SDK's own middleware) before anything else runs. Bearer tokens are
  either JWTs (HS256 against a shared secret, or RS256/ES256 against a JWKS URL — your choice, see
  `src/auth/verifiers.ts`) or plain API keys, looked up by constant-time hash. Either way, auth
  resolves to a tenant; requests for a disabled or unknown tenant are refused even with an
  otherwise-valid token.
- **RBAC**: each tool requires a scope (`tools:image`, `tools:video`, `tools:model3d`, or the
  wildcard `tools:*`). Checked once at the HTTP layer isn't enough on its own — `tools/list` can
  legitimately show every tool so a client knows what exists, but `tools/call` re-checks the
  token's scopes at the point of use (`src/tools/register.ts`) and returns a structured MCP
  tool-level error (`isError: true`), not a crash or a silent no-op.
- **Rate limiting**: a token-bucket per tenant (`src/auth/rateLimiter.ts`), in memory by default —
  correct for one instance, and explicitly built to swap to `RateLimiterRedis` (same API) once you
  run more than one.
- **Validation**: every tool's input is a Zod schema (`src/tools/register.ts`); the SDK rejects a
  bad `tools/call` before your handler ever runs.
- **Tenants**: `tenants.json` (or swap `src/tenants/store.ts`'s `load()` for a real database) —
  each tenant has its own scopes, rate-limit tier, and its own provider credentials per capability
  (so Tenant A's image requests go to Tenant A's own NVIDIA NIM / Pollinations / whatever key, never
  shared with Tenant B).

```
src/
  env.ts                 Validated config (fails fast at boot, not on first request)
  errors.ts               Structured JSON-RPC error codes + HTTP status mapping
  logger.ts               pino, with bearer tokens/API keys redacted from every log line
  auth/
    verifiers.ts           JWT + API-key OAuthTokenVerifier implementations
    rbac.ts                 Scope checking
    rateLimiter.ts           Per-tenant token bucket
  tenants/
    store.ts                Tenant records: load, lookup by id/key/jwt-subject
    apiKey.ts                 Key generation/hashing (dependency-free — usable from a bare CLI)
  tools/
    register.ts              Tool definitions, Zod schemas, RBAC enforcement, error shaping
    providerProxy.ts           Calls the tenant's configured provider, polls a job if async
  mcp/
    createServer.ts            Builds one McpServer per session
  transport/
    http.ts                     Express app: auth chain, session routing, both POST/GET/DELETE /mcp
  index.ts                 Entrypoint: boots tenants, starts the HTTP server, graceful shutdown
test/
  integration.test.ts     Full stack: real HTTP requests, real MCP handshake, mock upstream provider
  jwt.test.ts               JwtVerifier against real signed JWTs (jose's own SignJWT)
```

## Quickstart (local)

```bash
npm install
cp .env.example .env
# edit .env — at minimum set PUBLIC_URL; leave JWT_* empty to run API-key-only for now
npx tsx scripts/gen-key.ts          # prints a raw key + its hash
cp tenants.example.json tenants.json  # put the printed hash into apiKeyHash, add your provider key
npm run dev                          # tsx watch — restarts on save
```

Then from another terminal:

```bash
curl -s http://localhost:8787/healthz
```

To actually drive the MCP protocol by hand, an `initialize` call looks like:

```bash
curl -s http://localhost:8787/mcp \
  -H "Authorization: Bearer cmk_..." \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}' -i
```

Take the `mcp-session-id` response header and pass it as `-H "mcp-session-id: ..."` on every
following request (`tools/list`, `tools/call`).

## Provisioning a tenant

1. `npx tsx scripts/gen-key.ts` — prints a raw key (give this to the tenant, once) and its hash.
2. Add an entry to `tenants.json`:
   ```json
   {
     "id": "acme",
     "name": "Acme Corp",
     "enabled": true,
     "apiKeyHash": "<the printed hash>",
     "scopes": ["tools:image", "tools:video"],
     "rateLimit": { "points": 30, "windowSeconds": 60 },
     "providers": {
       "image": { "baseUrl": "https://integrate.api.nvidia.com/v1", "apiKey": "nvapi-...", "model": "black-forest-labs/flux.1-dev" }
     }
   }
   ```
3. The server reloads `tenants.json` every 30s on its own (`src/index.ts`) — no restart needed. A
   revoked key or a scope you removed takes effect within that window.

For JWT-based auth instead (recommended once you have a real identity provider — Auth0, Okta,
Keycloak, Clerk, or your own Authorization Server issuing tokens), set `JWT_JWKS_URL` /
`JWT_ISSUER` / `JWT_AUDIENCE` in `.env` and give the tenant a `jwtSubject` matching the `sub` claim
your issuer puts in their tokens, instead of (or alongside) `apiKeyHash`.

## Adding this as a Custom Connector

Point the client at `https://mcp.yourdomain.com/mcp` with the tenant's bearer token. Claude's
Custom Connectors (and any spec-compliant MCP client) speak Streamable HTTP natively — no extra
configuration on this server's side beyond having it reachable over HTTPS with a valid cert (see
`nginx/mcp.conf`).

## Deployment

```bash
docker compose up -d --build
```

The container never bakes `tenants.json` or any secret into the image — `.env` and the tenants file
are both bind-mounted at runtime (`docker-compose.yml`). Put nginx (or any reverse proxy — Caddy and
Traefik both work; `nginx/mcp.conf` has the specific headers/buffering settings an MCP deployment
needs regardless of which proxy you pick) in front for TLS.

**Scaling past one instance**: two things are in-process today and need to move to shared state
first — the session map in `src/transport/http.ts` (a client's session must keep hitting the same
instance, either via sticky sessions at the load balancer or by moving session storage to Redis)
and the rate limiter (swap `RateLimiterMemory` for `RateLimiterRedis` in
`src/auth/rateLimiter.ts` — same `consume()` API, so nothing else changes). The `redis` profile in
`docker-compose.yml` is there for when you need it.

## Testing

```bash
npm test          # runs both test files below via Node's built-in test runner
```

- `test/integration.test.ts` — boots the real `createApp()` Express app and a mock upstream
  provider, then drives a full MCP session over real HTTP: auth rejection (missing/garbage/
  disabled-tenant tokens), a real `initialize` → `tools/list` → `tools/call` round trip against the
  mock provider, RBAC (a scope-less tenant gets a tool-level error, not a crash), Zod input
  validation, per-tenant rate-limit isolation, and session-id handling.
- `test/jwt.test.ts` — `JwtVerifier` against real signed JWTs (expired, wrong secret, wrong
  audience, unknown subject, disabled tenant, missing `exp`).

## Security notes

- Scopes are `tools:image` / `tools:video` / `tools:model3d` / `tools:*`. There is no default-allow;
  an unlisted scope means the tool is refused.
- API keys are stored as SHA-256 hashes only (`src/tenants/apiKey.ts`), compared in constant time.
  The raw key is shown exactly once, at generation.
- Every log line redacts `Authorization` headers and provider API keys (`src/logger.ts`).
- `ALLOWED_HOSTS` enables DNS-rebinding protection at the app layer; set it to your real hostname in
  production rather than leaving it on `any` (that value is meant for local dev behind a proxy that
  already enforces this, as `nginx/mcp.conf` does).
