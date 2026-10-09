/** node --experimental-strip-types --test scripts/test-canvas.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DEVICES, collectTokens, exportEntries, extractHtml, nextSlot, newScreenPrompt, revisePrompt, slug, tokensCss } from '../src/lib/suites/canvas/board.ts';

const page = (vars, body = '<p>hi</p>') => `<!doctype html><html><head><style>:root{${vars}}</style></head><body><!-- Home -->${body}</body></html>`;
const screen = (id, name, device, vars, x = 0) => ({ id, name, device, html: page(vars), brief: 'b', x, y: 0 });

test('the document is pulled out of a fenced, chatty reply', () => {
  const html = page('--bg:#fff');
  assert.equal(extractHtml(`Sure! Here you go:\n\`\`\`html\n${html}\n\`\`\`\nHope it helps.`), html);
  assert.equal(extractHtml(`${html} trailing`), html);
  assert.equal(extractHtml('I could not do that.'), null);
  assert.equal(extractHtml('<html><head></head></html>'), null);
  assert.equal(extractHtml(`<|close|>${html}`), html);
});

test('a new screen is placed to the right of the others, without overlap', () => {
  assert.deepEqual(nextSlot([], 'phone'), { x: 0, y: 0 });
  const a = screen('1', 'Home', 'phone', '--bg:#fff');
  const slot = nextSlot([a], 'phone');
  assert.ok(slot.x >= DEVICES.phone.w);
  const b = { ...screen('2', 'Cart', 'desktop', '--bg:#fff'), x: slot.x };
  assert.ok(nextSlot([a, b], 'phone').x >= slot.x + DEVICES.desktop.w);
});

test('tokens are collected once across screens, first value wins', () => {
  const t = collectTokens([screen('1', 'A', 'phone', '--bg:#fff; --accent:#f60;'), screen('2', 'B', 'phone', '--accent:#00f; --ink:#111')]);
  assert.deepEqual(t.map((x) => x.name), ['--bg', '--accent', '--ink']);
  assert.equal(t.find((x) => x.name === '--accent').value, '#f60');
  assert.match(tokensCss([screen('1', 'A', 'phone', '--bg:#fff')]), /--bg: #fff;/);
});

test('file names are safe and never collide', () => {
  const taken = new Set();
  assert.equal(slug('Home / Menu!', taken), 'home-menu');
  assert.equal(slug('Home menu', taken), 'home-menu-2');
  assert.equal(slug('???', new Set()), 'screen');
});

test('the export is screens + overview + tokens + readme, and touches no project', () => {
  const board = { title: 'Chai app', screens: [screen('1', 'Home', 'phone', '--bg:#fff'), screen('2', 'Home', 'desktop', '--bg:#000', 500)] };
  const paths = exportEntries(board).map((e) => e.path);
  assert.deepEqual(paths, ['screens/home.html', 'screens/home-2.html', 'index.html', 'tokens.css', 'tokens.json', 'README.md']);
  const overview = exportEntries(board).find((e) => e.path === 'index.html').content;
  assert.match(overview, /src="screens\/home\.html"/);
  assert.match(exportEntries(board).find((e) => e.path === 'README.md').content, /your own app or website/);
});

test('the prompts carry the frame size and what is already on the board', () => {
  const a = screen('1', 'Home', 'phone', '--accent:#f60');
  const p = newScreenPrompt({ name: 'Cart', device: 'phone', brief: 'cart with total', siblings: [a] });
  assert.match(p, /390×844/);
  assert.match(p, /--accent:#f60/);
  assert.match(revisePrompt(a, 'darker header'), /darker header/);
});
