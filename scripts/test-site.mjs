/** node --experimental-strip-types --test scripts/test-site.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { bundleSite, previewCaveats, resolveLocal, siteEntry, usesThree } from '../src/lib/suites/web/site.ts';

const site = [
  { path: 'index.html', content: '<html><head><link rel="stylesheet" href="styles.css"></head><body><script type="module" src="app.js"></script></body></html>' },
  { path: 'styles.css', content: 'body{margin:0}' },
  { path: 'app.js', content: "import * as THREE from 'three';\nconsole.log(THREE);" },
];

test('the entry document is the root index, not just any html', () => {
  assert.equal(siteEntry(site)?.path, 'index.html');
  assert.equal(
    siteEntry([{ path: 'docs/about.html', content: '' }, { path: 'index.html', content: '' }])?.path,
    'index.html',
  );
  assert.equal(siteEntry([{ path: 'app.js', content: '' }]), null);
});

test('local css and js are inlined so an iframe can run the site with no server', () => {
  const html = bundleSite(site);
  assert.ok(html.includes('body{margin:0}'), 'stylesheet inlined');
  assert.ok(html.includes("import * as THREE from 'three'"), 'module inlined');
  assert.ok(!html.includes('src="app.js"'), 'the unresolvable src is gone');
  assert.ok(html.includes('type="module"'), 'a module stays a module, or its imports break');
});

test('remote references are left exactly as written', () => {
  const withCdn = [
    { path: 'index.html', content: '<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.185.0/build/three.module.js"}}</script><script src="https://cdn.jsdelivr.net/npm/x.js"></script>' },
  ];
  const html = bundleSite(withCdn);
  assert.ok(html.includes('cdn.jsdelivr.net/npm/three@0.185.0'), 'the importmap survives');
  assert.ok(html.includes('<script src="https://cdn.jsdelivr.net/npm/x.js"></script>'), 'the CDN script is untouched');
});

test('a closing script tag inside inlined code cannot end its own block', () => {
  const html = bundleSite([
    { path: 'index.html', content: '<script src="a.js"></script>' },
    { path: 'a.js', content: 'const s = "</script>";' },
  ]);
  // One closing tag, from our own wrapper — not two.
  assert.equal(html.match(/<\/script>/g).length, 1);
});

test('paths resolve the way a browser resolves them', () => {
  assert.equal(resolveLocal('index.html', './app.js'), 'app.js');
  assert.equal(resolveLocal('pages/about.html', '../styles.css'), 'styles.css');
  assert.equal(resolveLocal('index.html', '/assets/x.css'), 'assets/x.css');
  assert.equal(resolveLocal('index.html', 'app.js?v=2'), 'app.js');
  assert.equal(resolveLocal('index.html', 'https://cdn/x.js'), null);
  assert.equal(resolveLocal('index.html', '//cdn/x.js'), null);
  assert.equal(resolveLocal('index.html', '#top'), null);
});

test('three.js is recognised however it is imported', () => {
  assert.equal(usesThree(site), true);
  assert.equal(usesThree([{ path: 'a.js', content: 'const scene = new THREE.Scene()' }]), true);
  assert.equal(usesThree([{ path: 'a.js', content: 'console.log(1)' }]), false);
});

test('what the preview cannot do is stated, not discovered', () => {
  const caveats = previewCaveats(site, bundleSite(site));
  assert.equal(caveats.length, 0, 'a fully inlined site has nothing to warn about');

  const missing = [{ path: 'index.html', content: '<script src="missing.js"></script>' }];
  assert.match(previewCaveats(missing, bundleSite(missing)).join(' '), /Could not find missing\.js/);

  const cdn = [{ path: 'index.html', content: '<script src="https://cdn.jsdelivr.net/npm/three/build/three.min.js"></script>' }];
  assert.match(previewCaveats(cdn, bundleSite(cdn)).join(' '), /internet connection/);
});

// ── The contract the model is given, and when it is given it ────────────────

const { buildSystemPrompt } = await import('../src/lib/agent/system-prompt.ts');
const { wantsSite } = await import('../src/lib/agent/router.ts');

test('a website request gets the web contract, an unrelated one does not', () => {
  const site = buildSystemPrompt({ lane: 'B', buildingSite: true });
  assert.ok(site.includes('BUILDING A WEBSITE'));
  // The escaping has broken before; a literal backslash here would be shipped
  // to the model verbatim.
  assert.ok(site.includes('`index.html`'), 'backticks render, not \\`');
  assert.ok(!site.includes('\\`'), 'no escaped backticks leak into the prompt');
  assert.ok(site.includes('importmap'), 'the CDN import map is spelled out');

  assert.ok(!buildSystemPrompt({ lane: 'B' }).includes('BUILDING A WEBSITE'));
});

test('what counts as a website request', () => {
  assert.equal(wantsSite('build me a 3D landing page for a coffee brand'), true);
  assert.equal(wantsSite('make a portfolio website with three.js'), true);
  assert.equal(wantsSite('ek website bana do'), true);
  assert.equal(wantsSite('redesign my homepage'), true);
  // A question about the web is not a request to build one.
  assert.equal(wantsSite('why is my css grid overflowing?'), false);
  assert.equal(wantsSite('explain how webgl works'), false);
  assert.equal(wantsSite('build me a minecraft sword'), false);
});
