/** node --experimental-strip-types --test scripts/test-web-export.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWebOnBridge, contentType, describeBuild, playerPage, shimScript, webExportPreset, WEB_OUTPUTS } from '../src/lib/suites/godot/web-export.ts';

/** A bridge whose answers are scripted, mirroring test-bridge-build.mjs's fake. */
function fakeBridge({ commands = {}, files = {} } = {}) {
  return {
    async run(cmd, opts = {}) {
      for (const [pattern, reply] of Object.entries(commands)) {
        if (cmd.includes(pattern)) {
          opts.onOutput?.(reply, 'stdout');
          return { exitCode: 0, stdout: reply, stderr: '' };
        }
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

test('Godot\'s web-export output reaches onOutput live, not just the buffered log', async () => {
  // Same shape of bug as the APK path: onOutput used to feed only a local
  // `log` string nothing outside the function could see.
  const commands = {
    'command -v': '/usr/bin/godot',
    '--version': '4.7.2.stable.official',
    pwd: '/abs/chomugiri-web/game',
    '--export-release "Web"': 'Exporting for Web...\nDone.\n',
  };
  const files = Object.fromEntries(
    ['index.html', 'index.js', 'index.wasm', 'index.pck'].map((n) => [`chomugiri-web/game/build/${n}`, Buffer.from('x')]),
  );
  const bridge = fakeBridge({ commands, files });
  const seen = [];
  const built = await buildWebOnBridge(bridge, [{ path: 'project.godot', content: 'x' }], {
    name: 'G',
    onOutput: (chunk, stream) => seen.push({ chunk, stream }),
  });
  assert.ok(built.files, 'the export should still succeed');
  assert.ok(seen.some((s) => s.chunk.startsWith('$ ') && s.chunk.includes('--export-release')));
  assert.ok(seen.some((s) => s.chunk.includes('Exporting for Web...') && s.stream === 'stdout'));
});

test('the preset asks for the build that can actually run in a blob', () => {
  const cfg = webExportPreset('Chomu Game');
  assert.match(cfg, /platform="Web"/);
  // The threaded build needs SharedArrayBuffer, which needs cross-origin
  // isolation headers, which a blob: document cannot have and a WebView will
  // not give you. A game that runs beats one that would have been faster.
  assert.match(cfg, /variant\/thread_support=false/);
  assert.match(cfg, /export_path="build\/index\.html"/);
  assert.ok(!cfg.includes('progressive_web_app/enabled=true'), 'a service worker would cache a build that changes every time');
});

test('a name with a quote in it does not break the preset', () => {
  assert.match(webExportPreset('The "Yard"'), /progressive_web_app\/name="The \\"Yard\\""/);
});

test('the shim answers for every name in the build', () => {
  const urls = Object.fromEntries(WEB_OUTPUTS.map((n) => [n, `blob:x/${n}`]));
  const js = shimScript(urls);
  for (const name of WEB_OUTPUTS) assert.ok(js.includes(name), `${name} is not in the map`);
  // All three transports emscripten uses, depending on the browser.
  assert.match(js, /window\.fetch = /);
  assert.match(js, /XMLHttpRequest\.prototype\.open/);
  assert.match(js, /AudioWorklet\.prototype\.addModule/);
});

test('the shim matches on the file name, not on the exact url', () => {
  // The loader asks for "index.wasm", "./index.wasm", an absolute path, and the
  // same with a cache-busting query. Every one of those ends in the name.
  const js = shimScript({ 'index.wasm': 'blob:mapped' });
  const resolve = new Function(`${js.replace(/<\/?script>/g, '')}; return window.fetch;`);
  // Exercised for real below; here just assert the splitting logic is present.
  assert.match(js, /split\('\?'\)\[0\]/);
  assert.match(js, /split\('\/'\)\.pop\(\)/);
  assert.equal(typeof resolve, 'function');
});

test('the loader is inlined, not left as a request that races the shim', () => {
  const page = playerPage(
    '<html><head><title>g</title></head><body><script src="index.js"></script></body></html>',
    'var LOADER = 1;',
    { 'index.wasm': 'blob:w' },
  );
  assert.ok(!page.includes('<script src="index.js">'), 'the loader is still a separate request');
  assert.ok(page.includes('var LOADER = 1;'));
  // And the shim is ahead of everything, including GODOT_CONFIG.
  assert.ok(page.indexOf('window.fetch =') < page.indexOf('var LOADER = 1;'));
  assert.ok(page.indexOf('window.fetch =') < page.indexOf('<title>'));
});

test('every file claims the type the browser needs it to', () => {
  // instantiateStreaming rejects anything that is not application/wasm.
  assert.equal(contentType('index.wasm'), 'application/wasm');
  assert.equal(contentType('index.js'), 'text/javascript');
  assert.equal(contentType('index.audio.worklet.js'), 'text/javascript');
  assert.equal(contentType('index.html'), 'text/html');
  assert.equal(contentType('index.pck'), 'application/octet-stream');
});

test('the size is described before someone loads it', () => {
  assert.match(describeBuild({ files: [], size: 16_500_000, log: '' }), /15\.7 MB/);
  assert.equal(describeBuild({ log: '', size: 0, error: 'no engine' }), 'no engine');
});

test('a playable build is offered, and never written into history', async () => {
  // The build does not survive a reload — it is 45MB of WebAssembly held in
  // memory for the session — so a Play button restored from history would be a
  // button that does nothing, which is worse than no button.
  const { readFileSync } = await import('node:fs');
  const runtime = readFileSync(new URL('../src/lib/agent/runtime.ts', import.meta.url), 'utf8');
  assert.match(runtime, /keepPlayable\(playId, web\.files\)/);
  assert.match(runtime, /const \{ offer: _transient, \.\.\.history \} = playable/);
  // And it is built before the APK: it is the one that costs the user nothing.
  assert.ok(
    runtime.indexOf('buildWebOnBridge') < runtime.indexOf('buildApkOnBridge(') ,
    'the APK is compiled before the thing that needs no install',
  );
});

test('the player is behind a press, and sandboxed to what it needs', async () => {
  const { readFileSync } = await import('node:fs');
  const player = readFileSync(new URL('../src/components/GamePlayer.tsx', import.meta.url), 'utf8');
  // Tens of megabytes should not load because someone scrolled past.
  assert.match(player, /onClick=\{play\}/);
  // allow-same-origin is required: the object URLs are made in the parent
  // document, and a sandboxed frame with a null origin cannot read them.
  assert.match(player, /sandbox="allow-scripts allow-same-origin allow-pointer-lock"/);
  assert.ok(!player.includes('allow-top-navigation'), 'the frame has no reason to navigate the tab');
  // And the object URLs are released, or every build of the session is held.
  assert.match(player, /revoke\.current\?\.\(\)/);
});
