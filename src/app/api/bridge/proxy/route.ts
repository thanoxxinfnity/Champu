import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Server-side bridge relay.
 *
 * The browser normally talks to the tunnel directly — the agent sends
 * `Access-Control-Allow-Origin: *`. This relay exists for tunnels that strip or
 * rewrite CORS headers (some corporate Cloudflare Access configs, certain
 * reverse proxies). It forwards verbatim and preserves SSE streaming.
 *
 * The bridge URL and token travel in request headers and are never persisted.
 */

const BLOCKED_HOSTS = new Set(['169.254.169.254', 'metadata.google.internal']);

function targetFor(req: NextRequest): { url: string; token: string } | { error: string; status: number } {
  const base = req.headers.get('x-bridge-url')?.trim();
  const token = req.headers.get('x-bridge-token')?.trim();
  const path = req.nextUrl.searchParams.get('path');

  if (!base || !token) return { error: 'X-Bridge-Url and X-Bridge-Token headers are required.', status: 400 };
  if (!path || !path.startsWith('/v1/')) return { error: 'The `path` parameter must start with /v1/.', status: 400 };

  let url: URL;
  try {
    url = new URL(base.replace(/\/+$/, '') + path);
  } catch {
    return { error: `"${base}" is not a valid bridge URL.`, status: 400 };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { error: 'Bridge URL must be http or https.', status: 400 };
  }
  if (BLOCKED_HOSTS.has(url.hostname)) {
    return { error: 'That host is blocked.', status: 403 };
  }

  return { url: url.toString(), token };
}

async function relay(req: NextRequest, method: 'GET' | 'POST'): Promise<Response> {
  const target = targetFor(req);
  if ('error' in target) return Response.json({ error: target.error }, { status: target.status });

  const isStream = target.url.includes('/v1/stream/');

  let upstream: Response;
  try {
    upstream = await fetch(target.url, {
      method,
      headers: {
        Authorization: `Bearer ${target.token}`,
        'ngrok-skip-browser-warning': 'true',
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      body: method === 'POST' ? await req.text() : undefined,
      signal: req.signal,
      // @ts-expect-error — undici option, not in the DOM RequestInit type.
      duplex: 'half',
    });
  } catch (err) {
    return Response.json(
      { error: `Bridge unreachable through the relay: ${(err as Error).message}`, code: 'bridge_offline' },
      { status: 502 },
    );
  }

  if (isStream && upstream.body) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  const contentType = upstream.headers.get('content-type') ?? 'application/json';
  const headers: Record<string, string> = { 'Content-Type': contentType, 'Cache-Control': 'no-store' };
  const disposition = upstream.headers.get('content-disposition');
  if (disposition) headers['Content-Disposition'] = disposition;

  return new Response(upstream.body, { status: upstream.status, headers });
}

export const GET = (req: NextRequest) => relay(req, 'GET');
export const POST = (req: NextRequest) => relay(req, 'POST');
