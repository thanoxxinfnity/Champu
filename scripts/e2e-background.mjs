/**
 * Background messages, in a real browser against a real bridge: node scripts/e2e-background.mjs   (needs `npm run build` first)
 *
 * A mock model answers slowly. The page sends a message with "background" on, is RELOADED while the answer is still being written (the app
 * closing), and the whole reply — with its file — must be in the chat when it comes back, with the bridge's copy acknowledged and deleted.
 * Also checks: the deploy button only exists once a site's files do, the terminal key auto-push mirrors custom endpoints, and a file written
 * by the reply is still there after another reload.
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); };

// mock model: streams a reply with a file in it, taking ~4 s
const REPLY = 'BG-ANSWER here is your page.\n\n```html path=index.html\n<!doctype html><title>bg</title><h1>made in the background</h1>\n```\n';
const model = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const parts = REPLY.match(/[\s\S]{1,40}/g);
    for (const p of parts) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`);
      await wait(Math.round(4000 / parts.length));
    }
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
});
await new Promise((r) => model.listen(0, '127.0.0.1', r));
const MODEL_PORT = model.address().port;

const dir = mkdtempSync(path.join(tmpdir(), 'e2e-bg-'));
const BRIDGE_PORT = 7600 + Math.floor(Math.random() * 90);
const TOKEN = 'e2e-token-123456';
const bridge = spawn('node', ['agent/chomugiri-agent.mjs', '--port', String(BRIDGE_PORT), '--workspace', dir, '--token', TOKEN], {
  stdio: 'ignore',
  env: { ...process.env, CHOMUGIRI_JOBS_DIR: path.join(dir, 'jobs'), CHOMUGIRI_KEYS_FILE: path.join(dir, 'keys.json') },
});
const APP_PORT = 3700 + Math.floor(Math.random() * 90);
const app = spawn('npx', ['next', 'start', '-p', String(APP_PORT)], { stdio: 'ignore' });
const bh = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const bcall = async (p, body) => (await fetch(`http://127.0.0.1:${BRIDGE_PORT}${p}`, body ? { method: 'POST', headers: bh, body: JSON.stringify(body) } : { headers: bh })).json();
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(`http://127.0.0.1:${BRIDGE_PORT}/v1/ping`)).ok && (await fetch(`http://127.0.0.1:${APP_PORT}/`)).ok) break; } catch { /* starting */ }
  await wait(300);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"models":[],"keys":{}}' }));
page.on('console', (m) => { if (/background:|Error|error/.test(m.text()) && !/Failed to load resource/.test(m.text())) console.log('  [page]', m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 300)));
const base = `http://127.0.0.1:${APP_PORT}`;
await page.goto(base, { waitUntil: 'load' });
const box = page.locator('textarea').first();
await box.waitFor({ timeout: 30000 });

// seed: the terminal, one custom endpoint serving the mock model, the chosen model
await page.evaluate(async ({ bridgeCfg, endpoint, selection }) => {
  const open = () => new Promise((res, rej) => { const r = indexedDB.open('chomugiri'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const db = await open();
  const put = (store, value) => new Promise((res, rej) => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(value); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  await put('settings', { key: 'bridge', value: bridgeCfg, updatedAt: Date.now() });
  await put('settings', { key: 'selection', value: selection, updatedAt: Date.now() });
  await put('settings', { key: 'autoPushKeys', value: true, updatedAt: Date.now() });
  await put('endpoints', endpoint);
  db.close();
}, {
  bridgeCfg: { url: `http://127.0.0.1:${BRIDGE_PORT}`, token: TOKEN, via: 'direct' },
  selection: { provider: 'custom', model: 'mock-model', endpointId: 'ep1' },
  endpoint: { id: 'ep1', label: 'Mock', baseUrl: `http://127.0.0.1:${MODEL_PORT}/v1`, apiKey: 'sk-mock-secret', capabilities: ['chat'], models: [{ id: 'mock-model', label: 'mock', capabilities: ['chat'] }], routes: [], probeOk: 1, enabled: 1, createdAt: Date.now() },
});
await page.reload({ waitUntil: 'load' });
await box.waitFor({ timeout: 30000 });

const chip = page.getByTestId('background-chip');
await chip.waitFor({ timeout: 30000 });
check('the background chip appears once the bridge (1.3.0) is connected', true);
check('no deploy button before there is a site', (await page.locator('header button', { hasText: /▲|↻/ }).count()) === 0);

// auto-push: the custom endpoint's key reached the terminal without pressing anything
let held = [];
for (let i = 0; i < 20 && !held.includes('ENDPOINT_MOCK_API_KEY'); i++) { await wait(500); held = (await bcall('/v1/keys')).keys.map((k) => k.name); }
check('auto-push put the custom endpoint on the terminal', held.includes('ENDPOINT_MOCK_API_KEY') && held.includes('ENDPOINT_MOCK_BASE_URL'), `(${held.join(',')})`);

await chip.click();
await box.fill('make me a page');
await box.press('Enter');
await page.getByTestId('background-strip').waitFor({ timeout: 15000 });
check('the waiting reply says it is working on the terminal', true);
let jobs = [];
for (let i = 0; i < 20 && !jobs.length; i++) { jobs = (await bcall('/v1/jobs')).jobs; if (!jobs.length) await wait(250); }
check('the terminal has the job', jobs.length === 1 && jobs[0].status === 'running', `(${jobs.map((j) => j.status).join(',')})`);

// the app "closes": reload while the model is still writing
await wait(900);
await page.reload({ waitUntil: 'load' });
await box.waitFor({ timeout: 30000 });
await page.getByText('make me a page').first().waitFor({ timeout: 15000 });
check('after the reload the conversation is back (it reopens by itself)', true);

// ... and later the whole answer is simply there
await page.getByText('BG-ANSWER').first().waitFor({ timeout: 40000 });
check('the reply starts filling in by itself', true);
await page.getByTestId('background-strip').waitFor({ state: 'detached', timeout: 40000 }).catch(() => {});
check('no "working" strip is left once it is finished', (await page.getByTestId('background-strip').count()) === 0);
check('the whole reply is there, file included', (await page.locator('body').innerText()).includes('made in the background'));
await wait(1500);
jobs = (await bcall('/v1/jobs')).jobs;
check('the terminal forgot the job once it was taken in', jobs.length === 0, `(${jobs.length} left)`);
check('the page the reply wrote is a site, so the deploy button shows now', (await page.locator('header button', { hasText: /▲|↻/ }).count()) > 0);

// the file survives another reload (it lives in the browser's database, not in memory)
await page.reload({ waitUntil: 'load' });
await box.waitFor({ timeout: 30000 });
await page.getByText('BG-ANSWER').first().waitFor({ timeout: 15000 });
await page.getByRole('button', { name: /files/i }).first().click().catch(() => {});
await wait(800);
check('the file is still there after reloading', (await page.locator('body').innerText()).includes('index.html'));

await browser.close();
bridge.kill();
app.kill();
model.close();
console.log(results.every(Boolean) ? 'ALL OK' : 'FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
