import type { DeployResult } from '@/lib/store';

/**
 * Whether the next deployment is a launch or an update.
 *
 * The distinction is the whole point of the control: an update must reuse the
 * live project so the site keeps its address, and a launch must not quietly
 * overwrite one. Kept out of the component so it can be tested directly —
 * getting this wrong either strands a URL people already have, or creates a
 * second site the user did not ask for.
 */

/** A previous deployment only counts as live if it actually produced a URL. */
export function liveSite(last: DeployResult | null | undefined): DeployResult | null {
  return last?.project && last.url ? last : null;
}

export type DeployMode = 'launch' | 'update';

export function deployMode(last: DeployResult | null | undefined, renaming = false): DeployMode {
  return liveSite(last) && !renaming ? 'update' : 'launch';
}

/**
 * The project this deployment will write to.
 *
 * While a site is live the typed name is ignored unless the user explicitly
 * chose to launch a separate one, because an update that lands on a different
 * project is not an update.
 */
export function targetProject(
  last: DeployResult | null | undefined,
  typedName: string,
  renaming = false,
): string {
  const live = liveSite(last);
  return live && !renaming ? live.project : typedName.trim();
}

/** Releases are counted per project, and a failed attempt is not a release. */
export function nextRelease(last: DeployResult | null | undefined): number {
  return (liveSite(last)?.releases ?? 0) + 1;
}

export interface Preflight {
  ready: boolean;
  /** Why it cannot ship, in the order worth telling the user about. */
  reason?: 'no-files' | 'no-token' | 'no-entry' | 'no-name';
}

const ENTRY = /^(index\.html|public\/index\.html|package\.json|app\/page\.(t|j)sx?|pages\/index\.(t|j)sx?|src\/app\/page\.(t|j)sx?)$/;

export function hasEntryPoint(paths: string[]): boolean {
  return paths.some((p) => ENTRY.test(p));
}

/** Everything that would make Vercel reject the upload, checked before sending it. */
export function preflight(opts: { paths: string[]; token: string; projectName: string }): Preflight {
  if (!opts.paths.length) return { ready: false, reason: 'no-files' };
  if (!opts.token.trim()) return { ready: false, reason: 'no-token' };
  if (!opts.projectName.trim()) return { ready: false, reason: 'no-name' };
  if (!hasEntryPoint(opts.paths)) return { ready: false, reason: 'no-entry' };
  return { ready: true };
}

/**
 * The deployment record to store after an attempt.
 *
 * A failed update must not erase the site that is still live: the URL and the
 * release count survive, and only the error and timestamp change. Otherwise one
 * bad build would make the app forget it owns a running site, and the next
 * deployment would launch a second one.
 */
export function recordAfter(
  previous: DeployResult | null | undefined,
  outcome:
    | { ok: true; url: string | null; inspectorUrl: string | null; readyState: string; project: string }
    | { ok: false; inspectorUrl?: string | null; readyState?: string; project: string; error?: string },
  now = Date.now(),
): DeployResult {
  const live = liveSite(previous);

  if (outcome.ok) {
    return {
      url: outcome.url,
      inspectorUrl: outcome.inspectorUrl,
      readyState: outcome.readyState,
      project: outcome.project,
      at: now,
      releases: (live?.releases ?? 0) + 1,
    };
  }

  return {
    url: live?.url ?? null,
    inspectorUrl: outcome.inspectorUrl ?? live?.inspectorUrl ?? null,
    readyState: outcome.readyState ?? 'ERROR',
    project: outcome.project,
    error: outcome.error,
    at: now,
    releases: live?.releases ?? 0,
  };
}
