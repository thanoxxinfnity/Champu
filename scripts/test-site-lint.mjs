/** node --experimental-strip-types --test scripts/test-site-lint.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { repairHiddenAttribute, repairSite } from '../src/lib/suites/site/lint.ts';

// The exact shape Kimi K3 produced: a fallback card hidden by attribute, styled
// with a display rule that defeats it.
const page = `<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head>
<body><canvas id="scene"></canvas>
<div id="fallback" hidden><div class="card"><h1>No WebGL</h1></div></div>
<script type="module" src="app.js"></script></body></html>`;
const css = '#fallback { position: fixed; inset: 0; z-index: 5; display: flex; background: #246; }\n';
const js = "document.getElementById('fallback').hidden = false;";

test('a hidden card styled with display:flex is forced to stay hidden', () => {
  const fixes = repairHiddenAttribute([
    { path: 'index.html', content: page },
    { path: 'styles.css', content: css },
    { path: 'app.js', content: js },
  ]);
  assert.equal(fixes.length, 1);
  assert.equal(fixes[0].path, 'styles.css');
  assert.ok(fixes[0].content.startsWith(css.trimEnd()), 'the original rules are kept intact');
  assert.match(fixes[0].content, /\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);
  assert.match(fixes[0].reason, /`hidden`/);
});

test('a site that already handles it is left alone', () => {
  const ok = `${css}[hidden] { display: none !important; }\n`;
  assert.deepEqual(
    repairHiddenAttribute([{ path: 'index.html', content: page }, { path: 'styles.css', content: ok }]),
    [],
  );
  const inline = page.replace('</head>', '<style>[hidden]{display:none!important}</style></head>');
  assert.deepEqual(repairHiddenAttribute([{ path: 'index.html', content: inline }, { path: 'styles.css', content: css }]), []);
});

test('a plain [hidden] rule without !important does not count — an id rule still beats it', () => {
  const weak = `${css}[hidden] { display: none; }\n`;
  assert.equal(repairHiddenAttribute([{ path: 'index.html', content: page }, { path: 'styles.css', content: weak }]).length, 1);
});

test('a site that never uses hidden is not touched', () => {
  assert.deepEqual(
    repairHiddenAttribute([{ path: 'index.html', content: '<body><p>hi</p></body>' }, { path: 'styles.css', content: 'p{color:red}' }]),
    [],
  );
});

test('hidden used only from script still gets the rule', () => {
  const fixes = repairHiddenAttribute([
    { path: 'index.html', content: '<head><link rel="stylesheet" href="s.css"></head><body><div id="x"></div></body>' },
    { path: 's.css', content: '#x{display:grid}' },
    { path: 'app.js', content: "document.getElementById('x').hidden = true" },
  ]);
  assert.equal(fixes[0]?.path, 's.css');
});

test('with no linked stylesheet the rule goes into the page itself', () => {
  const inline = '<html><head><style>#f{display:flex}</style></head><body><div id="f" hidden></div></body></html>';
  const [fix] = repairHiddenAttribute([{ path: 'index.html', content: inline }]);
  assert.equal(fix.path, 'index.html');
  assert.match(fix.content, /#f\{display:flex\}[\s\S]*\[hidden\] \{ display: none !important; \}[\s\S]*<\/style>/);

  const bare = '<html><head></head><body><div hidden></div></body></html>';
  const [added] = repairHiddenAttribute([{ path: 'index.html', content: bare }]);
  assert.match(added.content, /<style>\[hidden\] \{ display: none !important; \}<\/style>\s*<\/head>/);
});

test('a stylesheet in a subfolder is found relative to the page', () => {
  const [fix] = repairHiddenAttribute([
    { path: 'site/index.html', content: '<head><link rel="stylesheet" href="css/main.css"></head><body><i hidden></i></body>' },
    { path: 'site/css/main.css', content: 'i{display:block}' },
  ]);
  assert.equal(fix.path, 'site/css/main.css');
});

test('a CDN stylesheet is never edited', () => {
  const [fix] = repairHiddenAttribute([
    { path: 'index.html', content: '<head><link rel="stylesheet" href="https://cdn.example.com/x.css"></head><body><i hidden></i></body>' },
  ]);
  assert.equal(fix.path, 'index.html');
});

test('repairSite runs every repair and returns nothing for a clean site', () => {
  assert.equal(repairSite([{ path: 'index.html', content: page }, { path: 'styles.css', content: css }]).length, 1);
  assert.deepEqual(repairSite([{ path: 'index.html', content: '<p>ok</p>' }]), []);
  assert.deepEqual(repairSite([{ path: 'app.py', content: 'print(1)' }]), []);
});
