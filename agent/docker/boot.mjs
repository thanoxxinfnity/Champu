#!/usr/bin/env node
/**
 * Starts the Chomugiri terminal bridge from its newest files.
 *
 * A container (a Hugging Face Space, a VPS) is built once and then runs for months, while the bridge keeps changing. Baking the
 * bridge into the image meant uploading its files by hand for every update. This small supervisor fetches the current bridge
 * files from the project's public repository each time it starts the bridge, keeps the last good copy for when the network is
 * down, and starts the bridge again when it exits (the app's "restart the terminal" makes it exit), so an update needs no
 * rebuild and the workspace stays where it is.
 *
 *   node boot.mjs               fetch, then run the bridge (and run it again whenever it exits)
 *   node boot.mjs --fetch-only  fetch and stop (used while the image is built, so the image carries a copy)
 *
 * CHOMUGIRI_SOURCE is the folder the files come from (a raw GitHub URL of the repo's agent/ folder). No dependencies.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SOURCE = 'https://raw.githubusercontent.com/thanoxxinfnity/Champu/claude/chomugiri-workspace-design-09sxwa/agent';
const NAME = /^[\w.-]+\.mjs$/;

/** Downloads the bridge files named by the source's manifest into `dir`. Throws (and leaves `dir` as it was) when anything is missing. */
export async function fetchBridge({ source = process.env.CHOMUGIRI_SOURCE || DEFAULT_SOURCE, dir = path.join(HERE, 'agent'), fetchImpl = globalThis.fetch, log = console.log } = {}) {
  const base = source.replace(/\/+$/, '');
  const get = async (name) => {
    const res = await fetchImpl(`${base}/${name}`, { signal: AbortSignal.timeout(60_000), headers: { 'User-Agent': 'chomugiri-boot' } });
    if (!res.ok) throw new Error(`${name}: ${res.status}`);
    return res.text();
  };
  const manifest = JSON.parse(await get('manifest.json'));
  if (!Array.isArray(manifest.files) || !manifest.files.includes('chomugiri-agent.mjs')) throw new Error('the manifest does not list the bridge');
  for (const n of manifest.files) if (!NAME.test(n)) throw new Error(`unexpected file name in the manifest: ${n}`);
  const have = existsSync(path.join(dir, 'manifest.json')) ? JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) : null;
  if (have?.sha256 && have.sha256 === manifest.sha256 && manifest.files.every((n) => existsSync(path.join(dir, n)))) { log(`boot: bridge ${manifest.version} is already here`); return { version: manifest.version, changed: false }; }
  // Everything lands in a side folder first, so a download that stops halfway never leaves a half-updated bridge.
  const next = `${dir}.next`;
  rmSync(next, { recursive: true, force: true });
  mkdirSync(next, { recursive: true });
  for (const n of manifest.files) {
    const text = await get(n);
    if (text.length < 200) throw new Error(`${n} came back almost empty`);
    writeFileSync(path.join(next, n), text);
  }
  writeFileSync(path.join(next, 'manifest.json'), JSON.stringify(manifest));
  rmSync(`${dir}.old`, { recursive: true, force: true });
  if (existsSync(dir)) renameSync(dir, `${dir}.old`);
  renameSync(next, dir);
  rmSync(`${dir}.old`, { recursive: true, force: true });
  log(`boot: fetched bridge ${manifest.version} (${manifest.files.length} files)`);
  return { version: manifest.version, changed: true };
}

async function main() {
  const dir = path.join(HERE, 'agent');
  const refresh = async () => {
    try { await fetchBridge({ dir }); } catch (err) { console.log(`boot: could not fetch the newest bridge (${err.message}); ${existsSync(path.join(dir, 'chomugiri-agent.mjs')) ? 'using the copy already here' : 'and there is no copy here'}`); }
  };
  await refresh();
  if (process.argv.includes('--fetch-only')) { process.exit(existsSync(path.join(dir, 'chomugiri-agent.mjs')) ? 0 : 1); }
  const starts = [];
  for (;;) {
    if (!existsSync(path.join(dir, 'chomugiri-agent.mjs'))) { console.log('boot: no bridge to start; trying again in 30 s'); await new Promise((r) => setTimeout(r, 30_000)); await refresh(); continue; }
    const code = await new Promise((resolve) => {
      // The workspace hand-off is off: this supervisor is what brings newer files, and it restarts the bridge itself.
      const child = spawn(process.execPath, [path.join(dir, 'chomugiri-agent.mjs'), ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, CHOMUGIRI_SUPERVISED: '1', CHOMUGIRI_NO_HANDOFF: '1' } });
      for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => { child.kill(sig); setTimeout(() => process.exit(0), 3000); });
      child.on('exit', (c) => resolve(c ?? 1));
      child.on('error', () => resolve(1));
    });
    const now = Date.now();
    starts.push(now);
    while (starts.length && now - starts[0] > 120_000) starts.shift();
    if (starts.length >= 6) { console.log('boot: the bridge stopped six times in two minutes; giving up so the container shows the error'); process.exit(1); }
    console.log(`boot: the bridge exited (${code}); fetching the newest files and starting it again`);
    await new Promise((r) => setTimeout(r, 1200));
    await refresh();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
