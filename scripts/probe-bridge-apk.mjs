/**
 * Does the bridge APK path actually produce an APK?
 *
 * Runs the real module against a BridgeRunner backed by this machine's shell,
 * which is exactly what the bridge is on the other end. Nothing is stubbed
 * except the transport.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { buildApkOnBridge, findGodot, versionFrom } from '../src/lib/suites/godot/bridge-build.ts';
import { buildProject } from '../src/lib/suites/godot/project.ts';
import { planGame } from '../src/lib/suites/godot/plan.ts';
import { generateModel } from '../src/lib/suites/godot/model-source.ts';
import { playerParts } from '../src/lib/suites/godot/plan.ts';

const exec = promisify(execFile);
const ROOT = process.env.BRIDGE_ROOT ?? '/tmp/bridge-root';

const bridge = {
  async run(cmd, opts = {}) {
    try {
      const { stdout, stderr } = await exec('bash', ['-lc', cmd], {
        cwd: ROOT,
        maxBuffer: 64 * 1024 * 1024,
        timeout: opts.timeoutMs ?? 120_000,
        env: { ...process.env, ANDROID_HOME: '/opt/android-sdk' },
      });
      return { exitCode: 0, stdout, stderr };
    } catch (err) {
      return { exitCode: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? String(err) };
    }
  },
  async writeFiles(files) {
    for (const f of files) {
      const dest = path.join(ROOT, f.path);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, f.base64 ? Buffer.from(f.base64, 'base64') : (f.content ?? ''));
    }
    return { count: files.length };
  },
  async readFile(p) {
    const buf = await fs.readFile(path.join(ROOT, p));
    return { bytes: buf.byteLength, base64: buf.toString('base64'), binary: true };
  },
};

await fs.mkdir(ROOT, { recursive: true });

const found = await findGodot(bridge, process.env.GODOT ?? undefined);
console.log('1. engine       ', found.path ?? `(none) — ${found.error}`);
if (!found.path) process.exit(1);
const v = await bridge.run(`"${found.path}" --version`);
console.log('   version      ', versionFrom(v.stdout));

const plan = planGame('a realistic zombie survival shooter called Chomu Game, first person');
const model = await generateModel(
  { prompt: 'a zombie, realistic', role: 'character', plan: plan.player.body, parts: playerParts(plan) },
  {},
  {},
);

const files = buildProject({
  name: plan.name,
  dimension: plan.dimension,
  genre: plan.genre,
  view: plan.view,
  models: [{ path: 'res://zombie.glb', node: 'Zombie', rigged: model.rigged }],
}).map((f) => ({ path: f.path, content: f.content }));

let bin = '';
for (let i = 0; i < model.bytes.length; i += 0x8000) bin += String.fromCharCode(...model.bytes.subarray(i, i + 0x8000));
files.push({ path: 'zombie.glb', content: `data:model/gltf-binary;base64,${btoa(bin)}` });
console.log('2. project      ', files.length, 'files, model from', model.source);

const built = await buildApkOnBridge(bridge, files, {
  name: plan.name,
  versionName: '1.0',
  godotPath: found.path,
  onStage: (m) => console.log('   ·', m),
});

if (built.error) {
  console.log('3. apk           FAILED —', built.error);
  console.log(built.log.slice(-500));
  process.exit(1);
}

console.log('3. apk          ', built.filename, built.bytes.byteLength.toLocaleString(), 'bytes');
const out = process.env.APK_OUT ?? '/tmp/bridge-built.apk';
await fs.writeFile(out, built.bytes);
console.log('   written to   ', out);
console.log('\nRESULT: the bridge path produces an APK');
