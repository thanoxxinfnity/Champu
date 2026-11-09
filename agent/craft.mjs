/**
 * The Craft apps on the bridge computer: ArtCraft's open-source Adobe/Office alternatives (PhotoCraft, VectorCraft, FilmCraft, LightCraft,
 * EffectCraft, DesignCraft, PdfCraft, ...) and Craft Anything, which studies a site or app and rebuilds it.
 * They are native Rust programs published as GitHub releases by github.com/storytold under MIT or Apache-2.0. The bridge:
 *
 *   craft list                       what exists and what is installed here
 *   craft install <app> [--tag v1]   download the release for this OS and CPU, check its SHA-256 when the release publishes one
 *   craft run <app> <args...>        the app's command line, no window (PhotoCraft: `craft run photocraft run in.psd --cmd ... --out out.png`)
 *   craft where <app>                the installed file
 *   craft anything <args...>         Craft Anything's command line (doctor, commands, rebuild <url> "<request>", mcp)
 *
 * and, through POST /v1/craft, opens an app's window on the agent's private screen so it shows in the live view.
 * Nothing is run by an install. Downloads only come from github.com / githubusercontent.com over https, redirects included.
 * Zero dependencies, like the rest of the agent.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { chmod, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export const ORG = 'storytold';
export const LICENSE = 'MIT or Apache-2.0 (the apps\' own README); the ArtCraft name and logos are trademarks';

/** `replaces` is what the app stands in for; `cli` is how its command line is reached ('--cli' flag on the app file, or the file itself). */
export const CATALOG = [
  { id: 'photocraft', repo: 'photocraft', name: 'PhotoCraft', replaces: 'Photoshop', blurb: 'Layers, masks, adjustment layers, real PSD/PSB, 69 tools, CMYK and Lab, GPU compositor. Headless run, batch and MCP.', cli: '--cli', web: true },
  { id: 'vectorcraft', repo: 'vectorcraft', name: 'VectorCraft', replaces: 'Illustrator', blurb: 'Vector illustration: paths, shapes, type, SVG and PDF.', cli: '--cli', web: true },
  { id: 'filmcraft', repo: 'filmcraft', name: 'FilmCraft', replaces: 'Premiere Pro', blurb: 'Non-linear video editor with colour and sound.', cli: '--cli', web: true },
  { id: 'lightcraft', repo: 'lightcraft', name: 'LightCraft', replaces: 'Lightroom', blurb: 'Non-destructive photo library and raw development.', cli: '--cli', web: true },
  { id: 'effectcraft', repo: 'effectcraft', name: 'EffectCraft', replaces: 'After Effects', blurb: 'Motion graphics and compositing.', cli: '--cli', web: true },
  { id: 'designcraft', repo: 'designcraft', name: 'DesignCraft', replaces: 'InDesign', blurb: 'Page layout and publishing.', cli: '--cli', web: true },
  { id: 'pdfcraft', repo: 'pdfcraft', name: 'PdfCraft', replaces: 'Acrobat Pro', blurb: 'Read, edit, organise and protect PDFs.', cli: '--cli', web: true },
  { id: 'wordcraft', repo: 'wordcraft', name: 'WordCraft', replaces: 'Word', blurb: 'Clean-room word processor.', cli: '--cli', web: true },
  { id: 'deckcraft', repo: 'deckcraft', name: 'DeckCraft', replaces: 'PowerPoint', blurb: 'Clean-room presentations.', cli: '--cli', web: true },
  { id: 'gridcraft', repo: 'gridcraft', name: 'GridCraft', replaces: 'Excel', blurb: 'Clean-room spreadsheets.', cli: '--cli', web: true },
  { id: 'cadcraft', repo: 'cadcraft', name: 'CADCraft', replaces: 'AutoCAD', blurb: 'Clean-room 2D/3D CAD.', cli: '--cli', web: true },
  { id: 'figcraft', repo: 'figcraft', name: 'FigCraft', replaces: 'Figma', blurb: 'Interface design and prototyping.', cli: '--cli', web: true },
  { id: 'soundcraft', repo: 'soundcraft', name: 'SoundCraft', replaces: 'Pro Tools', blurb: 'Audio recording and editing.', cli: '--cli', web: true },
  { id: 'texturecraft', repo: 'texturecraft', name: 'TextureCraft', replaces: 'Substance Painter', blurb: '3D texture painting.', cli: '--cli', web: false },
  { id: 'materialcraft', repo: 'materialcraft', name: 'MaterialCraft', replaces: 'Substance Designer', blurb: 'Node-based material designer.', cli: '--cli', web: false },
  { id: 'anicraft', repo: 'AniCraft', name: 'AniCraft', replaces: 'Animate', blurb: '2D animation editor.', cli: '--cli', web: false },
  { id: 'artcraft', repo: 'artcraft', name: 'ArtCraft', replaces: 'AI image and video studio', blurb: 'Compose in 2D, stage scenes in 3D, pick from many image, video, audio and 3D models (most are hosted services, each with its own terms).', cli: null, web: false },
  { id: 'craft-anything', repo: 'craft-anything', name: 'Craft Anything', replaces: 'reverse engineering and rebuilding', blurb: 'Studies a website, app, game or file, has a coding agent build your own version and checks it against the original. Clean-room mode works only from what a visitor sees.', cli: 'direct', web: false, agent: 'Needs a coding agent signed in on this computer (Claude Code, Copilot CLI or Grok Build).' },
];

