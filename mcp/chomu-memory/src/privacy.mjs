// Everything that keeps the archive private: what is never read, what is blanked out before it is stored, and the one network rule.
import { resolve, relative, sep, isAbsolute, join } from 'node:path';
import { readFileSync } from 'node:fs';

export const IGNORED_DIRS = new Set([
  '.git', '.hg', '.svn', 'node_modules', '.chomu-memory', 'dist', 'build', 'out', '.next', '.nuxt', '.godot', '.import', '__pycache__',
  '.venv', 'venv', 'env', 'target', 'coverage', '.cache', '.gradle', 'Pods', 'vendor', 'releases', '.idea', '.vscode', 'tmp',
]);

export const CODE_EXT = {
  ts: 'ts', tsx: 'ts', mts: 'ts', cts: 'ts', js: 'ts', jsx: 'ts', mjs: 'ts', cjs: 'ts',
  py: 'py', gd: 'gd', go: 'go', rs: 'rs', java: 'java', kt: 'java', cs: 'java', c: 'java', h: 'java', cpp: 'java', cc: 'java', hpp: 'java',
  rb: 'rb', php: 'php', swift: 'java', lua: 'lua', sh: 'sh',
  md: 'doc', txt: 'doc', json: 'data', yaml: 'data', yml: 'data', toml: 'data', cfg: 'data', godot: 'data', tscn: 'data', gdshader: 'doc', html: 'doc', css: 'doc',
};

const SECRET_FILE = /(^\.env($|\.))|\.(pem|key|p12|pfx|keystore|jks|crt)$|(^|[\\/])(id_rsa|id_ed25519|credentials|secrets?)(\.|$)/i;
export const MAX_FILE_BYTES = 1_000_000;

/** A file is only read if its extension is a known text type, it is small, and it is not a key or an .env file. */
export function shouldIndex(relPath, size) {
  const parts = relPath.split(/[\\/]/);
  if (parts.some((p) => IGNORED_DIRS.has(p))) return false;
  const name = parts[parts.length - 1];
  if (SECRET_FILE.test(name) || SECRET_FILE.test(relPath)) return false;
  if (size > MAX_FILE_BYTES) return false;
  if (/\.min\.(js|css)$/.test(name) || /(^|[-.])lock(\.json|\.yaml)?$/.test(name)) return false;
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  return Object.prototype.hasOwnProperty.call(CODE_EXT, ext);
}

export function langOf(relPath) {
  const ext = relPath.includes('.') ? relPath.split('.').pop().toLowerCase() : '';
  return CODE_EXT[ext] ?? 'doc';
}

// Secret-looking strings are blanked before anything is stored (cards, facts, history, snapshots).
const KEYED = /(["']?(?:api[_-]?key|secret|token|password|passwd|authorization)["']?\s*[:=]\s*["'])[^"'\s]{12,}(["'])/gi;
const SECRETS = [
  /\b(sk|pk|rk)[-_][A-Za-z0-9_-]{16,}\b/g, /\bnvapi-[A-Za-z0-9_-]{16,}\b/g, /\bhf_[A-Za-z0-9]{20,}\b/g, /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bKGAT_[A-Za-z0-9]{16,}\b/g, /\bAKIA[0-9A-Z]{16}\b/g, /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];
export function redact(text) {
  let out = text;
  for (const re of SECRETS) out = out.replace(re, '[REDACTED]');
  return out.replace(KEYED, '$1[REDACTED]$2');
}

/** A path from a tool call, forced to stay inside the project root. */
export function safeJoin(root, rel) {
  const full = resolve(root, rel);
  const back = relative(root, full);
  if (back.startsWith('..') || isAbsolute(back)) throw new Error(`path escapes the project: ${rel}`);
  return full;
}
export const toPosix = (p) => p.split(sep).join('/');

/** The only network this program may ever use: the machine's own loopback (a local embedding server such as Ollama). */
export function assertLoopback(url) {
  const u = new URL(url);
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(u.hostname)) throw new Error(`refusing a non-local address: ${u.hostname} (nothing leaves this machine)`);
  if (process.env.CHOMU_OFFLINE === '1') throw new Error('CHOMU_OFFLINE=1: no network at all');
  return u;
}

/** .gitignore and .chomuignore (simple patterns: dir/, *.ext, /anchored, **; "!" lines are ignored) as a test on a project-relative path. */
export function loadIgnore(root) {
  const rules = [];
  for (const f of ['.gitignore', '.chomuignore']) {
    let text;
    try { text = readFileSync(join(root, f), 'utf8'); } catch { continue; }
    for (let line of text.split('\n')) {
      line = line.trim();
      if (!line || line.startsWith('#') || line.startsWith('!')) continue;
      const dirOnly = line.endsWith('/');
      const anchored = line.startsWith('/') || line.slice(0, -1).includes('/');
      const body = line.replace(/^\//, '').replace(/\/$/, '');
      const re = body.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '(?:.*/)?').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
      rules.push({ re: new RegExp(`${anchored ? '^' : '(?:^|/)'}${re}${dirOnly ? '(?:/|$)' : '(?:/.*)?$'}`), dirOnly });
    }
  }
  return (rel) => rules.some((r) => r.re.test(rel));
}
