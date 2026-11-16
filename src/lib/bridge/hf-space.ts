/**
 * Updating a terminal that runs as a Hugging Face Space, from inside the app.
 *
 * A Space is built from the files in its repository, so a bridge update used to mean uploading eight files by hand, and a Space
 * left on an old bridge is why new features "did not work". With the user's own Hugging Face token (Settings, API Keys) the app
 * does it in one tap: it keeps the current token as the Space's secret (so the link in the app stays valid) and commits a
 * Dockerfile that fetches the newest bridge from the project's repository every time the Space starts. After that the Space
 * never needs a manual update again. Rebuilding erases the Space's workspace, as any restart of a Space does; the caller says so.
 */
export const SPACE_DOCKERFILE = `# Chomugiri terminal on a Hugging Face Docker Space (or any container host).
# It fetches the newest bridge from the project's public repository every time it starts, so it never needs a manual update:
# "Restart the terminal" in the app, or a restart of the Space, is the update.
#
# Space settings: README header \`sdk: docker\` and \`app_port: 7860\`; a Space secret CHOMUGIRI_TOKEN (a long random word).
# The Space URL plus "#<that token>" is what you paste into Chomugiri.
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \\
      chromium xvfb xdotool imagemagick ca-certificates curl wget git unzip zip jq python3 python3-pip build-essential \\
      fonts-liberation fonts-noto-core \\
    && rm -rf /var/lib/apt/lists/*

# The node image's own ordinary user (uid 1000, what a Space runs as) owns everything the bridge touches.
RUN mkdir -p /app && chown -R 1000:1000 /app
USER 1000
WORKDIR /app

ENV HOME=/app \\
    CHOMUGIRI_HOST=0.0.0.0 \\
    CHOMUGIRI_PORT=7860 \\
    CHOMUGIRI_WORKSPACE=/app/workspace \\
    CHOMUGIRI_BROWSER_CHROMIUM=/usr/bin/chromium \\
    CHOMUGIRI_SOURCE=https://raw.githubusercontent.com/thanoxxinfnity/Champu/claude/chomugiri-workspace-design-09sxwa/agent

# A copy is fetched while the image is built, so the Space still starts when GitHub cannot be reached later.
RUN curl -fsSL "$CHOMUGIRI_SOURCE/docker/boot.mjs" -o boot.mjs && node boot.mjs --fetch-only

EXPOSE 7860
CMD ["node", "boot.mjs"]
`;

const HUB = 'https://huggingface.co';

/** Is this bridge address a Hugging Face Space? Returns its sub-domain ("user-space"), or null. */
export function spaceSubdomain(bridgeUrl: string): string | null {
  try {
    const host = new URL(bridgeUrl).hostname.toLowerCase();
    return host.endsWith('.hf.space') ? host.slice(0, -'.hf.space'.length) : null;
  } catch {
    return null;
  }
}

/** A Space's sub-domain is its "owner/name" with everything that is not a letter or digit turned into "-". */
export const subdomainOf = (repoId: string): string => repoId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export interface SpaceUpdateResult { repo: string; page: string }
export type SpaceStep = 'account' | 'space' | 'secret' | 'commit';

/**
 * Finds the Space behind `bridgeUrl` among the Spaces this token can write to, keeps `bridgeToken` as its CHOMUGIRI_TOKEN
 * secret and commits the self-updating Dockerfile. Throws with a plain sentence when a step cannot be done.
 */
export async function updateSpace(opts: { hfToken: string; bridgeUrl: string; bridgeToken: string; fetchImpl?: typeof fetch; onStep?: (s: SpaceStep) => void }): Promise<SpaceUpdateResult> {
  const f = opts.fetchImpl ?? fetch;
  const sub = spaceSubdomain(opts.bridgeUrl);
  if (!sub) throw new Error('This terminal is not a Hugging Face Space.');
  if (!opts.hfToken.trim()) throw new Error('Add your Hugging Face token first (Settings, API Keys). It needs write access.');
  const auth = { Authorization: `Bearer ${opts.hfToken.trim()}` };

  opts.onStep?.('account');
  const who = await f(`${HUB}/api/whoami-v2`, { headers: auth });
  if (who.status === 401) throw new Error('Hugging Face did not accept the token. Make a new one with write access at huggingface.co/settings/tokens.');
  if (!who.ok) throw new Error(`Hugging Face answered ${who.status} when asked who the token belongs to.`);
  const me = (await who.json()) as { name?: string; orgs?: Array<{ name?: string }> };
  const owners = [me.name, ...(me.orgs ?? []).map((o) => o.name)].filter((n): n is string => Boolean(n));

  opts.onStep?.('space');
  // The sub-domain is "owner-name" with dashes for every other character, so the owner is tried against each account of the token.
  let repo: string | null = null;
  for (const owner of owners) {
    const prefix = `${subdomainOf(owner)}-`;
    if (!sub.startsWith(prefix)) continue;
    const list = await f(`${HUB}/api/spaces?author=${encodeURIComponent(owner)}&limit=500`, { headers: auth });
    if (!list.ok) continue;
    const spaces = (await list.json()) as Array<{ id?: string }>;
    repo = spaces.map((s) => s.id ?? '').find((id) => subdomainOf(id) === sub) ?? null;
    if (repo) break;
  }
  if (!repo) throw new Error(`None of the Spaces this token can see is ${sub}.hf.space. Use a token of the account that owns the Space.`);

  opts.onStep?.('secret');
  const secret = await f(`${HUB}/api/spaces/${repo}/secrets`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'CHOMUGIRI_TOKEN', value: opts.bridgeToken, description: 'The token the Chomugiri app uses to reach this terminal.' }) });
  if (secret.status === 401 || secret.status === 403) throw new Error('The token may read this Space but not change it. Make a token with write access.');
  if (!secret.ok) throw new Error(`Hugging Face answered ${secret.status} when saving the terminal's token as a Space secret.`);

  opts.onStep?.('commit');
  const b64 = typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(SPACE_DOCKERFILE))) : Buffer.from(SPACE_DOCKERFILE, 'utf8').toString('base64');
  const body = [
    { key: 'header', value: { summary: 'Chomugiri terminal: fetch the newest bridge at start', description: 'Written by the Chomugiri app. The Space now updates its bridge by itself each time it starts.' } },
    { key: 'file', value: { content: b64, path: 'Dockerfile', encoding: 'base64' } },
  ].map((l) => JSON.stringify(l)).join('\n');
  const commit = await f(`${HUB}/api/spaces/${repo}/commit/main`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/x-ndjson' }, body });
  if (commit.status === 401 || commit.status === 403) throw new Error('The token is not allowed to write to this Space. Make a token with write access.');
  if (!commit.ok) throw new Error(`Hugging Face refused the change (${commit.status}). ${(await commit.text().catch(() => '')).slice(0, 160)}`.trim());
  return { repo, page: `${HUB}/spaces/${repo}` };
}