export const byId = (id) => CATALOG.find((a) => a.id === String(id).toLowerCase()) ?? null;

const ALLOWED_HOSTS = ['github.com', 'api.github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com', 'github-releases.githubusercontent.com'];
const SKIP_ASSET = /\.(asc|sig|zsync|sha256|sha512|sbom|json|txt|md)$/i;
const SUMS_NAME = /^(sha256sums?(\.txt)?|checksums?(\.txt)?|sha256sum\.txt)$/i;

/** Which release file fits this OS and CPU. Returns null when nothing does. */
export function pickAsset(assets, { platform = process.platform, arch = process.arch, cli = false } = {}) {
  const os = platform === 'win32' ? ['windows', 'win'] : platform === 'darwin' ? ['macos', 'darwin', 'mac', 'osx'] : ['linux'];
  const cpu = arch === 'arm64' ? ['aarch64', 'arm64'] : arch === 'x64' ? ['x86_64', 'amd64', 'x64'] : [arch];
  const ext = platform === 'win32' ? ['.zip', '.msi'] : platform === 'darwin' ? ['.dmg', '.zip'] : ['.appimage', '.tar.gz', '.tgz'];
  let best = null, bestScore = 0;
  for (const a of assets) {
    const n = String(a.name).toLowerCase();
    if (SKIP_ASSET.test(n) || /source code/i.test(n)) continue;
    if (!os.some((o) => n.includes(o))) continue;
    if (!cpu.some((c) => n.includes(c)) && !n.includes('universal')) continue;
    const e = ext.findIndex((x) => n.endsWith(x));
    if (e < 0) continue;
    let score = 100 - e * 10;
    if (cli && n.includes('cli')) score += 20;
    if (!cli && n.includes('cli')) score -= 15;
    if (n.includes('web')) score -= 50;
    if (score > bestScore) { best = a; bestScore = score; }
  }
  return best;
}

export function parseSums(text) {
  const out = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (m) out.set(path.basename(m[2].trim()), m[1].toLowerCase());
  }
  return out;
}

