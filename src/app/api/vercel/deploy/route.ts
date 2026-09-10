import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * One-click Vercel deployment.
 *
 * Proxied server-side because api.vercel.com sends no CORS headers for browser
 * origins, and because a personal access token should not sit in a fetch the
 * browser devtools network tab logs by default.
 *
 * The token arrives per-request from the user's Settings and is never persisted.
 */

const VERCEL_API = 'https://api.vercel.com';

interface DeployFile {
  path: string;
  content: string;
  /** `base64` for binary assets; anything else is treated as UTF-8 text. */
  encoding?: 'utf-8' | 'base64';
}

interface DeployRequest {
  token: string;
  teamId?: string;
  name: string;
  files: DeployFile[];
  target?: 'production' | 'preview';
  framework?: string | null;
  env?: Record<string, string>;
  buildCommand?: string | null;
  outputDirectory?: string | null;
  installCommand?: string | null;
  /** Wait for the build to finish instead of returning as soon as it is queued. */
  wait?: boolean;
}

interface VercelError {
  error?: { code?: string; message?: string };
}

/** Project names must be lowercase, alphanumeric plus `.-_`, max 100 chars. */
function normalizeProjectName(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 100);
  return slug || `chomugiri-${Date.now().toString(36)}`;
}

function validate(body: DeployRequest): string | null {
  if (!body?.token?.trim()) return 'A Vercel personal access token is required. Create one at vercel.com/account/tokens.';
  if (!Array.isArray(body.files) || body.files.length === 0) return 'No files to deploy — generate the frontend artifacts first.';
  if (body.files.length > 3000) return `Deployment carries ${body.files.length} files; Vercel's inline-file API caps out well below that. Push to git and deploy from the repository instead.`;

  const totalBytes = body.files.reduce((sum, f) => sum + (f.content?.length ?? 0), 0);
  if (totalBytes > 90 * 1024 * 1024) {
    return `Bundle is ~${Math.round(totalBytes / 1024 / 1024)}MB. The inline deployment API tops out near 100MB — trim assets or deploy from git.`;
  }

  const bad = body.files.find((f) => !f.path || f.path.startsWith('/') || f.path.includes('..'));
  if (bad) return `Illegal deployment path: "${bad?.path}".`;

  // An SPA with no index and no framework will 404 on the root — catch it here
  // rather than after a green deploy that serves nothing.
  const hasEntry = body.files.some((f) =>
    /^(index\.html|public\/index\.html|package\.json|app\/page\.(t|j)sx?|pages\/index\.(t|j)sx?|src\/app\/page\.(t|j)sx?)$/.test(f.path),
  );
  if (!hasEntry) {
    return 'No entry point found (index.html or package.json at the bundle root). Vercel would deploy an empty site.';
  }

  return null;
}

async function vercelFetch(path: string, token: string, init: RequestInit = {}, teamId?: string): Promise<Response> {
  const url = new URL(`${VERCEL_API}${path}`);
  if (teamId) url.searchParams.set('teamId', teamId);
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...((init.headers as Record<string, string>) ?? {}),
    },
    signal: AbortSignal.timeout(120_000),
  });
}

export async function POST(req: NextRequest) {
  let body: DeployRequest;
  try {
    body = (await req.json()) as DeployRequest;
  } catch {
    return Response.json({ error: 'Request body is not valid JSON.' }, { status: 400 });
  }

  const invalid = validate(body);
  if (invalid) return Response.json({ error: invalid, code: 'deploy_precheck_failed' }, { status: 400 });

  const token = body.token.trim();
  const name = normalizeProjectName(body.name);

  // 1. Verify the token before uploading anything — a 403 after a 40MB upload
  //    is a terrible experience and burns the user's bandwidth.
  const whoami = await vercelFetch('/v2/user', token, { method: 'GET' }, body.teamId).catch(() => null);
  if (!whoami || !whoami.ok) {
    const detail = whoami ? ((await whoami.json().catch(() => ({}))) as VercelError).error?.message : 'network failure';
    return Response.json(
      { error: `Vercel rejected the token (${whoami?.status ?? 'no response'}): ${detail}`, code: 'vercel_unauthorized' },
      { status: 401 },
    );
  }
  const user = (await whoami.json()) as { user?: { username?: string; email?: string } };

  // 2. Assemble the deployment payload.
  const files = body.files.map((f) => ({
    file: f.path.replace(/^\.\//, ''),
    data: f.content,
    encoding: f.encoding === 'base64' ? 'base64' : 'utf-8',
  }));

  const payload: Record<string, unknown> = {
    name,
    files,
    target: body.target ?? 'production',
    projectSettings: {
      framework: body.framework ?? null,
      buildCommand: body.buildCommand ?? null,
      outputDirectory: body.outputDirectory ?? null,
      installCommand: body.installCommand ?? null,
    },
  };

  if (body.env && Object.keys(body.env).length) {
    // v13 accepts build-time env inline; runtime env still needs the project API.
    payload.env = body.env;
    payload.build = { env: body.env };
  }

  const created = await vercelFetch('/v13/deployments', token, {
    method: 'POST',
    body: JSON.stringify(payload),
  }, body.teamId);

  const createdJson = (await created.json().catch(() => ({}))) as VercelError & {
    id?: string;
    url?: string;
    readyState?: string;
    inspectorUrl?: string;
    alias?: string[];
  };

  if (!created.ok || !createdJson.id) {
    return Response.json(
      {
        error: createdJson.error?.message ?? `Vercel returned ${created.status} with no deployment id.`,
        code: createdJson.error?.code ?? 'vercel_deploy_failed',
        status: created.status,
      },
      { status: created.status >= 400 ? created.status : 502 },
    );
  }

  const base = {
    deploymentId: createdJson.id,
    url: createdJson.url ? `https://${createdJson.url}` : null,
    inspectorUrl: createdJson.inspectorUrl ?? null,
    aliases: (createdJson.alias ?? []).map((a) => `https://${a}`),
    project: name,
    account: user.user?.username ?? user.user?.email ?? null,
    target: body.target ?? 'production',
    fileCount: files.length,
  };

  if (!body.wait) {
    return Response.json({ ...base, readyState: createdJson.readyState ?? 'QUEUED', pending: true });
  }

  // 3. Poll to a terminal state. Capped so the route cannot outlive maxDuration.
  const deadline = Date.now() + 240_000;
  let readyState = createdJson.readyState ?? 'QUEUED';
  let lastError: string | null = null;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));

    const poll = await vercelFetch(`/v13/deployments/${createdJson.id}`, token, { method: 'GET' }, body.teamId).catch(() => null);
    if (!poll?.ok) continue;

    const status = (await poll.json().catch(() => ({}))) as {
      readyState?: string;
      url?: string;
      alias?: string[];
      errorMessage?: string;
    };

    readyState = status.readyState ?? readyState;
    if (status.errorMessage) lastError = status.errorMessage;

    if (readyState === 'READY') {
      return Response.json({
        ...base,
        readyState,
        pending: false,
        url: status.url ? `https://${status.url}` : base.url,
        aliases: (status.alias ?? []).map((a) => `https://${a}`),
      });
    }
    if (readyState === 'ERROR' || readyState === 'CANCELED') {
      return Response.json(
        {
          ...base,
          readyState,
          pending: false,
          error: lastError ?? `Build finished in state ${readyState}. Open the inspector for the build log.`,
          code: 'vercel_build_failed',
        },
        { status: 502 },
      );
    }
  }

  return Response.json({
    ...base,
    readyState,
    pending: true,
    note: 'Build is still running past the gateway timeout. Track it in the Vercel inspector.',
  });
}
