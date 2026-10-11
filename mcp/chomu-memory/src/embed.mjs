// Turns text into vectors, on this machine. Default: a hashing embedder (no model, no download, no network). Optional: a local Ollama server.
import { assertLoopback } from './privacy.mjs';

const DIMS = 384;
const STOP = new Set('a an and are as at be by for from has have in is it its of on or that the this to was were will with not no if else then so do does did we you i my your our they them their can could should would may might into out up down over under per via using use used return returns'.split(' '));

// Words that mean nearly the same thing in code: each group becomes one extra shared token, which is what lets "login" find "authenticate".
const CONCEPTS = [
  ['auth', 'login', 'logout', 'signin', 'signup', 'authenticate', 'authorize', 'session', 'token', 'credential', 'password', 'jwt', 'oauth'],
  ['delete', 'remove', 'destroy', 'drop', 'erase', 'clear', 'purge', 'unlink'],
  ['create', 'add', 'insert', 'new', 'make', 'build', 'spawn', 'generate', 'init', 'initialize', 'setup'],
  ['read', 'get', 'fetch', 'load', 'retrieve', 'find', 'lookup', 'query', 'select', 'obtain'],
  ['write', 'save', 'store', 'persist', 'put', 'set', 'update', 'commit', 'flush', 'serialize'],
  ['send', 'emit', 'post', 'publish', 'dispatch', 'notify', 'broadcast', 'signal'],
  ['receive', 'listen', 'subscribe', 'handle', 'handler', 'callback', 'event', 'hook', 'on'],
  ['error', 'exception', 'fail', 'failure', 'crash', 'bug', 'fault', 'throw', 'panic', 'abort', 'invalid'],
  ['parse', 'decode', 'deserialize', 'tokenize', 'lex', 'scan', 'read'],
  ['render', 'draw', 'paint', 'display', 'show', 'view', 'ui', 'screen', 'canvas', 'component'],
  ['move', 'walk', 'run', 'velocity', 'position', 'translate', 'navigate', 'path'],
  ['enemy', 'monster', 'creature', 'robot', 'ai', 'hunter', 'warden', 'crawler', 'mob'],
  ['player', 'user', 'character', 'avatar', 'hero'],
  ['test', 'spec', 'assert', 'expect', 'check', 'verify', 'validate'],
  ['config', 'setting', 'option', 'preference', 'param', 'env', 'flag'],
  ['file', 'path', 'directory', 'folder', 'disk', 'fs', 'io'],
  ['cache', 'memo', 'memoize', 'buffer', 'pool', 'store'],
  ['memory', 'remember', 'recall', 'fact', 'history', 'archive', 'snapshot', 'checkpoint'],
  ['search', 'query', 'find', 'index', 'rank', 'match', 'filter'],
  ['network', 'http', 'request', 'response', 'fetch', 'api', 'socket', 'url', 'client', 'server'],
  ['db', 'database', 'sql', 'sqlite', 'table', 'row', 'record', 'schema', 'migration'],
  ['sound', 'audio', 'noise', 'music', 'sfx', 'volume'],
  ['light', 'lamp', 'shadow', 'shader', 'fog', 'glow', 'material', 'texture'],
];
const CONCEPT_OF = new Map();
CONCEPTS.forEach((group, i) => group.forEach((w) => { if (!CONCEPT_OF.has(w)) CONCEPT_OF.set(w, []); CONCEPT_OF.get(w).push(`~c${i}`); }));

const stem = (w) => (w.length > 5 ? w.replace(/(ing|ed|es|s|er|ly)$/, '') : w.length > 3 ? w.replace(/s$/, '') : w);

/** identifiers and prose into lowercase word pieces: getUserName, get_user_name and "get user name" all give get, user, name. */
export function tokenize(text) {
  const spaced = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  const out = [];
  for (const raw of spaced.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || raw.length > 40 || STOP.has(raw) || /^\d+$/.test(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export function hashVector(text, dims = DIMS) {
  const v = new Float32Array(dims);
  const toks = tokenize(text);
  const counts = new Map();
  const add = (t, w) => counts.set(t, (counts.get(t) ?? 0) + w);
  toks.forEach((t, i) => {
    add(t, 1);
    for (const c of CONCEPT_OF.get(t) ?? []) add(c, 0.9);
    if (i > 0) add(`${toks[i - 1]}_${t}`, 0.5);
  });
  for (const [t, c] of counts) {
    const h = fnv(t);
    v[h % dims] += (h & 0x80000000 ? -1 : 1) * (1 + Math.log(c));
  }
  let n = 0;
  for (let i = 0; i < dims; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < dims; i++) v[i] /= n;
  return v;
}

export function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function makeEmbedder(kind = process.env.CHOMU_EMBED || 'hash') {
  if (kind === 'ollama') {
    const base = process.env.CHOMU_OLLAMA_URL || 'http://127.0.0.1:11434';
    const model = process.env.CHOMU_OLLAMA_MODEL || 'nomic-embed-text';
    assertLoopback(base);
    return {
      id: `ollama:${model}`,
      async embed(texts) {
        const out = [];
        for (const t of texts) {
          const r = await fetch(new URL('/api/embeddings', base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, prompt: t.slice(0, 6000) }) });
          if (!r.ok) throw new Error(`ollama embeddings failed: ${r.status}`);
          const j = await r.json();
          out.push(Float32Array.from(j.embedding));
        }
        return out;
      },
    };
  }
  return { id: `hash:${DIMS}`, async embed(texts) { return texts.map((t) => hashVector(t)); } };
}

export const vecToBlob = (v) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
export const blobToVec = (b) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
