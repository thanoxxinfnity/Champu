/** node --experimental-strip-types --test scripts/test-bridge-build.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { asWritable, buildApkOnBridge, findGodot, templatesInstalled, versionFrom } from '../src/lib/suites/godot/bridge-build.ts';

/** A bridge whose answers are scripted, so each failure can be reached on purpose. */
function fakeBridge({ commands = {}, files = {} } = {}) {
  const ran = [];
  return {
    ran,
    async run(cmd) {
      ran.push(cmd);
      for (const [pattern, reply] of Object.entries(commands)) {
        if (cmd.includes(pattern)) return { exitCode: 0, stdout: reply, stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    },
    async writeFiles(written) {
      return { count: written.length };
    },
    async readFile(path) {
      const hit = files[path];
      if (!hit) throw new Error('no such file');
      return { bytes: hit.length, base64: Buffer.from(hit).toString('base64'), binary: true };
    },
  };
}

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const APK_BYTES = Buffer.concat([ZIP_MAGIC, Buffer.alloc(2_000_000)]);
const TEMPLATE_PATH = '/root/.local/share/godot/export_templates/4.7.2.stable/android_debug.apk';
/** A machine with everything in place: Godot 4 on the PATH, templates installed. */
const READY = {
  'command -v': '/usr/bin/godot',
  '--version': '4.7.2.stable.official',
  export_templates: TEMPLATE_PATH,
  pwd: '/b/g',
};

test('Godot 3 is not mistaken for Godot 4', async () => {
  // The scene format is different; exporting a Godot 4 project with it produces
  // a broken APK rather than an error.
  const found = await findGodot(
    fakeBridge({ commands: { 'command -v godot': '/usr/bin/godot', '--version': '3.5.3.stable.official' } }),
  );
  assert.equal(found.path, undefined);
  assert.match(found.error, /No Godot 4/);
});

test('an explicit path is checked, not trusted', async () => {
  const good = await findGodot(fakeBridge({ commands: { '--version': '4.7.2.stable.official' } }), '/opt/godot');
  assert.equal(good.path, '/opt/godot');
  const bad = await findGodot(fakeBridge({ commands: { '--version': 'bash: not found' } }), '/opt/nope');
  assert.match(bad.error, /not a Godot 4 binary/);
});

test('the version line is trimmed to something worth printing', () => {
  assert.equal(versionFrom('4.7.2.stable.official.ed1daf0bf\n'), '4.7.2 stable');
  assert.equal(versionFrom('4.3.stable.official.77dcf97d8'), '4.3 stable');
});

test('missing export templates are caught before the export, not after', async () => {
  // Afterwards the failure is a zero exit code and no file, which reads as a
  // mystery. This is the most common reason an export produces nothing at all.
  // Everything present except the templates.
  const bridge = fakeBridge({ commands: { 'command -v': '/usr/bin/godot', '--version': '4.7.2.stable.official' } });
  assert.equal(await templatesInstalled(bridge, '4.7.2 stable'), false);

  const built = await buildApkOnBridge(bridge, [{ path: 'project.godot', content: 'config_version=5' }], { name: 'G' });
  assert.match(built.error, /no Android export templates/);
  assert.equal(built.bytes, undefined);
});

test('a binary workspace file is sent as base64, not as its data URL', () => {
  assert.deepEqual(asWritable({ path: 'z.glb', content: 'data:model/gltf-binary;base64,Z2xURg==' }, 'build/g'), {
    path: 'build/g/z.glb',
    base64: 'Z2xURg==',
  });
  assert.deepEqual(asWritable({ path: 'a.gd', content: 'extends Node' }, 'build/g'), {
    path: 'build/g/a.gd',
    content: 'extends Node',
  });
});

test('the export output path is absolute, or Godot writes it somewhere else', async () => {
  // Measured against a real 4.7.2: Godot resolves the output against its own
  // working directory, not against --path. With both relative it fails with
  // "Target folder does not exist" after doing all the work — and still exits 0.
  const bridge = fakeBridge({ commands: READY, files: { 'b/g/G-1.0.apk': APK_BYTES } });
  const built = await buildApkOnBridge(bridge, [{ path: 'project.godot', content: 'config_version=5' }], {
    name: 'G',
    dir: 'b/g',
  });
  const exportCmd = bridge.ran.find((c) => c.includes('--export-debug'));
  assert.ok(exportCmd.includes('/b/g/G-1.0.apk'), `output path was not absolute: ${exportCmd}`);
  assert.ok(exportCmd.includes('--path /b/g'), exportCmd);
  assert.equal(built.error, undefined);
  assert.equal(built.bytes.byteLength, APK_BYTES.length);
});

test('a previous build is cleared, so its APK cannot be read back as this one', async () => {
  const bridge = fakeBridge({ commands: READY, files: { 'b/g/G-1.0.apk': APK_BYTES } });
  await buildApkOnBridge(bridge, [{ path: 'project.godot', content: 'x' }], { name: 'G', dir: 'b/g' });
  assert.ok(bridge.ran.some((c) => c.startsWith('rm -rf')), 'nothing cleared the old build');
});

test('something that is not an APK is refused, however big it is', async () => {
  const notAnApk = Buffer.concat([Buffer.from('<!doctype html>'), Buffer.alloc(2_000_000)]);
  const bridge = fakeBridge({ commands: READY, files: { 'b/g/G-1.0.apk': notAnApk } });
  const built = await buildApkOnBridge(bridge, [{ path: 'project.godot', content: 'x' }], { name: 'G', dir: 'b/g' });
  assert.match(built.error, /not an APK/);
  assert.equal(built.bytes, undefined);
});

test('a release build with no keystore fails here rather than on the phone', async () => {
  const bridge = fakeBridge({ commands: READY });
  const built = await buildApkOnBridge(bridge, [{ path: 'project.godot', content: 'x' }], {
    name: 'G',
    dir: 'b/g',
    release: true,
  });
  assert.match(built.error, /needs a keystore/);
});

test('the log and the engine path come back even when the build worked', async () => {
  const bridge = fakeBridge({ commands: READY, files: { 'b/g/G-1.0.apk': APK_BYTES } });
  const built = await buildApkOnBridge(bridge, [{ path: 'project.godot', content: 'x' }], { name: 'G', dir: 'b/g' });
  assert.equal(typeof built.log, 'string');
  assert.equal(built.godot, '/usr/bin/godot');
  assert.equal(built.filename, 'G-1.0.apk');
});
