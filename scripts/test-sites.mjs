/** node --experimental-strip-types --test scripts/test-sites.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chipifyHtml, faviconUrl, findSites, hostOf, uniqueDomains } from '../src/lib/sites/domains.ts';

const SCREENSHOT = 'claude.com infinityfree.com zing.com nvidia.com youtube.com x.com GoDaddy.com hostinger.com minecraft.com mojang.com google.com microsoft.com vercel.com v0.dev';

test('every website in the reference screenshot is found, in order, once each', () => {
  const domains = uniqueDomains(SCREENSHOT, 20);
  assert.deepEqual(domains, [
    'claude.com', 'infinityfree.com', 'zing.com', 'nvidia.com', 'youtube.com', 'x.com', 'godaddy.com',
    'hostinger.com', 'minecraft.com', 'mojang.com', 'google.com', 'microsoft.com', 'vercel.com', 'v0.dev',
  ]);
});

test('urls, www and paths resolve to the bare host', () => {
  assert.equal(hostOf('https://www.GitHub.com:443/godotengine/godot/releases?x=1#y'), 'github.com');
  const [s] = findSites('see https://github.com/godotengine/godot/releases for more');
  assert.equal(s.domain, 'github.com');
  assert.equal(s.label, 'github.com/godotengine/godot/releases');
  assert.equal(findSites('visit www.example.org.')[0].label, 'www.example.org', 'the full stop ending the sentence is not part of the address');
  assert.equal(findSites('bbc.co.uk is a site')[0].domain, 'bbc.co.uk');
});

test('file names, versions and emails are not websites', () => {
  for (const text of ['open main.py and README.md', 'edit index.html, app.js and project.godot', 'Godot 4.7.2 and v1.2.3', 'mail me at user@gmail.com', 'next.config.ts', 'scripts/test-sites.mjs', 'e.g. this', 'size 3.5 MB']) {
    assert.deepEqual(findSites(text), [], `should find nothing in: ${text}`);
  }
});

test('the logo comes from one lookup, with the domain safely encoded', () => {
  assert.equal(faviconUrl('claude.com'), 'https://www.google.com/s2/favicons?domain=claude.com&sz=64');
  assert.ok(!faviconUrl('a.com&evil=1').includes('&evil=1'));
});

test('a reply: bare names become chips, links get the logo, code is left alone', () => {
  const html = '<p>Use vercel.com or <a href="https://godotengine.org/download">the Godot site</a>.</p><pre><code>curl nvidia.com</code></pre><p>and <code>claude.com</code> inline</p>';
  const out = chipifyHtml(html);
  assert.match(out, /<a class="site-chip" href="https:\/\/vercel\.com"[^>]*><span class="site-chip-logo"><img src="https:\/\/www\.google\.com\/s2\/favicons\?domain=vercel\.com/);
  assert.match(out, /<a href="https:\/\/godotengine\.org\/download" class="site-chip"><span class="site-chip-logo"><img [^>]*domain=godotengine\.org/);
  assert.match(out, /<code>curl nvidia\.com<\/code>/, 'a code block stays code');
  assert.match(out, /<code>claude\.com<\/code>/, 'inline code stays code');
  assert.equal((out.match(/class="site-chip"/g) ?? []).length, 2);
});

test('chipifying twice does not stack chips, and text without a site is untouched', () => {
  const once = chipifyHtml('<p>go to claude.com now</p>');
  assert.equal(chipifyHtml(once), once);
  assert.equal(chipifyHtml('<p>no sites here, just 4.7.2</p>'), '<p>no sites here, just 4.7.2</p>');
});

test('an address with an ampersand is not escaped twice', () => {
  const out = chipifyHtml('<p>https://example.com/a?x=1&amp;y=2</p>');
  assert.match(out, /example\.com\/a\?x=1&amp;y=2/);
  assert.doesNotMatch(out, /&amp;amp;/);
});