export function createCraft({ dir = process.env.CHOMUGIRI_CRAFT_DIR || path.join(homedir(), 'craft-apps'), api = 'https://api.github.com', fetchImpl = globalThis.fetch, allowHosts = ALLOWED_HOSTS, allowHttp = false } = {}) {
  const hdr = () => ({ 'User-Agent': 'chomugiri-bridge', Accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) });

  function checkUrl(u) {
    const url = new URL(u);
    if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) throw new Error(`Refusing ${url.protocol} download.`);
    if (!allowHosts.includes(url.hostname)) throw new Error(`Refusing to download from ${url.hostname}: only GitHub release hosts are allowed.`);
    return url;
  }
  /** fetch that follows redirects by hand so every hop is checked against the allow-list. */
  async function safeFetch(u, init = {}) {
    let url = checkUrl(u).toString();
    for (let hop = 0; hop < 6; hop++) {
      const res = await fetchImpl(url, { ...init, redirect: 'manual' });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { url = checkUrl(new URL(res.headers.get('location'), url).toString()).toString(); continue; }
      return res;
    }
    throw new Error('Too many redirects.');
  }

  async function release(repo, tag) {
    const res = await safeFetch(`${api}/repos/${ORG}/${repo}/releases/${tag ? `tags/${encodeURIComponent(tag)}` : 'latest'}`, { headers: hdr() });
    if (res.status === 404) throw new Error(`${ORG}/${repo} has no ${tag ? `release ${tag}` : 'published release'} yet.`);
    if (res.status === 403 || res.status === 429) throw new Error('GitHub is rate limiting this computer. Wait a few minutes, or set GITHUB_TOKEN to raise the limit.');
    if (!res.ok) throw new Error(`GitHub answered ${res.status}.`);
    const j = await res.json();
    return { tag: j.tag_name, name: j.name, publishedAt: j.published_at, assets: (j.assets ?? []).map((a) => ({ name: a.name, size: a.size, url: a.browser_download_url })) };
  }

  const appDir = (id) => path.join(dir, id);
  const stateFile = (id) => path.join(appDir(id), 'installed.json');
  function installed(id) {
    try { return JSON.parse(readFileSync(stateFile(id), 'utf8')); } catch { return null; }
  }

  async function download(url, dest, onProgress) {
    const res = await safeFetch(url, { headers: { 'User-Agent': 'chomugiri-bridge' } });
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}).`);
    const total = Number(res.headers.get('content-length')) || 0;
    const hash = createHash('sha256');
    const out = createWriteStream(dest);
    let got = 0, lastTick = 0;
    try {
      for await (const chunk of res.body) {
        hash.update(chunk); got += chunk.length;
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
        if (onProgress && Date.now() - lastTick > 3000) { lastTick = Date.now(); onProgress(got, total); }
      }
      await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
    } catch (e) { out.destroy(); await rm(dest, { force: true }); throw e; }
    return { sha256: hash.digest('hex'), bytes: got };
  }

  async function sumsFor(rel, asset) {
    const side = rel.assets.find((a) => a.name === `${asset.name}.sha256`);
    const all = rel.assets.find((a) => SUMS_NAME.test(a.name));
    const pick = side ?? all;
    if (!pick) return null;
    const res = await safeFetch(pick.url, { headers: { 'User-Agent': 'chomugiri-bridge' } });
    if (!res.ok) return null;
    const text = await res.text();
    if (side) { const m = /^([a-f0-9]{64})/i.exec(text.trim()); return m ? m[1].toLowerCase() : null; }
    return parseSums(text).get(asset.name) ?? null;
  }

  /** Downloads and prepares the app for this machine. `log` receives short progress lines. */
  async function install(id, { tag, log = () => {}, platform = process.platform, arch = process.arch } = {}) {
    const app = byId(id);
    if (!app) throw new Error(`Unknown app "${id}". Try: craft list`);
    log(`Looking for the latest ${app.name} release on github.com/${ORG}/${app.repo} ...`);
    const rel = await release(app.repo, tag);
    const asset = pickAsset(rel.assets, { platform, arch, cli: app.cli === 'direct' });
    if (!asset) {
      const names = rel.assets.filter((a) => !SKIP_ASSET.test(a.name)).map((a) => a.name).join(', ') || 'none';
      throw new Error(`${app.name} ${rel.tag} has no file for ${platform}/${arch}. Files in that release: ${names}. You can build it with Rust: git clone https://github.com/${ORG}/${app.repo} && cargo run --release -p ${app.id}`);
    }
    const folder = path.join(appDir(app.id), rel.tag);
    await mkdir(folder, { recursive: true });
    const dest = path.join(folder, asset.name);
    log(`Downloading ${asset.name} (${(asset.size / 1048576).toFixed(0)} MB) ...`);
    const got = await download(asset.url, dest, (g, t) => log(`  ${(g / 1048576).toFixed(0)} MB${t ? ` of ${(t / 1048576).toFixed(0)}` : ''}`));
    const expected = await sumsFor(rel, asset).catch(() => null);
    let verified = false;
    if (expected) {
      if (expected !== got.sha256) { await rm(dest, { force: true }); throw new Error(`The download does not match the release's SHA-256 (${got.sha256.slice(0, 12)}… vs ${expected.slice(0, 12)}…). It was deleted.`); }
      verified = true;
      log('SHA-256 matches the release.');
    } else log('This release publishes no checksum file, so the download could not be verified (it did come from github.com over https).');
    let entry = dest;
    const lower = asset.name.toLowerCase();
    if (lower.endsWith('.appimage')) await chmod(dest, 0o755);
    else if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
      const unpack = path.join(folder, 'unpacked');
      await rm(unpack, { recursive: true, force: true });
      await mkdir(unpack, { recursive: true });
      await new Promise((resolve, reject) => { const c = spawn('tar', ['-xzf', dest, '-C', unpack], { stdio: 'ignore' }); c.on('error', reject); c.on('close', (code) => (code === 0 ? resolve() : reject(new Error('tar could not unpack the download')))); });
      entry = (await findExecutable(unpack, app.id)) ?? dest;
      if (entry !== dest) await chmod(entry, 0o755);
    }
    const state = { id: app.id, tag: rel.tag, asset: asset.name, path: entry, sha256: got.sha256, verified, bytes: got.bytes, installedAt: Date.now() };
    await writeFile(stateFile(app.id), JSON.stringify(state, null, 2));
    log(`Installed ${app.name} ${rel.tag}: ${entry}`);
    return state;
  }

  async function findExecutable(root, id) {
    const stack = [root];
    while (stack.length) {
      const d = stack.pop();
      for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (e.name === id || e.name === `${id}-cli` || e.name.toLowerCase() === id) return p;
      }
    }
    return null;
  }

  /** The command line to run an installed app's CLI. */
  function cliCommand(id, args) {
    const app = byId(id);
    const st = app && installed(app.id);
    if (!app) throw new Error(`Unknown app "${id}".`);
    if (!st) throw new Error(`${app.name} is not installed here. Run: craft install ${app.id}`);
    if (!existsSync(st.path)) throw new Error(`${app.name} was installed at ${st.path}, which is gone. Run: craft install ${app.id}`);
    if (app.cli === null) throw new Error(`${app.name} has no command line; open it on the screen instead.`);
    const lead = app.cli === 'direct' ? [] : [app.cli];
    return { file: st.path, args: [...lead, ...args], env: { APPIMAGE_EXTRACT_AND_RUN: '1', PHOTOCRAFT_NO_DESKTOP_INTEGRATION: '1', CRAFT_NO_DESKTOP_INTEGRATION: '1' } };
  }

  /** Opens the app's window on `display` (the agent's private screen). Detached; returns the pid. */
  function open(id, { display, file, cwd } = {}) {
    const app = byId(id);
    if (!app) throw new Error(`Unknown app "${id}".`);
    const st = installed(app.id);
    if (!st) throw new Error(`${app.name} is not installed here. Install it first.`);
    if (!display) throw new Error('There is no screen yet. Start the private screen first (the Handoff desktop mode does), then open the app.');
    const child = spawn(st.path, file ? [file] : [], { cwd, detached: true, stdio: 'ignore', env: { ...process.env, DISPLAY: display, WAYLAND_DISPLAY: '', APPIMAGE_EXTRACT_AND_RUN: '1', PHOTOCRAFT_NO_DESKTOP_INTEGRATION: '1', CRAFT_NO_DESKTOP_INTEGRATION: '1' } });
    child.on('error', () => {});
    child.unref();
    return { pid: child.pid };
  }

  function list() {
    return CATALOG.map((a) => ({ ...a, installed: installed(a.id), url: `https://github.com/${ORG}/${a.repo}` }));
  }

  return { dir, release, install, installed, cliCommand, open, list, pickAsset };
}

