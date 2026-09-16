/**
 * Does the game actually boot in a browser, loaded the way the chat loads it?
 *
 * Exports the real project to WebAssembly through the real module, builds the
 * player page the chat would build, opens it in Chromium and waits for Godot to
 * say it is running. Nothing about the shim can be checked any other way: it
 * exists to satisfy three different loaders inside emscripten, and whether it
 * does is a question only a browser can answer.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { buildWebOnBridge, playerPage, shimScript } from '../src/lib/suites/godot/web-export.ts';

const exec = promisify(execFile);
const ROOT = '/tmp/chomu-web-root';
const SOURCE = process.argv[2] ?? '/tmp/chomu-build-root/chomugiri-build/chomu-game';

const bridge = {
  async run(cmd, opts = {}) {
    try {
      const { stdout, stderr } = await exec('bash', ['-lc', cmd], {
        cwd: ROOT, maxBuffer: 64 * 1024 * 1024, timeout: opts.timeoutMs ?? 300_000,
      });
      return { exitCode: 0, stdout, stderr };
    } catch (err) {
      return { exitCode: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? String(err) };
    }
  },
  async writeFiles(files) {
    for (const f of files) {
      const dest = path.join(ROOT, f.path);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, f.base64 ? Buffer.from(f.base64, 'base64') : (f.content ?? ''));
    }
    return { count: files.length };
  },
  async readFile(p) {
    const buf = await fs.readFile(path.join(ROOT, p));
    return { bytes: buf.byteLength, base64: buf.toString('base64'), binary: true };
  },
};

await fs.rm(ROOT, { recursive: true, force: true });
await fs.mkdir(ROOT, { recursive: true });

// The project, read off disk exactly as the workspace would hand it over.
const files = [];
async function collect(dir, prefix = '') {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'build') continue;
    const full = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) { await collect(full, rel); continue; }
    const buf = await fs.readFile(full);
    const text = /\.(gd|tscn|godot|cfg|md|svg|import|json)$/.test(entry.name);
    files.push({ path: rel, content: text ? buf.toString('utf8') : `data:application/octet-stream;base64,${buf.toString('base64')}` });
  }
}
await collect(SOURCE);
console.log('project  ', files.length, 'files from', SOURCE);

const built = await buildWebOnBridge(bridge, files, {
  name: 'Chomu Game',
  onStage: (m) => console.log('         ·', m),
});
if (built.error) { console.log('FAILED —', built.error); console.log(built.log.slice(-1200)); process.exit(1); }
console.log('web build', built.files.map((f) => `${f.path} ${(f.bytes.byteLength / 1048576).toFixed(1)}MB`).join(', '));

// ── Now play it, the way the chat would ────────────────────────────────────
// The project pins a different @playwright/test than the image's browsers, so
// the binary is named rather than downloaded — see PLAYWRIGHT_BROWSERS_PATH.
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(m.text()));
page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));

// Served over http://localhost, not about:blank.
//
// Godot's web export refuses to start outside a secure context, and correctly:
// it needs one for the APIs it uses. `about:blank` is not one, and neither is a
// blob: document created from it — but a blob: iframe *inherits* its creator's
// origin, so a page served over https (the site) or over localhost (the phone's
// own loopback server, which is how the Android build serves itself) is one and
// so is everything it creates. Testing on about:blank tests a situation the app
// is never in.
const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!doctype html><title>host</title><body></body>');
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const { port } = server.address();
await page.goto(`http://localhost:${port}/`);
console.log('host     ', `http://localhost:${port}/  secure context:`, await page.evaluate(() => window.isSecureContext));

const payload = Object.fromEntries(
  built.files.map((f) => [f.path, Buffer.from(f.bytes).toString('base64')]),
);
const html = built.files.find((f) => f.path === 'index.html');
const loader = built.files.find((f) => f.path === 'index.js');

const started = await page.evaluate(
  async ({ payload, htmlText, loaderText, pageSource }) => {
    const urls = {};
    for (const [name, b64] of Object.entries(payload)) {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const type = name.endsWith('.wasm') ? 'application/wasm'
        : name.endsWith('.js') ? 'text/javascript'
        : name.endsWith('.html') ? 'text/html' : 'application/octet-stream';
      urls[name] = URL.createObjectURL(new Blob([bin], { type }));
    }
    // eslint-disable-next-line no-new-func
    const build = new Function('html', 'loaderJs', 'urls', pageSource + '; return playerPage(html, loaderJs, urls);');
    const doc = build(htmlText, loaderText, urls);

    const frame = document.createElement('iframe');
    frame.style.cssText = 'width:640px;height:400px;border:0';
    frame.src = URL.createObjectURL(new Blob([doc], { type: 'text/html' }));
    document.body.appendChild(frame);

    // Wait for a canvas with real pixels in it — the engine drawing a frame is
    // the only proof that matters.
    for (let i = 0; i < 240; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      const w = frame.contentWindow;
      const canvas = w?.document?.querySelector('canvas');
      if (canvas && canvas.width > 0 && canvas.height > 0) {
        const status = w.document.querySelector('#status-notice')?.textContent ?? '';
        if (status.trim()) return { ok: false, status };
        // The loader hides its progress bar once the engine takes over.
        const bar = w.document.querySelector('#status');
        if (!bar || bar.style.display === 'none' || getComputedStyle(bar).visibility === 'hidden') {
          return { ok: true, size: `${canvas.width}x${canvas.height}` };
        }
      }
    }
    return { ok: false, status: 'never started' };
  },
  {
    payload,
    htmlText: new TextDecoder().decode(html.bytes),
    loaderText: new TextDecoder().decode(loader.bytes),
    // The real functions, serialised into the page rather than reimplemented:
    // a probe that tests its own copy of the shim tests nothing.
    pageSource: `${shimScript.toString()}\n${playerPage.toString()}`,
  },
);

console.log('');
if (started.ok) {
  console.log('PLAY OK — Godot booted in the browser, canvas', started.size);
} else {
  console.log('PLAY FAILED —', started.status);
  console.log(logs.slice(-25).join('\n'));
}
await browser.close();
server.close();
process.exit(started.ok ? 0 : 1);
