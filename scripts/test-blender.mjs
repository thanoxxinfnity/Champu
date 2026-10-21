/** node --experimental-strip-types --test scripts/test-blender.mjs — the bridge's live Blender (Blender MCP servers) and the skills that use it. */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { BLENDER_SERVERS, createBlender, explainBlenderError, parseBlender } from '../agent/blender.mjs';
import { BUILTIN_SKILLS } from '../src/lib/skills/registry.ts';

test('words on the command line become one Blender tool call, on the basic or the pro server', () => {
  assert.deepEqual(parseBlender(['scene']), { server: 'basic', tool: 'get_scene_info', args: {} });
  assert.deepEqual(parseBlender(['scene', '--pro']), { server: 'pro', tool: 'blender_scene_info', args: {} });
  assert.deepEqual(parseBlender(['run', 'import', 'bpy;', 'print(1)']), { server: 'basic', tool: 'execute_blender_code', args: { code: 'import bpy; print(1)' } });
  assert.deepEqual(parseBlender(['run', 'print(2)', '--pro']), { server: 'pro', tool: 'blender_execute_script', args: { script: 'print(2)' } });
  assert.deepEqual(parseBlender(['blender_export_gltf', '{"filepath":"/tmp/a.glb"}', '--pro']), { server: 'pro', tool: 'blender_export_gltf', args: { filepath: '/tmp/a.glb' } });
  assert.equal(parseBlender([]).local, 'help');
  assert.equal(parseBlender(['tools', '--pro']).local, 'tools');
  assert.equal(parseBlender(['addon']).local, 'addon');
});

test('a wrong command says what to type instead', () => {
  assert.match(parseBlender(['run']).error, /usage: blender run/);
  assert.match(parseBlender(['get_object_info', 'not json']).error, /JSON/);
  assert.match(parseBlender(['Fly!']).error, /unknown blender command/);
});

test('both servers are pinned to a commit, and the basic one to the mcp 1.x it was written for', () => {
  for (const s of Object.values(BLENDER_SERVERS)) assert.ok(s.args.some((a) => /@[0-9a-f]{40}$/.test(a)), s.repo);
  assert.ok(BLENDER_SERVERS.basic.args.includes('mcp[cli]==1.3.0'));
  assert.ok(BLENDER_SERVERS.pro.args.every((a) => !/RFingAdam.*\.py$/.test(a)), 'the AGPL server runs as its own program');
});

test('calls go to the right server, one at a time', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bl-'));
  const fake = path.join(dir, 'fake-mcp.mjs');
  writeFileSync(fake, `
    let n = 0;
    process.stdin.setEncoding('utf8'); let buf = '';
    process.stdin.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (!l.trim()) continue; const m = JSON.parse(l);
      if (m.id == null) continue;
      if (m.method === 'initialize') send(m.id, { protocolVersion: '2024-11-05', serverInfo: { name: 'fake' }, capabilities: {} });
      else if (m.method === 'tools/list') send(m.id, { tools: [{ name: 'get_scene_info', description: 'Scene' }] });
      else send(m.id, { content: [{ type: 'text', text: 'call ' + (++n) + ' ' + m.params.name + ' ' + JSON.stringify(m.params.arguments) }] }); } });
    function send(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n'); }
  `);
  const b = createBlender({ outDir: dir, spawnSpec: { command: process.execPath, args: [fake] } });
  try {
    const [a, c] = await Promise.all([b.call('basic', 'get_scene_info', {}), b.call('basic', 'execute_blender_code', { code: 'x=1' })]);
    assert.match(a.text, /call 1 get_scene_info/);
    assert.match(c.text, /call 2 execute_blender_code \{"code":"x=1"\}/);
    assert.equal((await b.tools('basic'))[0].name, 'get_scene_info');
    await assert.rejects(b.call('nope', 'x', {}), /unknown Blender server/);
  } finally { b.close(); }
});

test('a closed Blender or a missing uv is explained with what to do', () => {
  assert.match(explainBlenderError('Could not connect to Blender. Make sure the Blender addon is running.'), /open Blender and start the basic addon/);
  assert.match(explainBlenderError('[Errno 111] Connection refused', 'pro'), /releases/);
  assert.match(explainBlenderError('could not start uvx: spawn uvx ENOENT'), /astral\.sh\/uv/);
});

test('the bridge answers /v1/blender and the agent runs `blender …` as a client', () => {
  const src = readFileSync(new URL('../agent/chomugiri-agent.mjs', import.meta.url), 'utf8');
  assert.match(src, /routes\['POST \/v1\/blender'\]/);
  assert.match(src, /process\.argv\[2\] === 'blender'/);
  assert.match(src, /blender\.close\(\)/);
});

test('the app offers /blender (live Blender) and /blender-3d (image to game asset, pinned skill)', () => {
  const live = BUILTIN_SKILLS.find((s) => s.command === 'blender');
  const img = BUILTIN_SKILLS.find((s) => s.command === 'blender-3d');
  assert.ok(live && img);
  assert.match(live.template, /blender scene/);
  assert.match(live.template, /not reachable/);
  assert.match(img.template, /majidmanzarpour\/blender-game-skills/);
  assert.match(img.template, /checkout [0-9a-f]{40}/);
  assert.match(img.template, /\{\{files\}\}/);
});
