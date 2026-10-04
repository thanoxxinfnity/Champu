/**
 * Media screens in a real browser: node scripts/e2e-media.mjs [baseUrl]   (app running, e.g. `PORT=3100 npm start`)
 * Providers are faked. Checks: tabs appear only with a provider, Library + 50x zoom, Video timeline, Audio waveform,
 * 3D viewer, hiding a tab from Settings, and the tabs going away when the provider is removed.
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3100';
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); };

// a 0.5s 440Hz WAV, and a one-triangle GLB, so audio and 3D really decode
const wav = (() => { const n = 4000, b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 8) * 12000 * (1 - i / n)), 44 + i * 2); return b; })();
const glb = (() => {
  const pos = Buffer.alloc(36); [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((v, i) => pos.writeFloatLE(v, i * 4));
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }], bufferViews: [{ buffer: 0, byteLength: 36 }], buffers: [{ byteLength: 36 }] }).padEnd(Math.ceil(300 / 4) * 4 + 400, ' '));
  const j = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const head = Buffer.alloc(12); head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + j.length + 8 + 36, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(j.length, 0); jh.write('JSON', 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(36, 0); bh.write('BIN\0', 4);
  return Buffer.concat([head, jh, j, bh, pos]);
})();

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 160)));
let videoPolls = 0;
await page.route('https://mock.media/**', async (route) => {
  const url = route.request().url(), method = route.request().method();
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  if (url.endsWith('/videos/generations') && method === 'POST') return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ id: 'job1', status: 'queued' }) });
  if (url.endsWith('/videos/generations/job1')) {
    videoPolls++;
    const done = videoPolls >= 2;
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(done ? { id: 'job1', status: 'completed', data: [{ b64_json: Buffer.from('not-a-real-video').toString('base64') }] } : { id: 'job1', status: 'in_progress' }) });
  }
  if (url.endsWith('/audio/speech')) return route.fulfill({ status: 200, headers: cors, contentType: 'audio/wav', body: wav });
  if (url.endsWith('/3d/generations')) return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ data: [{ b64_json: glb.toString('base64') }] }) });
  return route.fulfill({ status: 404, headers: cors, body: '{}' });
});

const sidebar = () => page.locator('aside').first();
const has = async (label) => (await sidebar().getByText(label, { exact: true }).count()) > 0;

await page.goto(BASE, { waitUntil: 'load' });
await page.locator('textarea').first().waitFor({ timeout: 20000 });
await page.waitForTimeout(1500); // the app creates its database on first load
check('no provider: no Video/Audio/3D tabs', !(await has('Video')) && !(await has('Audio')) && !(await has('3D')));
check('Library is first in the menu', (await sidebar().locator('nav button').first().innerText()).includes('Library'));

// give the app a provider and one image
await page.evaluate(async () => {
  const open = () => new Promise((res, rej) => { const r = indexedDB.open('chomugiri'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const db = await open();
  const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d');
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? '#ff9a3c' : '#2a1d12'; g.fillRect(x * 8, y * 8, 8, 8); }
  const put = (store, v) => new Promise((res, rej) => { const t = db.transaction(store, 'readwrite'); t.objectStore(store).put(v); t.oncomplete = res; t.onerror = () => rej(t.error); });
  await put('endpoints', { id: 'ep1', label: 'MockMedia', baseUrl: 'https://mock.media/v1', capabilities: ['chat', 'image', 'video', 'audio', 'model3d'], models: [
    { id: 'vid-1', label: 'vid-1', capabilities: ['video'] }, { id: 'tts-1', label: 'tts-1', capabilities: ['audio'] }, { id: 'tri-1', label: 'tri-1', capabilities: ['model3d'] }],
    routes: ['/videos/generations', '/audio/speech', '/3d/generations'], enabled: 1, createdAt: Date.now() });
  await put('assets', { id: 'a1', suite: 'image', kind: 'image', prompt: 'checkerboard', provider: 'x', model: 'x', dataUrl: c.toDataURL('image/png'), createdAt: Date.now() });
});
await page.reload({ waitUntil: 'load' });
await page.locator('textarea').first().waitFor();
await sidebar().getByText('Video', { exact: true }).waitFor({ timeout: 8000 }).catch(() => {});
check('with a provider: Video, Audio and 3D tabs appear', (await has('Video')) && (await has('Audio')) && (await has('3D')));

// Library + 50x zoom
await sidebar().getByText('Library', { exact: true }).click();
await page.getByRole('button', { name: /Open image/ }).first().click();
const level = page.getByTestId('zoom-level');
check('viewer opens at 1x', /^1\.0/.test(await level.innerText()));
await page.getByRole('button', { name: '50×' }).click();
check('zoom reaches 50x', (await level.innerText()).startsWith('50'), `(${await level.innerText()})`);
await page.getByRole('button', { name: 'fit' }).click();
await page.mouse.move(640, 400);
for (let i = 0; i < 40; i++) await page.mouse.wheel(0, -100);
check('mouse wheel zooms in and stops at 50x', (await level.innerText()).startsWith('50'), `(${await level.innerText()})`);
await page.keyboard.press('Escape');

// Video
await sidebar().getByText('Video', { exact: true }).click();
await page.getByPlaceholder(/Describe the next scene/).fill('a red car drifting at dusk');
await page.getByRole('button', { name: 'generate scene' }).click();
await page.getByText(/making…/).waitFor({ timeout: 8000 });
check('a scene shows as "making" while it is generated', true);
await page.getByRole('button', { name: 'Scene 1' }).waitFor({ timeout: 30000 });
check('the finished scene lands on the timeline', true);

// Audio
await sidebar().getByText('Audio', { exact: true }).click();
await page.getByPlaceholder('What should it say?').fill('hello from chomugiri');
await page.getByRole('button', { name: 'make audio' }).click();
await page.getByRole('button', { name: 'Waveform — click to seek' }).or(page.locator('canvas[aria-label^="Waveform"]')).first().waitFor({ timeout: 15000 });
check('audio track shows a waveform', (await page.locator('[data-testid=audio-studio] li').count()) === 1);

// 3D
await sidebar().getByText('3D', { exact: true }).click();
await page.getByPlaceholder('A low-poly red sports car').fill('a triangle');
await page.getByRole('button', { name: 'make model' }).click();
await page.locator('[data-testid=model-viewport] canvas').waitFor({ timeout: 20000 });
check('3D model opens in the viewer', (await page.locator('[data-testid=model3d] [role=alert]').count()) === 0, (await page.locator('[data-testid=model3d] [role=alert]').allInnerTexts()).join(' | '));

// Settings -> Media: hide Video
await page.getByRole('button', { name: 'Settings' }).first().click().catch(async () => { await page.getByText('settings', { exact: true }).click(); });
await page.getByRole('button', { name: 'Media', exact: true }).click();
await page.locator('li').filter({ hasText: 'Video' }).getByRole('button', { name: /shown/ }).click();
await page.keyboard.press('Escape');
check('hiding Video in Settings removes only Video from the menu', !(await has('Video')) && (await has('Audio')) && (await has('3D')));

// remove the provider -> the tabs go away
await page.evaluate(async () => {
  const db = await new Promise((res) => { const r = indexedDB.open('chomugiri'); r.onsuccess = () => res(r.result); });
  await new Promise((res) => { const t = db.transaction('endpoints', 'readwrite'); t.objectStore('endpoints').delete('ep1'); t.oncomplete = res; });
});
await page.reload({ waitUntil: 'load' });
await page.locator('textarea').first().waitFor();
check('provider removed: the media tabs are gone, Library stays', !(await has('Video')) && !(await has('Audio')) && !(await has('3D')) && (await has('Library')));

await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
