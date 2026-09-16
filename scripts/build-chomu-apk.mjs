/**
 * Build the shipped game, through the same modules the app calls.
 *
 * Nothing here is a special path for the demo: it plans from a prompt, asks the
 * model source for a character, pulls real cover off Poly Haven, and hands the
 * whole project to the bridge exporter. If this script produces a working APK
 * then so does a user typing the same sentence into Game Studio.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { buildApkOnBridge, findGodot, versionFrom } from '../src/lib/suites/godot/bridge-build.ts';
import { buildProject } from '../src/lib/suites/godot/project.ts';
import { planGame, playerParts } from '../src/lib/suites/godot/plan.ts';
import { generateModel } from '../src/lib/suites/godot/model-source.ts';
import { coverProps } from '../src/lib/suites/godot/polyhaven.ts';

const exec = promisify(execFile);
const ROOT = process.env.BRIDGE_ROOT ?? '/tmp/chomu-build-root';
const OUT = process.env.APK_OUT ?? '/tmp/ChomuGame.apk';
const VERSION = process.env.VERSION ?? '3.0';

const bridge = {
  async run(cmd, opts = {}) {
    try {
      const { stdout, stderr } = await exec('bash', ['-lc', cmd], {
        cwd: ROOT,
        maxBuffer: 64 * 1024 * 1024,
        timeout: opts.timeoutMs ?? 300_000,
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

const base64 = (bytes) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

await fs.rm(ROOT, { recursive: true, force: true });
await fs.mkdir(ROOT, { recursive: true });

const found = await findGodot(bridge, process.env.GODOT ?? undefined);
if (!found.path) { console.log('no engine:', found.error); process.exit(1); }
console.log('engine   ', found.path, versionFrom((await bridge.run(`"${found.path}" --version`)).stdout));

const plan = planGame('a realistic zombie survival shooter called Chomu Game, first person');
console.log('plan     ', plan.name, '|', plan.genre, '|', plan.view);

const model = await generateModel(
  { prompt: 'a zombie, realistic, detailed, fully textured', role: 'character', plan: plan.player.body, parts: playerParts(plan) },
  {},
  {},
);
console.log('character', model.source, model.rigged ? '(rigged)' : '(static)', model.bytes.length.toLocaleString(), 'bytes');

const { props, notes } = await coverProps(['barrel', 'wooden crate', 'concrete barrier'], { targetHeight: 1.25 });
for (const note of notes) console.log('         ·', note);
console.log('cover    ', props.map((p) => p.asset.name).join(', ') || '(none — the boxes stay)');

const files = buildProject({
  name: plan.name,
  dimension: plan.dimension,
  genre: plan.genre,
  view: plan.view,
  models: [{ path: 'res://zombie.glb', node: 'Zombie', rigged: model.rigged }],
  props: props.map((p) => ({ path: p.scenePath, size: p.size, baseY: p.baseY, scale: p.scale })),
}).map((f) => ({ path: f.path, content: f.content }));

files.push({ path: 'zombie.glb', content: `data:model/gltf-binary;base64,${base64(model.bytes)}` });
for (const prop of props) {
  for (const file of prop.files) {
    files.push({
      path: file.path,
      content: file.bytes ? `data:application/octet-stream;base64,${base64(file.bytes)}` : file.content,
    });
  }
}
if (props.length) {
  files.push({ path: 'CREDITS.md', content: `# Models\n\n${props.map((p) => `- ${p.credit}`).join('\n')}\n` });
}
console.log('project  ', files.length, 'files');

const built = await buildApkOnBridge(bridge, files, {
  name: plan.name,
  versionName: VERSION,
  godotPath: found.path,
  onStage: (m) => console.log('         ·', m),
});

if (built.error) {
  console.log('FAILED —', built.error);
  console.log(built.log.slice(-1500));
  process.exit(1);
}
await fs.writeFile(OUT, built.bytes);
console.log('apk      ', built.filename, built.bytes.byteLength.toLocaleString(), 'bytes ->', OUT);
