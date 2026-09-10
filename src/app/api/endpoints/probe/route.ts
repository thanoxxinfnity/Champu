import { NextRequest } from 'next/server';
import { probeEndpoint } from '@/lib/providers/custom';
import type { CustomEndpointConfig } from '@/lib/providers/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Dynamic capability detection for a custom OpenAI-compatible endpoint.
 * The result drives which specialised workspace tool tabs get instantiated
 * (image / video / audio / 3D), so it is deliberately generous about what counts
 * as "route exists" — a 400 or 405 still proves the handler is mounted.
 */
export async function POST(req: NextRequest) {
  let cfg: CustomEndpointConfig;
  try {
    cfg = (await req.json()) as CustomEndpointConfig;
  } catch {
    return Response.json({ error: 'Request body is not valid JSON.' }, { status: 400 });
  }

  if (!cfg?.baseUrl) {
    return Response.json({ error: '`baseUrl` is required.' }, { status: 400 });
  }

  const probe = await probeEndpoint(cfg);
  return Response.json(probe, { status: probe.ok ? 200 : 422 });
}
