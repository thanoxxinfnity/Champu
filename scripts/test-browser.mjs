/** node --experimental-strip-types --test scripts/test-browser.mjs — the bridge's browser (Playwright MCP) and when the app reaches for it. */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createBrowser, explainBrowserError, parseBrowse, shape, PLAYWRIGHT_MCP } from '../agent/browser.mjs';
import { wantsBrowse, classifyLocal } from '../src/lib/agent/router.ts';
import { BUILTIN_SKILLS } from '../src/lib/skills/registry.ts';

test('words on the command line become one browser tool call', () => {
  assert.deepEqual(parseBrowse(['open', 'example.com']), { tool: 'browser_navigate', args: { url: 'https://example.com' } });
  assert.deepEqual(parseBrowse(['open', 'http://127.0.0.1:3000/x']), { tool: 'browser_navigate', args: { url: 'http://127.0.0.1:3000/x' } });
  assert.equal(parseBrowse(['search', 'chai', 'recipe']).args.url, 'https://duckduckgo.com/html/?q=chai%20recipe');
  assert.deepEqual(parseBrowse(['click', 'e12', 'Add', 'to', 'cart']), { tool: 'browser_click', args: { target: 'e12', element: 'Add to cart' } });
  assert.deepEqual(parseBrowse(['type', 'e5', 'chai', 'masala', '--submit']), { tool: 'browser_type', args: { target: 'e5', element: 'e5', text: 'chai masala', submit: true } });
  assert.deepEqual(parseBrowse(['wait', '3']), { tool: 'browser_wait_for', args: { time: 3 } });
  assert.deepEqual(parseBrowse(['wait', 'Order', 'placed']), { tool: 'browser_wait_for', args: { text: 'Order placed' } });
  assert.deepEqual(parseBrowse(['shot', '--full']), { tool: 'browser_take_screenshot', args: { fullPage: true } });
  assert.deepEqual(parseBrowse(['browser_navigate', '{"url":"https://a.b"}']), { tool: 'browser_navigate', args: { url: 'https://a.b' } });
});

test('a wrong command says what to type instead', () => {
  assert.match(parseBrowse(['click']).error, /usage: browse click/);
  assert.match(parseBrowse(['fly']).error, /unknown browse command/);
  assert.match(parseBrowse(['browser_navigate', 'not json']).error, /JSON/);
  assert.equal(parseBrowse([]).local, 'help');
  assert.equal(parseBrowse(['tools']).local, 'tools');
});

test('the page snapshot Playwright wrote to a file is read back in, and a screenshot becomes a download', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'br-'));
  writeFileSync(path.join(dir, 'page.yml'), '- button "Order" [ref=e5]\n');
  const out = await shape({ content: [{ type: 'text', text: '### Ran Playwright code\n```js\nawait page.goto("x");\n```\n### Page\n- Page URL: https://x.test/\n### Snapshot\n- [Snapshot](page.yml)' }] }, dir);
  assert.equal(out.ok, true);
  assert.match(out.text, /button "Order" \[ref=e5\]/);
  assert.doesNotMatch(out.text, /Ran Playwright code/);
  assert.equal(existsSync(path.join(dir, 'page.yml')), false);
  const shot = await shape({ content: [{ type: 'text', text: '- [Screenshot of viewport](page-1.png)' }] }, dir);
  assert.match(shot.text, /\/v1\/artifact\/page-1\.png/);
  assert.equal((await shape({ isError: true, content: [{ type: 'text', text: '### Error\nboom' }] }, dir)).ok, false);
});

test('an MCP server over stdio is started once, kept, and called in order', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'br-'));
  const fake = path.join(dir, 'fake-mcp.mjs');
  writeFileSync(fake, `
    let n = 0;
    process.stdin.setEncoding('utf8'); let buf = '';
    process.stdin.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (!l.trim()) continue; const m = JSON.parse(l);
      if (m.id == null) continue;
      if (m.method === 'initialize') send(m.id, { protocolVersion: '2025-06-18', serverInfo: { name: 'fake' }, capabilities: {} });
      else if (m.method === 'tools/list') send(m.id, { tools: [{ name: 'browser_navigate', description: 'Go' }] });
      else send(m.id, { content: [{ type: 'text', text: 'call ' + (++n) + ' ' + m.params.name + ' ' + JSON.stringify(m.params.arguments) }] }); } });
    function send(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n'); }
  `);
  const b = createBrowser({ outDir: dir, spawnSpec: { command: process.execPath, args: [fake] } });
  try {
    const [a, c] = await Promise.all([b.call('browser_navigate', { url: 'u' }), b.call('browser_snapshot', {})]);
    assert.match(a.text, /call 1 browser_navigate \{"url":"u"\}/);
    assert.match(c.text, /call 2 browser_snapshot/);
    assert.equal((await b.tools())[0].name, 'browser_navigate');
  } finally { b.close(); }
});

test('a missing browser is explained with the command that fixes it', () => {
  assert.match(explainBrowserError("browserType.launch: Executable doesn't exist at /x/chrome"), /playwright@latest install chromium/);
  assert.match(explainBrowserError('could not start npx: spawn npx ENOENT'), /Node/);
  assert.match(PLAYWRIGHT_MCP, /^@playwright\/mcp@\d+\.\d+\.\d+$/);
});

test('the bridge hands its own address to the commands it runs, and has the route', () => {
  const src = readFileSync(new URL('../agent/chomugiri-agent.mjs', import.meta.url), 'utf8');
  assert.match(src, /CHOMUGIRI_BRIDGE_URL/);
  assert.match(src, /CHOMUGIRI_AGENT: fileURLToPath/);
  assert.match(src, /routes\['POST \/v1\/browser'\]/);
});

test('asking to look at, use or search the web goes to the browser; building a site or a plain question does not', () => {
  for (const t of [
    'https://news.ycombinator.com ko kholo aur top 5 stories batao', 'amazon pe iphone 15 ka price check karo', 'is website ko dekho https://example.com',
    'playwright se login karke dekho', 'web search karo best chai brands', 'search the web for latest node lts', 'open the website and take a screenshot',
    'flipkart kholo aur laptop dhundo', 'automate the browser to fill the form',
  ]) assert.equal(wantsBrowse(t), true, t);
  for (const t of [
    'make me a landing page for chai', 'build a website for my cafe', 'what is playwright?', 'download godot on terminal', 'fix my android app crash',
    'create a portfolio website with three.js', 'explain how browsers render a page', 'install node on terminal', 'ok bro',
  ]) assert.equal(wantsBrowse(t), false, t);
});

test('a browsing request is work for the terminal, and the /browse command is one too', () => {
  const c = classifyLocal('amazon pe iphone 15 ka price check karo');
  assert.equal(c.lane, 'B'); assert.equal(c.ops, true); assert.equal(c.browse, true);
  const cmd = BUILTIN_SKILLS.find((s) => s.command === 'browse');
  assert.ok(cmd);
  assert.equal(classifyLocal(cmd.template.replace('{{input}}', 'download the godot changelog')).browse, true);
  // a short reply carries a browsing job on
  assert.equal(classifyLocal('ha', { previousLane: 'B', previousOps: true, previousBrowse: true }).browse, true);
});
