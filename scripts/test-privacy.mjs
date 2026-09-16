/**
 * Does the privacy policy match the code?
 *
 * node --experimental-strip-types --test scripts/test-privacy.mjs
 *
 * A privacy policy is a set of claims about a program, and a claim nobody
 * checks drifts from true to false the first time anyone adds a feature. This
 * file checks them the same way any other assertion is checked.
 *
 * Every case below is a sentence that was on the published page and was not
 * true: the app was said to keep keys in "the system's encrypted preferences"
 * when it uses plain MODE_PRIVATE SharedPreferences; it was said to ask for a
 * storage permission it does not declare; it was said to add no middleman when
 * the web build routes every message through a gateway; and the whole search
 * stack — which sends the user's query to six different companies — was not
 * mentioned at all.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const POLICY = readFileSync(new URL('../site/privacy.html', import.meta.url), 'utf8');
const SITE = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
const MANIFEST = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
const PORTS = readFileSync(new URL('../android/app/src/main/java/com/chomugiri/workspace/server/Ports.kt', import.meta.url), 'utf8');
const SEARCH = readFileSync(new URL('../src/lib/search/index.ts', import.meta.url), 'utf8');

test('every permission the app asks for is on the page, and no others', () => {
  const declared = [...MANIFEST.matchAll(/android:name="android\.permission\.([A-Z_]+)"/g)].map((m) => m[1]);
  assert.ok(declared.length > 0, 'the manifest was not read');
  for (const permission of declared) {
    assert.ok(POLICY.includes(permission), `the app asks for ${permission} and the policy does not say so`);
  }
  // And the reverse: a policy that lists a permission the app does not have is
  // asking the reader to distrust the rest of the list. STORAGE was on the
  // page for a week and has never been in the manifest.
  for (const invented of ['WRITE_EXTERNAL_STORAGE', 'READ_EXTERNAL_STORAGE', 'CAMERA', 'RECORD_AUDIO', 'ACCESS_FINE_LOCATION', 'READ_CONTACTS']) {
    if (declared.includes(invented)) continue;
    assert.ok(!POLICY.includes(invented), `the policy mentions ${invented}, which the app does not request`);
  }
});

test('the keys claim matches how the keys are actually stored', () => {
  // The Android store is a plain private SharedPreferences file. That is a real
  // protection — no other app can read it — but it is not the hardware keystore
  // and the page must not imply that it is.
  assert.match(PORTS, /getSharedPreferences\("chomugiri-secrets", Context\.MODE_PRIVATE\)/);
  assert.ok(POLICY.includes('chomugiri-secrets'), 'the page should name the file it is describing');
  assert.ok(POLICY.includes('MODE_PRIVATE'));

  const usesEncryptedPrefs = /EncryptedSharedPreferences|MasterKey/.test(PORTS);
  if (!usesEncryptedPrefs) {
    assert.ok(
      /does not add an encryption layer of its own/.test(POLICY),
      'the app does not encrypt the keys itself, and the page has to say so',
    );
    // "encrypted device storage" was the phrase on the landing page, and it is
    // exactly the impression this test exists to prevent.
    assert.ok(!/encrypted device storage/.test(SITE), 'the landing page promises encryption the app does not do');
    assert.ok(!/encrypted preferences/i.test(POLICY));
  }
});

test('every search engine a query can reach is named', () => {
  // Sending a search query tells a company what you are working on. Six of them
  // were reachable and none was on the page.
  const hosts = [...SEARCH.matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})/g)].map((m) => m[1]);
  const named = { 'api.search.brave.com': 'Brave', 'api.tavily.com': 'Tavily', 'google.serper.dev': 'Serper', 'en.wikipedia.org': 'Wikipedia', 'html.duckduckgo.com': 'DuckDuckGo', 'www.bing.com': 'Bing' };
  for (const host of new Set(hosts)) {
    const label = named[host];
    assert.ok(label, `${host} is searched and this test does not know its name — add it`);
    assert.ok(POLICY.includes(label), `a query can reach ${label} and the policy does not mention it`);
  }
});

test('the gateway is admitted rather than denied', () => {
  // /api/chat exists and forwards every message. The page used to say "we do
  // not add a middleman", which is true of the APK and false of the web build.
  assert.ok(!/do not add a middleman/.test(POLICY));
  assert.ok(/\/api\/chat/.test(POLICY), 'the web gateway is not named');
  assert.ok(/loopback/.test(POLICY), 'the page should say why the Android app is different');
});

test('the asset and deploy hosts are on the page', () => {
  for (const service of ['Poly Haven', 'Sketchfab', 'Vercel', 'Meshy', 'Tripo', 'Pollinations', 'NVIDIA']) {
    assert.ok(POLICY.includes(service), `${service} is contacted and unmentioned`);
  }
});

test('it does not promise anything about other companies', () => {
  // "No training on your prompts or your code", flat, reads as a guarantee
  // covering the providers. It cannot be one.
  const flat = /No training on your prompts or your code\./.test(POLICY);
  assert.ok(!flat, 'that sentence promises something only the provider can promise');
  assert.ok(/their decision, not ours/.test(POLICY));
});

test('the page points somewhere a reader can actually complain', () => {
  assert.match(POLICY, /github\.com\/thanoxxinfnity\/Champu\/issues/);
});

test('the download is described at the size it actually is', () => {
  // The page said 39 MB for a 33 MB file and "tap to fire" for a build with a
  // fire button. Small wrongnesses are what make a reader doubt the big claims.
  assert.ok(!/39 MB/.test(SITE));
  assert.ok(!/tap to fire/.test(SITE));
  assert.ok(!/signed with a debug key/.test(SITE), 'it is signed with the release key now');
  assert.match(SITE, /FIRE<\/strong>/);
});

test('the privacy page names Blob, now that builds go there', () => {
  // A host that receives the artifacts and is not on the page is exactly the
  // omission this file exists to catch.
  const SITE_NOW = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
  if (!/blob\.vercel-storage\.com/.test(SITE_NOW)) return;
  assert.match(POLICY, /Blob/, 'builds are served from Vercel Blob and the policy does not say so');
});

test('the upload route cannot be used by whoever finds it', () => {
  // An open upload endpoint on a public domain is a free file host for
  // everyone who finds it.
  const route = readFileSync(new URL('../site/api/blob-upload.js', import.meta.url), 'utf8');
  assert.match(route, /process\.env\.UPLOAD_SECRET/);
  assert.match(route, /clientPayload !== secret/);
  // Narrow: one prefix, and only the types a build produces.
  assert.match(route, /pathname\.startsWith\('builds\/'\)/);
  assert.match(route, /allowedContentTypes/);
  // And it refuses rather than 500s when the deployment has no secret.
  assert.match(route, /503/);
  // The secret itself is never in the repository.
  assert.ok(!/UPLOAD_SECRET\s*=\s*['"][A-Za-z0-9_-]{10}/.test(route));
});
