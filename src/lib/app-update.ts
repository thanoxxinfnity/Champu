/**
 * Does a newer build of the Android app exist? The app asks the project's public GitHub release (no account, no key) for the version it
 * carries and compares it with its own. A newer one is offered as a download: the phone's browser fetches the APK and Android asks
 * before installing it, as for any update from outside the Play Store. The web app needs none of this, it is always the newest.
 *
 * Two builds exist and each follows its own release, because Android only lets an update replace an app signed with the same key:
 *   com.chomugiri.workspace        the real app    → release "chomugiri-latest",   Chomugiri.apk
 *   com.chomugiri.workspace.next   "Chomugiri Next" → release "chomugiri-test-apk", Chomugiri-Next.apk
 */
export interface Shell { platform?: string; version?: string; appId?: string }
export interface UpdateInfo { current: string; latest: string; url: string; page: string; publishedAt?: string }

const REPO = 'thanoxxinfnity/Champu';
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const CACHE_KEY = 'chomugiri:update';

export function channelFor(appId = ''): { tag: string; asset: string } {
  if (/\.(next|ag)$/.test(appId)) return { tag: 'chomugiri-test-apk', asset: 'Chomugiri-Next.apk' };
  if (/\.v2$/.test(appId)) return { tag: 'chomugiri-latest', asset: 'Chomugiri-alt.apk' };
  return { tag: 'chomugiri-latest', asset: 'Chomugiri.apk' };
}

/** "Chomugiri v3.71 (latest)" → "3.71"; "Chomugiri Next v3.71-next.12" → "3.71-next.12". */
export function versionFromTitle(title = ''): string | null {
  return /\bv(\d+(?:\.\d+)*(?:-[a-z]+\.?\d*)?)/i.exec(title)?.[1] ?? null;
}

/** Numbers compared part by part; with equal numbers, a higher suffix number ("-next.12" over "-next.3") is newer. */
export function isNewer(latest: string, current: string): boolean {
  const split = (v: string) => { const [core, suffix = ''] = v.split('-'); return { nums: core.split('.').map((n) => Number(n) || 0), build: Number(/(\d+)\s*$/.exec(suffix)?.[1] ?? (suffix ? 0 : Infinity)) }; };
  const a = split(latest), b = split(current);
  for (let i = 0; i < Math.max(a.nums.length, b.nums.length); i++) {
    const d = (a.nums[i] ?? 0) - (b.nums[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  // Same numbers: "3.71" (no suffix) is newer than "3.71-next.4"; otherwise the higher build number wins.
  return a.build > b.build;
}

export function shell(): Shell | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { __chomugiriShell?: Shell }).__chomugiriShell ?? null;
}

/**
 * Asks the release. Returns the update when there is one, null when the app is current or cannot tell (old shell, no network).
 * The answer is remembered for six hours so opening the app does not ask GitHub every time; `force` asks now.
 */
export async function checkForUpdate(opts: { force?: boolean; sh?: Shell | null; fetchImpl?: typeof fetch; now?: number } = {}): Promise<UpdateInfo | null> {
  const sh = opts.sh === undefined ? shell() : opts.sh;
  if (!sh || sh.platform !== 'android' || !sh.version) return null;
  const now = opts.now ?? Date.now();
  if (!opts.force) {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as { at: number; for: string; info: UpdateInfo | null } | null;
      if (c && c.for === sh.version && now - c.at < CHECK_EVERY_MS) return c.info;
    } catch { /* no cache */ }
  }
  const { tag, asset } = channelFor(sh.appId);
  const res = await (opts.fetchImpl ?? fetch)(`https://api.github.com/repos/${REPO}/releases/tags/${tag}`, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
  if (!res.ok) throw new Error(res.status === 403 || res.status === 429 ? 'GitHub is busy right now. Try again in a while.' : `Could not read the release (${res.status}).`);
  const rel = (await res.json()) as { name?: string; html_url?: string; published_at?: string; assets?: Array<{ name: string; browser_download_url: string; updated_at?: string }> };
  const latest = versionFromTitle(rel.name);
  const file = rel.assets?.find((a) => a.name === asset);
  const info: UpdateInfo | null = latest && file && isNewer(latest, sh.version)
    ? { current: sh.version, latest, url: file.browser_download_url, page: rel.html_url ?? `https://github.com/${REPO}/releases/tag/${tag}`, publishedAt: file.updated_at ?? rel.published_at }
    : null;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: now, for: sh.version, info })); } catch { /* no storage */ }
  return info;
}