// ── command line: `node chomugiri-agent.mjs craft …` ─────────────────────────

export const CRAFT_HELP = `craft — the open-source Craft apps (PhotoCraft, VectorCraft, FilmCraft, ... and Craft Anything) on this computer
  craft list                          every app, and which are installed
  craft install <app> [--tag v1.2]    download the release for this computer (SHA-256 checked when published)
  craft run <app> <args...>           the app's command line, no window. PhotoCraft: craft run photocraft run in.psd --cmd filter.sharpen.smartSharpen --params '{"amount":80}' --out out.png
  craft where <app>                   the installed file
  craft anything <args...>            Craft Anything: doctor | commands | rebuild <url> "<request>" | mcp
Apps: ${CATALOG.map((a) => a.id).join(', ')}.
Source: github.com/${ORG}. Licence: ${LICENSE}.`;

export async function craftCli(argv, craft = createCraft()) {
  const [verb, ...rest] = argv;
  try {
    if (!verb || verb === 'help' || verb === '--help') { console.log(CRAFT_HELP); return 0; }
    if (verb === 'list') {
      for (const a of craft.list()) console.log(`${a.installed ? '[installed ' + a.installed.tag + ']' : '[not installed]'} ${a.id.padEnd(15)} ${a.replaces.padEnd(26)} ${a.blurb.slice(0, 80)}`);
      return 0;
    }
    if (verb === 'where') { const a = craft.installed(rest[0] ?? ''); console.log(a ? a.path : 'not installed'); return a ? 0 : 1; }
    if (verb === 'install') {
      const ti = rest.indexOf('--tag');
      const tag = ti >= 0 ? rest[ti + 1] : undefined;
      await craft.install(rest[0], { tag, log: (l) => console.log(l) });
      return 0;
    }
    if (verb === 'run' || verb === 'anything') {
      const id = verb === 'anything' ? 'craft-anything' : rest.shift();
      const { file, args, env } = craft.cliCommand(id, rest);
      return await new Promise((resolve) => {
        const c = spawn(file, args, { stdio: 'inherit', env: { ...process.env, ...env } });
        c.on('error', (e) => { console.error(`Could not start ${file}: ${e.message}`); resolve(127); });
        c.on('close', (code) => resolve(code ?? 1));
      });
    }
    console.error(`unknown craft command "${verb}"\n\n${CRAFT_HELP}`);
    return 2;
  } catch (e) {
    console.error(e.message);
    return 1;
  }
}
