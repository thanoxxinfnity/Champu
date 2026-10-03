/**
 * Two sessions at once, in a real browser: node scripts/e2e-parallel-sessions.mjs [exportDir]
 * (export first: npm run build && node scripts/export-static.mjs /tmp/e2e-web)
 *
 * The chat endpoint is faked so each answer takes a few seconds. Checks that a second session starts
 * while the first is still answering, that "running" shows only in the session that is running, and that
 * each session ends up with its own answer.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.argv[2] ?? '/tmp/e2e-web';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
let inFlight = 0, peak = 0;
const asked = [];
await page.route('**/api/chat', async (route) => {
  const body = JSON.parse(route.request().postData() ?? '{}');
  const last = [...(body.messages ?? [])].reverse().find((m) => m.role === 'user');
  const text = typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content);
  asked.push(text);
  inFlight += 1; peak = Math.max(peak, inFlight);
  await new Promise((r) => setTimeout(r, 4000));
  inFlight -= 1;
  const frame = (o) => `data: ${JSON.stringify(o)}\n\n`;
  await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' },
    body: frame({ type: 'meta', provider: 'nim', model: 'mock' }) + frame({ type: 'delta', delta: `ANSWER-FOR[${text.slice(0, 20)}]` }) + frame({ type: 'done', finishReason: 'stop' }) });
});
await page.route('**/api/**', (route) => (route.request().url().includes('/api/chat') ? route.fallback() : route.fulfill({ status: 200, contentType: 'application/json', body: '{"models":[],"keys":{}}' })));

const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); };

await page.goto(base, { waitUntil: 'load' });
const box = page.locator('textarea').first();
await box.waitFor({ timeout: 20000 });

// session 1
await box.fill('first question');
await box.press('Enter');
await page.waitForTimeout(800);
const placeholder1 = await box.getAttribute('placeholder');
check('session 1 shows running', /Running/.test(placeholder1 ?? ''), `(${placeholder1})`);

// a brand-new chat while session 1 is still answering
await page.getByRole('button', { name: /new/i }).first().click().catch(() => {});
await page.waitForTimeout(400);
const placeholder2 = await box.getAttribute('placeholder');
check('new chat does not look busy', !/Running/.test(placeholder2 ?? ''), `(${placeholder2})`);

await box.fill('second question');
await box.press('Enter');
await page.waitForTimeout(1200);
check('both runs are in flight at once', peak === 2, `(peak ${peak}, asked ${asked.length})`);

await page.waitForTimeout(5500);
const body = await page.locator('body').innerText();
check('session 2 got its own answer', body.includes('ANSWER-FOR[second question]'));
check('session 2 does not show session 1\'s answer', !body.includes('ANSWER-FOR[first question]'));

// back to session 1: its answer is there
const first = page.getByText('first question').first();
await first.click({ timeout: 5000 }).catch(() => {});
await page.waitForTimeout(800);
const body1 = await page.locator('body').innerText();
check('session 1 got its own answer', body1.includes('ANSWER-FOR[first question]'));
check('session 1 does not show session 2\'s answer', !body1.includes('ANSWER-FOR[second question]'));

// two messages in the same session still go one after the other
await box.fill('third question'); await box.press('Enter');
await page.waitForTimeout(500);
await box.fill('fourth question'); await box.press('Enter');
await page.waitForTimeout(1500);
check('a second message in a busy session waits', asked.includes('third question') && !asked.includes('fourth question'), `(asked ${asked.length})`);
await page.waitForTimeout(8500);
check('...and starts when the first one ends', asked.includes('fourth question'));
const body2 = await page.locator('body').innerText();
check('...and both are answered', body2.includes('ANSWER-FOR[third question]') && body2.includes('ANSWER-FOR[fourth question]'));

await browser.close();
server.close();
process.exit(results.every(Boolean) ? 0 : 1);
