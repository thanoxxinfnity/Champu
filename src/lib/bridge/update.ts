/**
 * Updating a terminal bridge that is older than the app needs.
 *
 * The bridge is a few .mjs files started by hand, so an app update does not reach it. The app carries a copy of them (public/agent/, see
 * scripts/sync-agent-assets.mjs) and writes them into the bridge's workspace through the file route every version has; the user then
 * restarts the bridge from the new files with one command. Pure functions here, the fetching injected, so it is tested without a bridge.
 */

/** The first bridge version that holds API keys. */
export const KEYS_MIN_VERSION = '1.2.0';

/** The first bridge version that runs background jobs (model calls that go on with the app closed). */
export const JOBS_MIN_VERSION = '1.3.0';

/** The first bridge version with desktop control (/v1/desktop). */
export const DESKTOP_MIN_VERSION = '1.4.0';

/** The first bridge that can restart itself on newer files the app wrote (/v1/restart) and picks them up when started again. */
export const RESTART_MIN_VERSION = '5.0.0';

export function canRestart(health: { version?: string; features?: string[] } | null | undefined): boolean {
  if (!health) return false;
  if (health.features?.includes('update')) return true;
  return !!health.version && compareVersions(health.version, RESTART_MIN_VERSION) >= 0;
}

/** True when the bridge is older than the one this app carries. */
export function bridgeOutdated(health: { version?: string } | null | undefined, latest: string | null | undefined): boolean {
  if (!health || !latest) return false;
  return !health.version || compareVersions(health.version, latest) < 0;
}

export function hasDesktop(health: { version?: string; features?: string[] } | null | undefined): boolean {
  if (!health) return false;
  if (health.features?.includes('desktop')) return true;
  return !!health.version && compareVersions(health.version, DESKTOP_MIN_VERSION) >= 0;
}

/** Bridge 5.1 added the Craft apps (install, command line, open on the private screen). */
export function hasCraft(health: { version?: string; features?: string[] } | null | undefined): boolean {
  if (!health) return false;
  if (health.features?.includes('craft')) return true;
  return !!health.version && compareVersions(health.version, '5.1.0') >= 0;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** True when the bridge cannot hold keys: it does not say it can, and its version is older than the one that can. */
export function lacksKeyStore(health: { version?: string; features?: string[] } | null | undefined): boolean {
  if (!health) return false;
  if (health.features?.includes('keys')) return false;
  return !health.version || compareVersions(health.version, KEYS_MIN_VERSION) < 0;
}

/** True when the bridge can run background jobs. */
export function hasJobs(health: { version?: string; features?: string[] } | null | undefined): boolean {
  if (!health) return false;
  if (health.features?.includes('jobs')) return true;
  return !!health.version && compareVersions(health.version, JOBS_MIN_VERSION) >= 0;
}

export interface AgentManifest {
  version: string;
  files: string[];
}

/** Where the new files are written, inside the bridge's workspace. */
export const UPDATE_DIR = '.chomugiri-agent';

export function portOf(url: string): number {
  try {
    const u = new URL(url);
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname) && u.port) return Number(u.port);
  } catch {
    // not a URL
  }
  return 7717;
}

/** The one line that starts the bridge from the new files, with the same workspace and token, so the app keeps working unchanged. */
export function restartCommand(opts: { workspace: string; token: string; url: string }): string {
  const dir = opts.workspace.replace(/[\\/]+$/, '');
  return `node "${dir}/${UPDATE_DIR}/chomugiri-agent.mjs" --workspace "${dir}" --port ${portOf(opts.url)} --token ${opts.token}`;
}

export interface UpdateIo {
  fetchText: (path: string) => Promise<string>;
  writeFiles: (files: Array<{ path: string; content: string }>) => Promise<unknown>;
}

/** Reads the agent files the app carries and writes them to the bridge. Returns the version written. */
export async function pushAgentFiles(io: UpdateIo): Promise<{ version: string; files: string[] }> {
  const manifest = JSON.parse(await io.fetchText('/agent/manifest.json')) as AgentManifest;
  if (!manifest.files?.includes('chomugiri-agent.mjs')) throw new Error('This app has no bridge files to send (agent/manifest.json is missing the agent).');
  const files: Array<{ path: string; content: string }> = [];
  for (const name of manifest.files) {
    if (!/^[\w.-]+\.mjs$/.test(name)) throw new Error(`Unexpected file name in the manifest: ${name}`);
    files.push({ path: `${UPDATE_DIR}/${name}`, content: await io.fetchText(`/agent/${name}`) });
  }
  await io.writeFiles(files);
  return { version: manifest.version, files: manifest.files };
}
