/** node --test scripts/test-nasa-api.mjs */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import handler from '../site/api/nasa.js';
import { parseHorizons, plan, trimApod, trimEpic, trimNeo, upstreamUrl } from '../site/api/_nasa-lib.js';

const SECRET = 'TEST-KEY-do-not-leak-0123456789abcdef0123';

function fakeResponse() {
  const r = { headers: {}, statusCode: 200, body: undefined };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const ask = (query, ip = '203.0.113.9') => {
  const res = fakeResponse();
  return handler({ method: 'GET', query, headers: { 'x-forwarded-for': ip } }, res).then(() => res);
};

test('only the four documented kinds are accepted', () => {
  for (const kind of ['apod', 'neo', 'epic']) assert.ok(plan({ kind }).upstream, kind);
  for (const bad of [undefined, '', 'donki', '../etc/passwd', 'apod&x=1', 'http://evil.example']) {
    assert.ok(plan({ kind: bad }).error, `should refuse kind=${bad}`);
  }
});

test('horizons accepts only known bodies and strict dates', () => {
  assert.ok(plan({ kind: 'horizons', body: 'mars', date: '2026-10-02' }).upstream);
  assert.ok(plan({ kind: 'horizons', body: 'moon', date: '2026-10-02' }).upstream.params.CENTER.includes('399'));
  for (const q of [
    { body: 'mars', date: '2026-10-02; DROP' }, { body: 'mars', date: '2026-13-45' }, { body: 'mars', date: '1700-01-01' },
    { body: "499'&COMMAND='10", date: '2026-10-02' }, { body: 'sun', date: '2026-10-02' }, { body: 'mars' },
  ]) assert.ok(plan({ kind: 'horizons', ...q }).error, `should refuse ${JSON.stringify(q)}`);
});

test('the key is added for api.nasa.gov and never for JPL', () => {
  const nasa = upstreamUrl(plan({ kind: 'neo' }).upstream, SECRET);
  assert.equal(nasa.host, 'api.nasa.gov');
  assert.equal(nasa.searchParams.get('api_key'), SECRET);
  const jpl = upstreamUrl(plan({ kind: 'horizons', body: 'earth', date: '2026-10-02' }).upstream, SECRET);
  assert.equal(jpl.host, 'ssd.jpl.nasa.gov');
  assert.ok(!jpl.href.includes(SECRET));
});

test('NeoWs is trimmed to a short, sorted list in lunar distances', () => {
  const out = trimNeo({ near_earth_objects: { '2026-10-03': [
    { id: '2', name: '(2026 AB)', absolute_magnitude_h: 22.1, is_potentially_hazardous_asteroid: true, nasa_jpl_url: 'http://ssd.jpl.nasa.gov/x',
      estimated_diameter: { meters: { estimated_diameter_min: 80.2, estimated_diameter_max: 179.4 } },
      close_approach_data: [{ close_approach_date_full: '2026-Oct-03 12:00', miss_distance: { kilometers: '768800.0' }, relative_velocity: { kilometers_per_second: '12.5' } }] },
    { id: '1', name: '(2026 AA)', close_approach_data: [{ close_approach_date_full: '2026-Oct-03 01:00', miss_distance: { kilometers: '384400' }, relative_velocity: { kilometers_per_second: '5' } }], estimated_diameter: { meters: {} } },
    { id: '3', name: 'no approach data', close_approach_data: [] },
  ] } });
  assert.deepEqual(out.map((o) => o.id), ['1', '2']);
  assert.equal(out[0].missLunar, 1);
  assert.equal(out[1].missLunar, 2);
  assert.equal(out[1].name, '2026 AB');
  assert.deepEqual(out[1].diameterM, [80, 179]);
});

test('EPIC frames become archive image URLs, and odd file names are dropped', () => {
  const out = trimEpic([
    { image: 'epic_1b_20260927', date: '2026-09-27 00:00:00', centroid_coordinates: { lat: 1, lon: 2 } },
    { image: 'epic_1b_20260928', date: '2026-09-28 00:55:15', caption: 'c', centroid_coordinates: { lat: 3, lon: 4 } },
    { image: '../../evil', date: '2026-09-28 00:00:00' },
  ], 2);
  assert.equal(out.length, 1);
  assert.equal(out[0].image, 'https://epic.gsfc.nasa.gov/archive/natural/2026/09/28/jpg/epic_1b_20260928.jpg');
});

test('APOD keeps only what the card shows; Horizons text parses to a vector', () => {
  const a = trimApod({ date: '2026-10-01', title: 'T', explanation: 'E', media_type: 'image', url: 'https://x/y.jpg', hdurl: 'https://x/z.jpg', copyright: ' A\nB ', extra: 'drop' });
  assert.deepEqual(Object.keys(a).sort(), ['copyright', 'date', 'explanation', 'hdurl', 'link', 'media', 'thumb', 'title', 'url']);
  assert.equal(a.copyright, 'A B');
  assert.equal(trimApod({}), null);
  const v = parseHorizons({ result: 'junk\n$$SOE\n2461315.5, A.D., 1.5, -2.5, 0.25, 0,0,0,\n$$EOE\n' });
  assert.deepEqual(v, { x: 1.5, y: -2.5, z: 0.25 });
  assert.equal(parseHorizons({ result: 'no data' }), null);
});

test('the handler sends the key upstream and never lets it into a response', async () => {
  process.env.NASA_API_KEY = SECRET;
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    return new Response(JSON.stringify({ date: '2026-10-01', title: 'A picture', explanation: 'Words', media_type: 'image', url: 'https://x/y.jpg' }), { status: 200 });
  };
  const ok = await ask({ kind: 'apod' }, '198.51.100.1');
  assert.equal(ok.statusCode, 200);
  assert.ok(seen[0].includes(`api_key=${SECRET}`), 'the key must reach NASA');
  assert.ok(!JSON.stringify(ok.body).includes(SECRET));
  assert.ok(!JSON.stringify(ok.headers).includes(SECRET));
  assert.match(ok.headers['cache-control'], /s-maxage=3600/);
});

