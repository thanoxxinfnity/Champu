import { NextRequest } from 'next/server';
import { keysFromRequest, withRequestKeys } from '@/lib/providers/request-keys';
import { hasNimKey, listModels as listNimModels } from '@/lib/providers/nim';
import { listModels as listPollinationsModels } from '@/lib/providers/pollinations';
import type { ModelDescriptor } from '@/lib/providers/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Live model catalogue.
 * Providers are probed in parallel and a failure in one never blanks the others —
 * a down Pollinations endpoint must not remove NIM from the model switcher.
 */
async function handleGET(req: NextRequest) {
  const force = req.nextUrl.searchParams.get('refresh') === '1';

  const [nim, pollinations] = await Promise.allSettled([
    hasNimKey() ? listNimModels() : Promise.resolve<ModelDescriptor[]>([]),
    listPollinationsModels(),
  ]);

  const models: ModelDescriptor[] = [];
  const warnings: string[] = [];

  if (nim.status === 'fulfilled') models.push(...nim.value);
  else warnings.push(`NVIDIA NIM catalogue unavailable: ${(nim.reason as Error)?.message ?? 'unknown error'}`);

  if (pollinations.status === 'fulfilled') models.push(...pollinations.value);
  else warnings.push(`Pollinations catalogue unavailable: ${(pollinations.reason as Error)?.message ?? 'unknown error'}`);

  if (!hasNimKey()) {
    warnings.push('No NVIDIA NIM key yet — NIM models are hidden. Open Settings → API Keys to add one. Pollinations needs no key and stays available.');
  }

  return Response.json(
    {
      models,
      warnings,
      providers: {
        nim: { configured: hasNimKey(), count: models.filter((m) => m.provider === 'nim').length },
        pollinations: { configured: true, count: models.filter((m) => m.provider === 'pollinations').length },
      },
      refreshed: force,
      at: Date.now(),
    },
    { headers: { 'Cache-Control': force ? 'no-store' : 'public, max-age=60, stale-while-revalidate=600' } },
  );
}

/**
 * Credentials the user saved in the app travel on the request, so the web build
 * works without anyone editing .env.local. The server's own environment is still
 * the fallback, so a self-hosted instance is unaffected.
 */
export async function GET(req: NextRequest) {
  return withRequestKeys(keysFromRequest(req), () => handleGET(req));
}
