// Craft apps on the bridge: asset choice, checksum, redirect allow-list, install, CLI command, open. Uses a fake GitHub on 127.0.0.1.
import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createCraft, pickAsset, parseSums, CATALOG, byId } from '../agent/craft.mjs';

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error('FAIL', m); } else console.log('ok  ', m); };

// ── pure helpers
const assets = ['photocraft-1.0-linux-x86_64.AppImage', 'photocraft-1.0-linux-aarch64.AppImage', 'photocraft-1.0-linux-x86_64.deb', 'photocraft-1.0-windows-x86_64.zip', 'photocraft-1.0-macos-universal.dmg', 'photocraft-web-1.0-linux-x86_64.tar.gz', 'SHA256SUMS', 'photocraft-1.0-linux-x86_64.AppImage.sha256'].map((name) => ({ name, size: 1, url: 'x' }));
ok(pickAsset(assets, { platform: 'linux', arch: 'x64' })?.name === 'photocraft-1.0-linux-x86_64.AppImage', 'linux x64 picks the AppImage');
ok(pickAsset(assets, { platform: 'linux', arch: 'arm64' })?.name === 'photocraft-1.0-linux-aarch64.AppImage', 'linux arm64 picks aarch64');
ok(pickAsset(assets, { platform: 'win32', arch: 'x64' })?.name.endsWith('windows-x86_64.zip'), 'windows picks the zip');
ok(pickAsset(assets, { platform: 'darwin', arch: 'arm64' })?.name.endsWith('.dmg'), 'mac picks the dmg');
ok(pickAsset([{ name: 'a-linux-x86_64.deb' }], { platform: 'linux', arch: 'x64' }) === null, 'nothing fits -> null');
ok(parseSums(`${'a'.repeat(64)}  dir/one.AppImage\n${'B'.repeat(64)} *two.zip\n`).get('two.zip') === 'b'.repeat(64), 'SHA256SUMS parses');
ok(CATALOG.length >= 17 && byId('PhotoCraft')?.replaces === 'Photoshop' && byId('craft-anything')?.cli === 'direct', 'catalog has the apps and Craft Anything');

// ── fake GitHub
const body = Buffer.from('#!/bin/sh\necho "fake photocraft $@"\n');
const good = createHash('sha256').update(body).digest('hex');
let sums = good, mode = 'good';
const srv = http.createServer((req, res) => {
  const base = `http://127.0.0.1:${srv.address().port}`;
  if (req.url.startsWith('/repos/storytold/photocraft/releases')) {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ tag_name: 'v1.0', name: 'v1.0', published_at: 'x', assets: [
      { name: 'photocraft-1.0-linux-x86_64.AppImage', size: body.length, browser_download_url: `${base}/dl/${mode === 'redirect' ? 'redir' : 'app'}` },
      { name: 'photocraft-1.0-linux-x86_64.AppImage.sha256', size: 64, browser_download_url: `${base}/dl/sum` },
    ] }));
  }
  if (req.url.startsWith('/repos/storytold/vectorcraft/')) { res.statusCode = 404; return res.end('{}'); }
  if (req.url === '/dl/app') return res.end(body);
  if (req.url === '/dl/sum') return res.end(`${sums}  photocraft-1.0-linux-x86_64.AppImage\n`);
  if (req.url === '/dl/redir') { res.statusCode = 302; res.setHeader('location', 'http://evil.example/steal'); return res.end(); }
  res.statusCode = 404; res.end();
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const api = `http://127.0.0.1:${srv.address().port}`;
const dir = mkdtempSync(path.join(tmpdir(), 'craft-test-'));
const craft = createCraft({ dir, api, allowHosts: ['127.0.0.1'], allowHttp: true });

try {
  // install, checksum matches
  const logs = [];
  const st = await craft.install('photocraft', { log: (l) => logs.push(l), platform: 'linux', arch: 'x64' });
  ok(st.verified === true && st.tag === 'v1.0' && existsSync(st.path), 'install downloads and verifies the SHA-256');
  ok(craft.installed('photocraft')?.path === st.path, 'install state is remembered');
  ok((statSyncMode(st.path) & 0o111) !== 0, 'the AppImage is made executable');
  // cli command
  const c = craft.cliCommand('photocraft', ['run', 'a.psd']);
  ok(c.file === st.path && c.args[0] === '--cli' && c.args[1] === 'run', 'cliCommand puts --cli in front');
  const r = spawnSync(c.file, c.args, { encoding: 'utf8' });
  ok(r.stdout.includes('fake photocraft --cli run a.psd'), 'the command line actually runs');
  // list
  ok(craft.list().find((a) => a.id === 'photocraft').installed.tag === 'v1.0', 'list shows what is installed');

  // checksum mismatch -> deleted, not installed
  rmSync(path.join(dir, 'photocraft'), { recursive: true, force: true });
  sums = 'f'.repeat(64);
  let err = '';
  await craft.install('photocraft', { platform: 'linux', arch: 'x64' }).catch((e) => { err = e.message; });
  ok(/does not match/.test(err) && !craft.installed('photocraft') && !existsSync(path.join(dir, 'photocraft', 'v1.0', 'photocraft-1.0-linux-x86_64.AppImage')), 'a wrong checksum deletes the file and installs nothing');
  sums = good;

  // redirect to a host that is not allowed
  mode = 'redirect'; err = '';
  await craft.install('photocraft', { platform: 'linux', arch: 'x64' }).catch((e) => { err = e.message; });
  ok(/only GitHub release hosts/.test(err), 'a redirect to another host is refused');
  mode = 'good';

  // other errors
  err = ''; await craft.install('vectorcraft', { platform: 'linux', arch: 'x64' }).catch((e) => { err = e.message; });
  ok(/no .*release/.test(err), 'an app with no release says so');
  err = ''; await craft.install('nope').catch((e) => { err = e.message; });
  ok(/Unknown app/.test(err), 'unknown app is named');
  err = ''; try { craft.cliCommand('filmcraft', []); } catch (e) { err = e.message; }
  ok(/not installed/.test(err), 'cliCommand on an app that is not installed says how to install');

  // https-only by default
  const strict = createCraft({ dir, api, allowHosts: ['127.0.0.1'] });
  err = ''; await strict.release('photocraft').catch((e) => { err = e.message; });
  ok(/Refusing http/.test(err), 'plain http is refused by default');

  // open on a display: the app is started with DISPLAY set
  await craft.install('photocraft', { platform: 'linux', arch: 'x64' });
  err = ''; try { craft.open('photocraft', {}); } catch (e) { err = e.message; }
  ok(/no screen/.test(err), 'open without a screen says to start one');
  const marker = path.join(dir, 'opened.txt');
  writeFileSync(craft.installed('photocraft').path, `#!/bin/sh\necho "$DISPLAY $1" > ${marker}\n`, { mode: 0o755 });
  const o = craft.open('photocraft', { display: ':77', file: '/tmp/x.psd' });
  await new Promise((r2) => setTimeout(r2, 600));
  ok(o.pid > 0 && existsSync(marker) && readFileSync(marker, 'utf8').trim() === ':77 /tmp/x.psd', 'open starts the app on the private display with the file');
} finally {
  srv.close();
  rmSync(dir, { recursive: true, force: true });
}
function statSyncMode(p) { return spawnSync('stat', ['-c', '%a', p], { encoding: 'utf8' }).stdout.trim() ? parseInt(spawnSync('stat', ['-c', '%a', p], { encoding: 'utf8' }).stdout.trim(), 8) : 0; }
console.log(fails ? `\n${fails} FAILED` : '\nALL OK');
process.exit(fails ? 1 : 0);
