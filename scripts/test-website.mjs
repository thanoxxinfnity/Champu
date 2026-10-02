/**
 * Does the website say true things and fetch only what it claims to?
 *
 * node --experimental-strip-types --test scripts/test-website.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SITE_DIR = join(ROOT, 'site');
const read = (p) => readFileSync(join(SITE_DIR, p), 'utf8');
const HTML = read('index.html');
const POLICY = read('privacy.html');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const own = (...dirs) => dirs.flatMap((d) => walk(join(SITE_DIR, d))).filter((f) => /\.(js|css|html)$/.test(f) && !f.includes('/vendor/'));

test('the download buttons point at the files the release workflows publish', () => {
  const wf = (name) => readFileSync(join(ROOT, '.github/workflows', name), 'utf8');
  const cases = [
    ['chomugiri-apk-release.yml', 'dl-chomugiri-btn'],
    ['chomu-horizon-apk.yml', 'dl-horizon-btn'],
  ];
  for (const [file, id] of cases) {
    const text = wf(file);
    const tag = /tag_name:\s*(\S+)/.exec(text)?.[1];
    const asset = /files:\s*\S*?([A-Za-z0-9_.-]+\.apk)\s*$/m.exec(text)?.[1];
    assert.ok(tag && asset, `${file}: could not read the release tag and asset`);
    const href = new RegExp(`id="${id}"[^>]*href="([^"]+)"`).exec(HTML)?.[1];
    assert.equal(href, `https://github.com/thanoxxinfnity/Champu/releases/download/${tag}/${asset}`, `${id} does not match what ${file} publishes`);
    assert.ok(HTML.includes(`https://github.com/thanoxxinfnity/Champu/releases/tag/${tag}`), `the release page for ${tag} is not linked`);
  }
});

test('each download sits inside the section that describes the product', () => {
  const section = (id) => new RegExp(`<section id="${id}"[\\s\\S]*?</section>`).exec(HTML)?.[0] ?? '';
  assert.match(section('chomugiri'), /dl-chomugiri-btn/);
  assert.doesNotMatch(section('chomugiri'), /dl-horizon-btn/);
  assert.match(section('horizon'), /dl-horizon-btn/);
  assert.doesNotMatch(section('horizon'), /dl-chomugiri-btn/);
});

test('only Chomugiri and Chomu Horizon are on the site', () => {
  for (const f of [join(SITE_DIR, 'index.html'), ...own('js', 'css')]) {
    assert.ok(!/chomu[\s-]?dead|ChomuDead|ChomuCity|ChomuGame/i.test(readFileSync(f, 'utf8')), `${f} mentions a product that is not on the site`);
  }
});

test('the page loads nothing from anyone else', () => {
  // No <script src>, <link href>, @import, or import() of an absolute URL — fonts, 3D library and logos are all self-hosted.
  assert.ok(!/<(script|link|img|audio|source)[^>]+(src|href)="https?:/i.test(HTML.replace(/<a [^>]*>/g, '')), 'a subresource is fetched from another origin');
  for (const f of own('js', 'css')) {
    const text = readFileSync(f, 'utf8');
    assert.ok(!/@import\s+url\(\s*['"]?https?:/.test(text), `${f} imports a stylesheet from another origin`);
    assert.ok(!/from\s+['"]https?:/.test(text), `${f} imports a module from another origin`);
    assert.ok(!/fetch\(\s*['"`]https?:/.test(text), `${f} calls another origin directly — NASA goes through /api/nasa`);
    assert.ok(!/api\.nasa\.gov|api_key/.test(text), `${f} knows about NASA's key-bearing API`);
  }
});

test('the NASA key is nowhere on the site', () => {
  for (const f of [...own('js', 'css'), join(SITE_DIR, 'index.html'), join(SITE_DIR, 'deploy.sh')]) {
    assert.ok(!/NASA_API_KEY\s*=\s*['"]?[A-Za-z0-9]{20,}/.test(readFileSync(f, 'utf8')), `${f} contains a key`);
  }
  assert.ok(!/NASA_API_KEY/.test(HTML), 'the page itself should not even name the variable');
});

test('every local file the page points to exists', () => {
  const refs = new Set();
  for (const m of HTML.matchAll(/(?:src|href)="(\/[^"#?]+)"/g)) refs.add(m[1]);
  for (const f of own('js', 'css')) for (const m of readFileSync(f, 'utf8').matchAll(/['"(](\/(?:textures|img|fonts|vendor|data|voice)\/[^'"?)$`]+\.[a-z0-9]+)/gi)) refs.add(m[1]);
  for (const ref of refs) {
    if (ref === '/privacy' || ref.startsWith('/voice/')) continue; // clean URL; voices are staged from public/voice
    assert.ok(existsSync(join(SITE_DIR, ref)), `${ref} is referenced but missing`);
  }
  for (const v of ['narration', 'voice_a', 'voice_b']) assert.ok(existsSync(join(ROOT, 'public/voice', `${v}.wav`)), `${v}.wav is not in public/voice, so deploy.sh cannot stage it`);
});

test('every #anchor on the page has somewhere to land', () => {
  const ids = new Set([...HTML.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const m of HTML.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.has(m[1]), `#${m[1]} does not exist`);
});

test('the Content-Security-Policy matches the page’s inline scripts', () => {
  // Inline scripts are allowed by hash. Edit one and forget the hash and the page goes blank in production.
  const csp = JSON.parse(read('vercel.json')).headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy').value;
  const inline = [...HTML.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => `sha256-${createHash('sha256').update(m[1]).digest('base64')}`);
  assert.ok(inline.length >= 2);
  for (const h of inline) assert.ok(csp.includes(`'${h}'`), `CSP is missing '${h}' for an inline script — update site/vercel.json`);
  assert.ok(!/unsafe-eval|script-src[^;]*unsafe-inline/.test(csp));
  assert.match(csp, /connect-src 'self'(;|$)/, 'the page may only talk to itself — NASA goes through /api/nasa');
});

test('the transcripts are the Godot licence, timed in order, for all three voices', () => {
  const t = JSON.parse(read('data/transcripts.json'));
  assert.deepEqual(Object.keys(t.tracks).sort(), ['narration', 'voice_a', 'voice_b']);
  for (const [name, track] of Object.entries(t.tracks)) {
    assert.ok(track.lines.length >= 6, `${name} has too few lines`);
    let last = -1;
    for (const l of track.lines) { assert.ok(l.t > last, `${name}: timings must increase`); last = l.t; assert.ok(l.text.length > 10); }
    assert.ok(last < track.duration, `${name}: last line starts after the recording ends`);
    const all = track.lines.map((l) => l.text).join(' ');
    assert.match(all, /Godot Engine/);
    assert.match(all, /Permission is hereby granted, free of charge/);
    assert.match(all, /THE SOFTWARE IS PROVIDED "AS IS"/);
  }
  assert.match(HTML, /Godot Engine/);
  // The Godot section is the one that says so, and it holds the voices.
  const godot = /<section id="godot"[\s\S]*?<\/section>/.exec(HTML)[0];
  assert.match(godot, /id="voices"/);
});

test('the solar system names its sources and says what is not real', () => {
  const space = /<section id="space"[\s\S]*?<\/section>/.exec(HTML)[0];
  for (const needle of ['Standish', 'Solar System Scope', 'CC BY 4.0', 'LROC', 'NeoWs', 'EPIC', 'Astronomy Picture of the Day', 'Horizons', 'drawn by us', 'enlarged']) {
    assert.ok(space.includes(needle), `the space section does not mention “${needle}”`);
  }
  assert.ok(/not made or endorsed by NASA/.test(space));
});

test('the privacy policy covers what this site does', () => {
  for (const needle of ['/api/nasa', 'api.nasa.gov', 'ssd.jpl.nasa.gov', 'epic.gsfc.nasa.gov', 'science.nasa.gov', 'local storage', 'GitHub']) {
    assert.ok(POLICY.includes(needle), `the policy does not mention ${needle}`);
  }
  // And the page really does only store the theme.
  const main = read('js/main.js');
  const keys = [...main.matchAll(/localStorage\.(?:set|get)Item\('([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(keys)], ['theme']);
  assert.ok(!/document\.cookie|sessionStorage|indexedDB/.test(main + read('js/space.js') + read('js/nasa-cards.js') + read('js/demo.js')));
});

test('the typed demo respects reduced motion', () => {
  assert.match(read('js/type.js'), /prefers-reduced-motion: reduce/);
  assert.match(read('css/site.css'), /prefers-reduced-motion: reduce/);
});

test('deploy.sh ships every directory the page needs', () => {
  const sh = read('deploy.sh');
  for (const dir of ['css', 'js', 'vendor', 'img', 'textures', 'fonts', 'data']) {
    assert.ok(sh.includes(dir), `deploy.sh does not copy ${dir}`);
    assert.ok(existsSync(join(SITE_DIR, dir)), `site/${dir} does not exist`);
  }
  assert.ok(/api/.test(sh) && /public\/voice/.test(sh));
});

test('the version on the download button is the version in the Android project', () => {
  const gradle = readFileSync(join(ROOT, 'android/app/build.gradle.kts'), 'utf8');
  const version = /versionName\s*=\s*"([^"]+)"/.exec(gradle)[1];
  const info = JSON.parse(read('data/release.json'));
  assert.equal(info.chomugiri.version, version, 'site/data/release.json is stale — run node scripts/release-info.mjs');
  assert.ok(info.chomugiri.mb > 5 && info.horizon.mb > 20);
  assert.match(read('deploy.sh'), /release-info\.mjs/);
});
