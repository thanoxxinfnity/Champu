'use client';

import { getSetting, setSetting } from '@/lib/db/history';

/**
 * Provider credentials, held on the user's device.
 *
 * Before this existed the only way to give Chomugiri an NVIDIA key was to edit
 * .env.local on the machine running the server — impossible from a phone, and
 * the reason the app could look completely broken on a fresh install: no key
 * meant no NIM models, which meant nothing answered.
 *
 * Two storage backends, because there are two ways Chomugiri runs:
 *
 *   - In the APK the key belongs to the native shell, which already holds it in
 *     encrypted prefs and injects it server-side. The web layer just posts to
 *     /api/shell/keys and never keeps a copy.
 *   - In the browser there is no native shell, so the key lives in IndexedDB
 *     alongside the rest of the workspace and rides along on each API request.
 *     It is sent to Chomugiri's own server and nowhere else.
 */

export interface ApiKeys {
  nim: string;
  pollinations: string;
}

const EMPTY: ApiKeys = { nim: '', pollinations: '' };

export const NIM_KEY_HEADER = 'x-chomugiri-nim-key';
export const POLLINATIONS_KEY_HEADER = 'x-chomugiri-pollinations-token';

/**
 * Read synchronously by every outgoing request, so it is mirrored in memory.
 * `loadKeys()` fills it once at boot.
 */
let cache: ApiKeys = { ...EMPTY };

/** True when running inside the Android shell, which owns the key itself. */
let shellHosted: boolean | null = null;

export function getKeys(): ApiKeys {
  return cache;
}

export async function loadKeys(): Promise<ApiKeys> {
  const stored = await getSetting<ApiKeys | null>('apiKeys', null);
  cache = { ...EMPTY, ...(stored ?? {}) };
  return cache;
}

export async function saveKeys(next: Partial<ApiKeys>): Promise<ApiKeys> {
  cache = { ...cache, ...next };
  // Trim here rather than at every call site: a key pasted from a web page
  // almost always arrives with a trailing newline, and the upstream 401s on it.
  cache = { nim: cache.nim.trim(), pollinations: cache.pollinations.trim() };

  if (await isShellHosted()) {
    // The shell is the system of record; keeping a second copy in IndexedDB
    // would leave a stale key behind after the user clears it natively.
    await postToShell(cache.nim);
    return cache;
  }

  await setSetting('apiKeys', cache);
  return cache;
}

/**
 * Headers carrying whatever the user has saved.
 *
 * Empty inside the Android shell: the key never leaves the native side there, so
 * sending it back through the WebView would be a copy with no purpose.
 */
export function keyHeaders(): Record<string, string> {
  if (shellHosted) return {};
  const h: Record<string, string> = {};
  if (cache.nim) h[NIM_KEY_HEADER] = cache.nim;
  if (cache.pollinations) h[POLLINATIONS_KEY_HEADER] = cache.pollinations;
  return h;
}

/** Merges the credential headers into an existing init, preserving its own. */
export function withKeys(init: RequestInit = {}): RequestInit {
  return { ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...keyHeaders() } };
}

/**
 * Probes for the native shell.
 *
 * /api/shell/keys exists only in the Android build — the web server has no such
 * route and answers 404, which is the signal. Cached: the answer cannot change
 * within a session.
 */
export async function isShellHosted(): Promise<boolean> {
  if (shellHosted !== null) return shellHosted;
  try {
    const res = await fetch('/api/shell/keys', { signal: AbortSignal.timeout(4000) });
    shellHosted = res.ok;
  } catch {
    shellHosted = false;
  }
  return shellHosted;
}

/** Whether a NIM key is configured, from whichever side owns it. */
export async function nimConfigured(): Promise<boolean> {
  if (await isShellHosted()) {
    try {
      const res = await fetch('/api/shell/keys', { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return false;
      const json = (await res.json()) as { nimConfigured?: boolean };
      return Boolean(json.nimConfigured);
    } catch {
      return false;
    }
  }
  return Boolean(cache.nim);
}

async function postToShell(nim: string): Promise<void> {
  const res = await fetch('/api/shell/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nimKey: nim }),
  });
  if (!res.ok) throw new Error(`The app shell refused the key (${res.status}).`);
}

/**
 * A key's shape, checked before it is saved.
 *
 * Catching an obviously wrong paste here is worth it: the alternative is a 401
 * from NVIDIA several seconds later that reads as "the app is broken".
 */
export function validateNimKey(key: string): string | null {
  const k = key.trim();
  if (!k) return null;
  if (/\s/.test(k)) return 'That key contains a space — it was probably copied with surrounding text.';
  if (!k.startsWith('nvapi-')) return 'An NVIDIA NIM key starts with "nvapi-". Copy it again from build.nvidia.com.';
  if (k.length < 40) return 'That key looks truncated — NVIDIA keys are much longer.';
  return null;
}

/** Shows enough to recognise a key without revealing it. */
export function maskKey(key: string): string {
  const k = key.trim();
  if (k.length <= 12) return k ? '•'.repeat(k.length) : '';
  return `${k.slice(0, 9)}${'•'.repeat(10)}${k.slice(-4)}`;
}