test('when NASA is down the error is plain, and a good earlier answer is served instead if there is one', async () => {
  process.env.NASA_API_KEY = SECRET;
  globalThis.fetch = async () => new Response('Internal Service Error', { status: 500 });
  const down = await ask({ kind: 'epic' }, '198.51.100.2');
  assert.equal(down.statusCode, 502);
  assert.ok(!JSON.stringify(down.body).includes(SECRET));
  assert.equal(down.headers['cache-control'], 'no-store');

  globalThis.fetch = async () => new Response(JSON.stringify([{ image: 'epic_1b_20260928', date: '2026-09-28 00:55:15' }]), { status: 200 });
  assert.equal((await ask({ kind: 'epic' }, '198.51.100.3')).statusCode, 200);
  globalThis.fetch = async () => { throw new Error(`boom ${SECRET}`); };
  const stale = await ask({ kind: 'epic' }, '198.51.100.4');
  assert.equal(stale.statusCode, 200);
  assert.equal(stale.body.stale, true);
});

test('a thrown upstream error carrying the key does not leak either', async () => {
  process.env.NASA_API_KEY = SECRET;
  globalThis.fetch = async () => { throw new Error(`failed https://api.nasa.gov/?api_key=${SECRET}`); };
  const res = await ask({ kind: 'neo' }, '198.51.100.5');
  assert.equal(res.statusCode, 502);
  assert.ok(!JSON.stringify(res.body).includes(SECRET));
});

test('only GET is allowed, bad input is a 400, and a flood is a 429', async () => {
  const res = fakeResponse();
  await handler({ method: 'POST', query: {}, headers: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal((await ask({ kind: 'nope' }, '198.51.100.6')).statusCode, 400);
  globalThis.fetch = async () => new Response('{}', { status: 500 });
  let last;
  for (let i = 0; i < 62; i += 1) last = await ask({ kind: 'neo' }, '198.51.100.7');
  assert.equal(last.statusCode, 429);
});

test('the real NASA key is nowhere in the repository, and not in anything the browser receives', () => {
  const envPath = new URL('../.env.local', import.meta.url);
  if (!existsSync(envPath)) return; // CI has no .env.local
  const m = /^NASA_API_KEY=(\S+)/m.exec(readFileSync(envPath, 'utf8'));
  if (!m) return;
  const key = m[1];
  const root = new URL('..', import.meta.url).pathname;
  const tracked = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const file of tracked) {
    if (/\.(png|jpe?g|wav|apk|zip|glb|woff2?|webp|ico)$/i.test(file)) continue;
    let text;
    try { text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'); } catch { continue; }
    assert.ok(!text.includes(key), `the NASA key is written in ${file}`);
  }
});
