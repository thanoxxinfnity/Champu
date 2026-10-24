/**
 * The bridge's own key store: API keys that live on the machine running the bridge, not in the app.
 *
 * Why: an app on a phone can be closed or killed to free memory; a bridge on a PC or in Termux keeps running. With the keys
 * stored here, any command the bridge runs (a script, a background job, an agent CLI) finds them as ordinary environment
 * variables — GROQ_API_KEY and the like — with the app closed.
 *
 * One JSON file, owner-only (0600), outside the workspace so no zip or collect step can pick it up. It is replaced as a whole
 * by "Pull APIs on terminal" in the app and wiped by "Delete APIs from terminal".
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const NAME = /^[A-Z][A-Z0-9_]{1,63}$/;

export function keystorePath() {
  return process.env.CHOMUGIRI_KEYS_FILE || path.join(homedir(), '.chomugiri', 'keys.json');
}

/** `{ savedAt, env }`; an empty store when there is no file or it is unreadable. */
export function readKeystore() {
  try {
    const data = JSON.parse(readFileSync(keystorePath(), 'utf8'));
    const env = {};
    for (const [k, v] of Object.entries(data.env ?? {})) if (NAME.test(k) && typeof v === 'string' && v) env[k] = v;
    return { savedAt: Number(data.savedAt) || 0, env };
  } catch {
    return { savedAt: 0, env: {} };
  }
}

/** Replaces the whole store. Returns what was stored (names only). */
export function writeKeystore(env, now = Date.now()) {
  const clean = {};
  for (const [k, v] of Object.entries(env ?? {})) {
    if (!NAME.test(k)) throw Object.assign(new Error(`"${k}" is not a valid variable name (CAPITALS, digits and _).`), { statusCode: 400 });
    const value = String(v ?? '').trim();
    if (!value) continue;
    if (/[\r\n\0]/.test(value) || value.length > 8192) throw Object.assign(new Error(`The value for ${k} is not a single-line key.`), { statusCode: 400 });
    clean[k] = value;
  }
  const file = keystorePath();
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify({ savedAt: now, env: clean }), { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* not supported on this filesystem */ }
  return Object.keys(clean);
}

/** Removes the named variables, or everything when no names are given. Returns how many were removed. */
export function deleteKeystore(names) {
  const before = readKeystore();
  if (!Array.isArray(names) || !names.length) {
    rmSync(keystorePath(), { force: true });
    return Object.keys(before.env).length;
  }
  const env = { ...before.env };
  let n = 0;
  for (const k of names) if (k in env) { delete env[k]; n++; }
  if (Object.keys(env).length) writeKeystore(env, before.savedAt);
  else rmSync(keystorePath(), { force: true });
  return n;
}

/** What may be shown: the name and a masked tail, never the key. */
export function describeKeystore() {
  const { savedAt, env } = readKeystore();
  const keys = Object.entries(env).map(([name, value]) => ({ name, hint: value.length > 8 ? `••••${value.slice(-4)}` : '••••' }));
  return { count: keys.length, savedAt, keys };
}

/** `node chomugiri-agent.mjs keys list|delete [NAME…]` — manage the store from the terminal itself. */
export function keysCli(args) {
  const [cmd, ...names] = args;
  if (cmd === 'list' || !cmd) {
    const d = describeKeystore();
    process.stdout.write(d.count ? d.keys.map((k) => `${k.name}  ${k.hint}`).join('\n') + '\n' : 'No keys stored on this terminal.\n');
    return 0;
  }
  if (cmd === 'delete') {
    const n = deleteKeystore(names);
    process.stdout.write(`Deleted ${n} key${n === 1 ? '' : 's'} from this terminal.\n`);
    return 0;
  }
  process.stderr.write('Usage: node chomugiri-agent.mjs keys list | keys delete [NAME …]\n');
  return 2;
}
