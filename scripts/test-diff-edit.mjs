/** node --experimental-strip-types --test scripts/test-diff-edit.mjs — search/replace edits. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEdit, applyEdits, parseEdits, stripEdits } from '../src/lib/agent/diff-edit.ts';

const FILE = ['export function add(a, b) {', '  return a + b;', '}', '', 'export function mul(a, b) {', '  return a * b;', '}', ''].join('\n');

test('parses a block with the path on the marker, in a fence, or on the line before', () => {
  const body = '<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE';
  assert.deepEqual(parseEdits(`<<<<<<< SEARCH path=src/a.ts\nold\n=======\nnew\n>>>>>>> REPLACE`), [{ path: 'src/a.ts', search: 'old', replace: 'new' }]);
  assert.equal(parseEdits('```diff path=src/b.ts\n' + body + '\n```')[0].path, 'src/b.ts');
  assert.equal(parseEdits('`src/c.ts`\n' + body)[0].path, 'src/c.ts');
  assert.deepEqual(parseEdits(body), [], 'a block with no file name is not an edit');
});

test('several blocks, and one still streaming is not an edit yet', () => {
  const t = '```ts path=a.ts\n<<<<<<< SEARCH\n1\n=======\n2\n>>>>>>> REPLACE\n<<<<<<< SEARCH\n3\n=======\n4\n>>>>>>> REPLACE\n```\ntext\n<<<<<<< SEARCH path=b.ts\nx\n=======\ny';
  const e = parseEdits(t);
  assert.equal(e.length, 2);
  assert.deepEqual(e.map((x) => x.replace), ['2', '4']);
});

test('an exact edit changes only the named lines', () => {
  const r = applyEdit(FILE, { path: 'a.ts', search: '  return a * b;', replace: '  return Math.imul(a, b);' });
  assert.equal(r.ok, true);
  assert.equal(r.how, 'exact');
  assert.equal(r.content, FILE.replace('a * b', 'Math.imul(a, b)'));
});

test('a SEARCH that matches twice is refused with a hint, one that matches nowhere says so', () => {
  const twice = applyEdit('x\nfoo\nx\nfoo\n', { path: 'a', search: 'foo', replace: 'bar' });
  assert.equal(twice.ok, false);
  assert.match(twice.error, /matches 2 places/);
  const none = applyEdit(FILE, { path: 'a.ts', search: 'return a / b;', replace: 'x' });
  assert.equal(none.ok, false);
  assert.match(none.error, /not found/);
});

test('trailing spaces and a wrong constant indent are forgiven, and the replacement is re-indented', () => {
  const spaced = applyEdit('if (a) {   \n  go();\n}\n', { path: 'a', search: 'if (a) {\n  go();\n}', replace: 'if (a) {\n  stop();\n}' });
  assert.equal(spaced.how, 'trailing-space');
  assert.equal(spaced.content, 'if (a) {\n  stop();\n}\n');
  const file = 'class A {\n    run() {\n        go();\n    }\n}\n';
  const r = applyEdit(file, { path: 'a', search: 'run() {\n    go();\n}', replace: 'run() {\n    go();\n    stop();\n}' });
  assert.equal(r.how, 'indent');
  assert.equal(r.content, 'class A {\n    run() {\n        go();\n        stop();\n    }\n}\n');
});

test('an empty SEARCH creates a file, but never overwrites one', () => {
  assert.deepEqual(applyEdit(undefined, { path: 'n.ts', search: '', replace: 'hi' }), { path: 'n.ts', ok: true, content: 'hi', how: 'create' });
  assert.equal(applyEdit('old', { path: 'n.ts', search: '', replace: 'hi' }).ok, false);
});

test('CRLF files stay CRLF', () => {
  const r = applyEdit('a\r\nb\r\nc\r\n', { path: 'a', search: 'b', replace: 'B' });
  assert.equal(r.content, 'a\r\nB\r\nc\r\n');
});

test('a list of edits runs in order over a map, and a failure leaves the rest applied', () => {
  const { files, results } = applyEdits(new Map([['a.ts', FILE]]), [
    { path: 'a.ts', search: 'a + b', replace: 'a - b' },
    { path: 'a.ts', search: 'nope', replace: 'x' },
    { path: 'b.ts', search: '', replace: 'new file' },
  ]);
  assert.deepEqual(results.map((r) => r.ok), [true, false, true]);
  assert.match(files.get('a.ts'), /a - b/);
  assert.equal(files.get('b.ts'), 'new file');
});

test('edit blocks are cut out of prose', () => {
  const t = 'Fixing it.\n<<<<<<< SEARCH path=a.ts\nx\n=======\ny\n>>>>>>> REPLACE\nDone.';
  assert.equal(stripEdits(t), 'Fixing it.\nDone.');
});

import { readFileSync } from 'node:fs';

test('the runtime applies edit blocks after a reply and in the self-heal loop, and the prompt teaches the format', () => {
  const rt = readFileSync(new URL('../src/lib/agent/runtime.ts', import.meta.url), 'utf8');
  assert.match(rt, /applyReplyEdits\(result\.content/);
  assert.match(rt, /applyReplyEdits\(answer\.content/);
  assert.match(rt, /projectView\(files/);
  assert.match(rt, /repoMap:/);
  assert.match(rt, /self-heal \$\{turn \+ 1\}\/\$\{maxTurns\}/);
  const sp = readFileSync(new URL('../src/lib/agent/system-prompt.ts', import.meta.url), 'utf8');
  assert.match(sp, /<<<<<<< SEARCH path=/);
  assert.match(sp, /## PROJECT MAP/);
});
