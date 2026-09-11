import { NextRequest } from 'next/server';
import { DUCKAI_MODELS } from '@/lib/providers/duckai';
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
export async function GET(req: NextRequest) {
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

  // Duck.ai is a fixed list, not a probe: its catalogue lives in the site bundle,
  // and its chat API refuses non-browser callers outright, so there is nothing to
  // probe. These are always offered — they need no key and no account.
  models.push(...DUCKAI_MODELS);

  if (!hasNimKey()) {
    warnings.push('NVIDIA_NIM_API_KEY is not configured — NIM models are hidden. Pollinations and the Duck.ai models need no key and stay available.');
  }

  return Response.json(
    {
      models,
      warnings,
      providers: {
        nim: { configured: hasNimKey(), count: models.filter((m) => m.provider === 'nim').length },
        pollinations: { configured: true, count: models.filter((m) => m.provider === 'pollinations').length },
        duckai: { configured: true, count: models.filter((m) => m.provider === 'duckai').length },
      },
      refreshed: force,
      at: Date.now(),
    },
    { headers: { 'Cache-Control': force ? 'no-store' : 'public, max-age=60, stale-while-revalidate=600' } },
  );
}
