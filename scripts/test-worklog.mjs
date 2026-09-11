/** node --experimental-strip-types --test scripts/test-worklog.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { countLines, describeContents, describeFileWork, renderWorkLog } from '../src/lib/agent/worklog.ts';

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
