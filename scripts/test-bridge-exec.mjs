/** node --experimental-strip-types --test scripts/test-bridge-exec.mjs */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';

const PORT = 7790 + Math.floor(Math.random() * 100);
const TOKEN = 'test-token';

async function withAgent(fn) {
  const child = spawn('node', ['agent/chomugiri-agent.mjs', '--port', String(PORT), '--workspace', '/tmp/bridge-exec-test', '--token', TOKEN], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 40; i++) {
      try { if ((await fetch(`http://127.0.0.1:${PORT}/v1/ping`)).ok) break; } catch {}
      await new Promise((r) => setTimeout(r, 150));
    }
    await fn();
  } finally { child.kill(); }
}

async function run(cmd) {
  const h = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
  const { execId } = await (await fetch(`http://127.0.0.1:${PORT}/v1/exec`, { method: 'POST', headers: h, body: JSON.stringify({ cmd, cwd: '.' }) })).json();
  const text = await (await fetch(`http://127.0.0.1:${PORT}/v1/stream/${execId}`, { headers: h })).text();
  const exit = [...text.matchAll(/"exitCode":(-?\d+|null)/g)].pop()?.[1];
  return Number(exit);
}

test('a failing command piped into tail still fails (pipefail)', async () => {
  await withAgent(async () => {
    assert.equal(await run('false | tail -1'), 1);
    assert.equal(await run('true | tail -1'), 0);
  });
});

test('toolchain versions skip banner noise instead of reporting it as the version', async () => {
  await withAgent(async () => {
    const h = { Authorization: `Bearer ${TOKEN}` };
    const { toolchains } = await (await fetch(`http://127.0.0.1:${PORT}/v1/health`, { headers: h })).json();
    for (const [name, v] of Object.entries(toolchains)) {
      if (typeof v === 'string' && ['java', 'gradle', 'node', 'git'].includes(name)) {
        assert.ok(!/^Picked up|^-+$/.test(v), `${name}: ${v}`);
      }
    }
  });
});
