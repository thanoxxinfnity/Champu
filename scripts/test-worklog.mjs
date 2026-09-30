/** node --experimental-strip-types --test scripts/test-worklog.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { countLines, describeContents, describeFileWork, renderCommandLog, renderWorkLog } from '../src/lib/agent/worklog.ts';

const file = (path, language, content) => ({ kind: 'file', path, language, content, complete: true, bytes: content.length });

test('line counting does not invent a trailing line', () => {
  assert.equal(countLines('a\nb\nc'), 3);
  assert.equal(countLines('a\nb\nc\n'), 3);
  assert.equal(countLines(''), 0);
});

test('a TypeScript file is described by what it exports', () => {
  const src = 'export function parse(x: string) {}\nexport const LIMIT = 4;\nexport class Store {}\n';
  assert.equal(describeContents('src/a.ts', 'ts', src), 'exports parse, LIMIT and Store');
});

test('a file with no exports falls back to what it defines', () => {
  assert.equal(describeContents('x.js', 'js', 'function helper() {}\n'), 'defines helper');
});

test('Kotlin is described by its types', () => {
  const src = 'class HttpServer {\n  fun start() {}\n  fun stop() {}\n}\n';
  assert.equal(describeContents('S.kt', 'kt', src), 'defines HttpServer with 2 functions');
});

test('long symbol lists are truncated rather than dumped', () => {
  const src = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => `export const ${n} = 1;`).join('\n');
  const out = describeContents('x.ts', 'ts', src);
  assert.ok(out.includes('(+2 more)'), out);
});

test('created versus updated is decided against the workspace, not guessed', () => {
  const previous = new Map([['src/a.ts', file('src/a.ts', 'ts', 'export const a = 1;\n')]]);
  const changes = describeFileWork(
    [file('src/a.ts', 'ts', 'export const a = 1;\nexport const b = 2;\n'), file('src/b.ts', 'ts', 'export const c = 3;\n')],
    previous,
  );
  assert.equal(changes[0].action, 'updated');
  assert.equal(changes[0].delta, 1, 'net line change on an existing file');
  assert.equal(changes[1].action, 'created');
  assert.equal(changes[1].delta, 0, 'a new file has no delta to report');
});

test('the report names each file and what is in it', () => {
  const out = renderWorkLog(
    describeFileWork([file('src/auth.ts', 'ts', 'export function login() {}\n')], new Map()),
    [{ kind: 'command', command: 'npm test', cwd: 'app', complete: true }],
  );
  assert.ok(out.includes('**Created** `src/auth.ts`'), out);
  assert.ok(out.includes('exports login'), out);
  assert.ok(out.includes('1 line'), out);
  assert.ok(out.includes('npm test'), out);
  assert.ok(out.includes('in `app`'), out);
});

test('nothing to report produces nothing, not an empty heading', () => {
  assert.equal(renderWorkLog([], []), '');
});

test('malformed JSON is described without throwing', () => {
  assert.equal(describeContents('d.json', 'json', '{not json'), 'JSON data');
  assert.equal(describeContents('d.json', 'json', '{"a":1,"b":2}'), 'keys a and b');
});

// ── What each command actually did ──────────────────────────────────────────

test('a run where every command passed says so in one line', () => {
  const out = renderCommandLog([
    { command: 'npm install', ok: true, exitCode: 0, durationMs: 12_300 },
    { command: 'npm run build', ok: true, exitCode: 0, durationMs: 8_100 },
  ]);
  assert.match(out, /Commands run\*\* — 2 — all passed/);
  assert.match(out, /✔ exit 0 — `npm install` · 12\.3s/);
  assert.ok(!out.includes('```'), 'no error block when nothing failed');
});

test('a failed command shows its exit code and the real error text', () => {
  const out = renderCommandLog([
    { command: 'gradle assembleRelease', ok: false, exitCode: 1, durationMs: 4_000, errorExcerpt: "error: resource mipmap/ic_launcher not found\nBUILD FAILED" },
  ]);
  assert.match(out, /1 failed/);
  assert.match(out, /✘ exit 1 — `gradle assembleRelease`/);
  assert.match(out, /resource mipmap\/ic_launcher not found/);
  assert.match(out, /BUILD FAILED/);
});

test('only the tail of a huge error is kept — the cause is at the end', () => {
  const noise = 'x'.repeat(5000);
  const out = renderCommandLog([
    { command: 'build', ok: false, exitCode: 2, errorExcerpt: `${noise}\nTHE REAL ERROR` },
  ]);
  assert.match(out, /THE REAL ERROR/);
  assert.ok(out.length < 2000);
});

test('a command parked because the bridge is offline is not reported as run', () => {
  assert.equal(
    renderCommandLog([{ command: 'npm test', ok: false, exitCode: null, skipped: 'offline' }]),
    '',
  );
  const mixed = renderCommandLog([
    { command: 'npm test', ok: false, exitCode: null, skipped: 'offline' },
    { command: 'ls', ok: true, exitCode: 0 },
  ]);
  assert.match(mixed, /Commands run\*\* — 1 — all passed/);
});

test('a banned command reads as blocked, not as a failure with an exit code', () => {
  const out = renderCommandLog([{ command: 'rm -rf /', ok: false, exitCode: null, skipped: 'banned' }]);
  assert.match(out, /⛔ blocked — `rm -rf \/`/);
});

test('nothing run produces nothing', () => {
  assert.equal(renderCommandLog([]), '');
});
