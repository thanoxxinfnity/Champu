import { RateLimiterMemory, type IRateLimiterOptions, type RateLimiterRes } from 'rate-limiter-flexible';
import { env } from '../env.ts';
import type { Tenant } from '../tenants/store.ts';

/**
 * Per-tenant token bucket. `RateLimiterMemory` is single-instance by nature — exactly right for
 * one server process. Scaling to more than one instance means every instance enforcing its own
 * independent bucket (an N-times-looser effective limit) unless the limiter is backed by a shared
 * store; `rate-limiter-flexible` ships a `RateLimiterRedis` with an identical `consume()` API for
 * exactly that case — swap the constructor below, nothing else in this file or its callers changes.
 */
class TenantRateLimiter {
  private limiters = new Map<string, RateLimiterMemory>();

  private limiterFor(tenant: Tenant): RateLimiterMemory {
    const existing = this.limiters.get(tenant.id);
    if (existing) return existing;
    const opts: IRateLimiterOptions = {
      points: tenant.rateLimit?.points ?? env.RATE_LIMIT_POINTS,
      duration: tenant.rateLimit?.windowSeconds ?? env.RATE_LIMIT_WINDOW_SECONDS,
      keyPrefix: `tenant:${tenant.id}`,
    };
    const limiter = new RateLimiterMemory(opts);
    this.limiters.set(tenant.id, limiter);
    return limiter;
  }

  /** Throws the limiter's own rejection (RateLimiterRes) on exhaustion — callers read `msBeforeNext` off it. */
  async consume(tenant: Tenant, points = 1): Promise<void> {
    await this.limiterFor(tenant).consume(tenant.id, points);
  }

  /** Dropped when a tenant record changes, so a lowered limit takes effect immediately rather than after the old bucket drains. */
  reset(tenantId: string): void {
    this.limiters.delete(tenantId);
  }
}

export const tenantRateLimiter = new TenantRateLimiter();
export type { RateLimiterRes };
