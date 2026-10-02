#!/usr/bin/env node
/**
 * Serves site/ the way Vercel does, for looking at it locally:
 *   node scripts/dev-site.mjs [port]
 * - clean URLs (/privacy → privacy.html)
 * - /voice/* from public/voice (deploy.sh stages the same files)
 * - /api/nasa runs the real handler, with NASA_API_KEY read from .env.local
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const site = join(root, 'site');
const port = Number(process.argv[2] ?? 4173);

if (existsSync(join(root, '.env.local'))) {
  for (const line of readFileSync(join(root, '.env.local'), 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// Apply the same response headers vercel.json does, so a Content-Security-Policy mistake shows up here and not in production.
const rules = JSON.parse(readFileSync(join(site, 'vercel.json'), 'utf8')).headers.map((h) => ({ re: new RegExp(`^${h.source}$`), headers: h.headers }));
const applyHeaders = (p, res) => { for (const r of rules) if (r.re.test(p)) for (const { key, value } of r.headers) res.setHeader(key, value); };

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.wav': 'audio/wav', '.svg': 'image/svg+xml' };

async function api(name, req, res, url) {
  const mod = await import(pathToFileURL(join(site, 'api', `${name}.js`)).href);
  req.query = Object.fromEntries(url.searchParams);
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
  await mod.default(req, res);
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${port}`);
    let p = decodeURIComponent(url.pathname);
    applyHeaders(p, res);
    const route = /^\/api\/([a-z-]+)$/.exec(p)?.[1];
    if (route && existsSync(join(site, 'api', `${route}.js`))) {
      if (req.method === 'POST') { let raw = ''; for await (const c of req) raw += c; req.body = raw; }
      return await api(route, req, res, url);
    }
    let file = p.startsWith('/voice/') ? join(root, 'public', normalize(p)) : join(site, normalize(p));
    if (!file.startsWith(site) && !file.startsWith(join(root, 'public'))) { res.statusCode = 403; return res.end(); }
    if (p.endsWith('/')) file = join(file, 'index.html');
    if (!extname(file)) file += '.html';
    const s = await stat(file).catch(() => null);
    if (!s?.isFile()) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    const buf = await readFile(file);
    // audio seeking needs Range, as Vercel's static hosting provides
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), buf.length - 1) : buf.length - 1;
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${buf.length}`);
      res.setHeader('Content-Length', end - start + 1);
      return res.end(buf.subarray(start, end + 1));
    }
    res.setHeader('Content-Length', buf.length);
    res.end(buf);
  } catch (e) { res.statusCode = 500; res.end(String(e.message)); }
}).listen(port, () => console.log(`site on http://localhost:${port}`));
