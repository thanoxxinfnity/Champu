/** node --experimental-strip-types --test scripts/test-command-blocks.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { commandCount, splitCommandBlocks } from '../src/lib/text/command-blocks.ts';

const reply = [
  'Installing now.',
  '',
  '```bash path=@terminal cwd=app',
  'npm install',
  '```',
  '```bash path=@terminal',
  'npm run build',
  '```',
  'Done, here is the file:',
  '```ts path=src/a.ts',
  'export const a = 1;',
  '```',
].join('\n');

test('commands are pulled out, prose and file blocks stay', () => {
  const segs = splitCommandBlocks(reply);
  assert.deepEqual(segs.map((s) => s.kind), ['text', 'commands', 'text']);
  assert.deepEqual(segs[1].commands, [
    { command: 'npm install', cwd: 'app', description: undefined, complete: true },
    { command: 'npm run build', cwd: undefined, description: undefined, complete: true },
  ]);
  assert.match(segs[2].text, /```ts path=src\/a\.ts/);
  assert.equal(commandCount(segs), 2);
});

test('a block still streaming is an unfinished command, not prose', () => {
  const segs = splitCommandBlocks('Working.\n```bash path=@terminal\nnpm inst');
  assert.equal(segs[1].commands[0].complete, false);
  assert.equal(segs[1].commands[0].command, 'npm inst');
});

test('a plain bash block is an example, not something that ran — unless a build runs shell blocks', () => {
  const text = 'Try this:\n```bash\nls -la\n```';
  assert.equal(commandCount(splitCommandBlocks(text)), 0);
  assert.equal(splitCommandBlocks(text)[0].kind, 'text');
  assert.equal(commandCount(splitCommandBlocks(text, { shellRuns: true })), 1);
});

test('a reply with no commands comes back as one text segment, unchanged', () => {
  const t = 'Just words.\n\n```js\nconsole.log(1)\n```';
  assert.deepEqual(splitCommandBlocks(t), [{ kind: 'text', text: t }]);
});

test('commands separated by prose make separate groups', () => {
  const t = '```bash path=@terminal\na\n```\nthen\n```bash path=@terminal\nb\n```';
  assert.deepEqual(splitCommandBlocks(t).map((s) => s.kind), ['commands', 'text', 'commands']);
});

import { matchRuns } from '../src/lib/text/command-blocks.ts';

test('each command is paired with its own run, retries in order, older runs ignored', () => {
  const run = (command, startedAt, exitCode = 0) => ({ command, exitCode, stdout: command + startedAt, stderr: '', startedAt });
  const runs = [run('old', 10), run('a', 5000), run('b', 6000), run('a', 7000, 1)];
  const cmds = [{ command: 'a', complete: true }, { command: 'b', complete: true }, { command: 'a', complete: true }, { command: 'c', complete: true }];
  const m = matchRuns(cmds, runs, 4000);
  assert.equal(m[0].startedAt, 5000);
  assert.equal(m[1].startedAt, 6000);
  assert.equal(m[2].startedAt, 7000);
  assert.equal(m[3], undefined);
  assert.equal(matchRuns([{ command: 'old', complete: true }], runs, 4000)[0], undefined);
});

test('the description in the info string travels with the command', () => {
  const segs = splitCommandBlocks('```bash path=@terminal desc="Install package dependencies" cwd=app\nnpm install\n```');
  assert.equal(segs[0].commands[0].description, 'Install package dependencies');
  assert.equal(segs[0].commands[0].cwd, 'app');
});

// ── files as activity (Claude Code-style work lines) ────────────────────────
import { activityCount, activityLabel, diffTotals, editChanges } from '../src/lib/text/command-blocks.ts';

test('file writes and edits become activity with lines added and removed', () => {
  const reply = [
    'Ab file banata hoon.',
    '```ts path=src/a.ts',
    'export const a = 1;',
    '',
    'export const b = 2;',
    '```',
    '<<<<<<< SEARCH path=src/b.ts',
    'old one',
    'old two',
    '=======',
    'new one',
    '>>>>>>> REPLACE',
    '```bash path=@terminal cwd=.',
    'npm test',
    '```',
    'Done.',
  ].join('\n');
  const segs = splitCommandBlocks(reply, { files: true });
  assert.deepEqual(segs.map((s) => s.kind), ['text', 'commands', 'text']);
  const act = segs[1];
  assert.equal(act.commands.length, 1);
  assert.deepEqual(act.files.map((f) => [f.path, f.op, f.added, f.removed]), [['src/a.ts', 'create', 2, 0], ['src/b.ts', 'edit', 1, 2]]);
  assert.equal(activityCount(segs), 3);
  assert.equal(activityLabel(act), 'Created a file, edited a file, ran a command');
  assert.deepEqual(diffTotals(act.files), { added: 3, removed: 2 });
  // without the option, nothing changes for older callers
  assert.ok(splitCommandBlocks(reply).some((s) => s.kind === 'text' && s.text.includes('path=src/a.ts')));
});

test('activity words read like a work log', () => {
  assert.equal(activityLabel({ commands: [{ command: 'node "$CHOMUGIRI_AGENT" browse open https://x.com' }, { command: 'ls' }, { command: 'npm test' }] }), 'Browsed the web, ran 2 commands');
  assert.equal(activityLabel({ commands: [], files: [{ path: 'a', op: 'create', added: 1, removed: 0, body: '', language: 'ts', complete: false }] }), 'Writing a file');
  assert.equal(activityLabel({ commands: [{ command: 'npm i' }], running: true }), 'Running a command');
  const e = editChanges('<<<<<<< SEARCH path=x.ts\n=======\nhello\n>>>>>>> REPLACE\n<<<<<<< SEARCH path=x.ts\na\n=======\nb\nc\n>>>>>>> REPLACE');
  assert.deepEqual(e.map((f) => [f.path, f.op, f.added, f.removed]), [['x.ts', 'edit', 3, 1]]);
  const open = splitCommandBlocks('```ts path=src/c.ts\nconst x = 1;\n', { files: true });
  assert.equal(open[0].files[0].complete, false);
});
