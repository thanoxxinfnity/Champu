import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { env } from '../env.ts';
import { logger } from '../logger.ts';
import { hashApiKey, safeHashEqual } from './apiKey.ts';

export { hashApiKey, generateApiKey } from './apiKey.ts';

const ProviderConfigSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  model: z.string().min(1),
});

export const ToolScope = {
  Image: 'tools:image',
  Video: 'tools:video',
  Model3d: 'tools:model3d',
} as const;
export type ToolScopeValue = (typeof ToolScope)[keyof typeof ToolScope];

const TenantSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  /** SHA-256 hex digest of the tenant's API key. Never store the raw key. */
  apiKeyHash: z.string().length(64).optional(),
  /** `sub` claim this tenant's JWTs carry, for deployments verifying externally issued tokens. */
  jwtSubject: z.string().optional(),
  scopes: z.array(z.string()).default([]),
  rateLimit: z.object({ points: z.number().int().positive(), windowSeconds: z.number().int().positive() }).optional(),
  providers: z.object({
    image: ProviderConfigSchema.optional(),
    video: ProviderConfigSchema.optional(),
    model3d: ProviderConfigSchema.optional(),
  }).default({}),
});

export type Tenant = z.infer<typeof TenantSchema>;

const TenantsFileSchema = z.array(TenantSchema);

/**
 * Tenant records, in memory, reloaded from `TENANTS_FILE` on an interval. A flat JSON file is the
 * right amount of ceremony for one server instance; once you run more than one instance, or want
 * self-serve provisioning, swap `load()` below for reads against a real database — nothing else in
 * this module's public surface (`byApiKey`, `byId`) needs to change.
 */
class TenantStore {
  private tenants = new Map<string, Tenant>();
  private byApiKeyHash = new Map<string, Tenant>();

  async load(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(env.TENANTS_FILE, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.warn({ file: env.TENANTS_FILE }, 'No tenants file found — starting with zero tenants. Nothing can authenticate until one is provisioned.');
        return;
      }
      throw err;
    }
    const parsed = TenantsFileSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error(`Invalid tenants file ${env.TENANTS_FILE}: ${parsed.error.message}`);
    }
    const tenants = new Map<string, Tenant>();
    const byApiKeyHash = new Map<string, Tenant>();
    for (const t of parsed.data) {
      tenants.set(t.id, t);
      if (t.apiKeyHash) byApiKeyHash.set(t.apiKeyHash, t);
    }
    this.tenants = tenants;
    this.byApiKeyHash = byApiKeyHash;
    logger.info({ count: tenants.size }, 'Tenant store loaded.');
  }

  byId(id: string): Tenant | undefined {
    const t = this.tenants.get(id);
    return t?.enabled ? t : undefined;
  }

  /** Constant-time lookup against the stored hash so this never turns into a timing oracle. */
  byApiKey(rawKey: string): Tenant | undefined {
    const hash = hashApiKey(rawKey);
    for (const [storedHash, tenant] of this.byApiKeyHash) {
      if (safeHashEqual(storedHash, hash)) return tenant.enabled ? tenant : undefined;
    }
    return undefined;
  }

  byJwtSubject(sub: string): Tenant | undefined {
    for (const t of this.tenants.values()) if (t.jwtSubject === sub) return t.enabled ? t : undefined;
    return undefined;
  }

  async persistNew(tenant: Tenant): Promise<void> {
    this.tenants.set(tenant.id, tenant);
    if (tenant.apiKeyHash) this.byApiKeyHash.set(tenant.apiKeyHash, tenant);
    const all = [...this.tenants.values()];
    await writeFile(env.TENANTS_FILE, JSON.stringify(all, null, 2) + '\n', 'utf8');
  }
}

export const tenantStore = new TenantStore();
