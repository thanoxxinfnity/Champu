/** node --experimental-strip-types --test scripts/test-progress.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { advancePlan, NO_EVIDENCE, settleRemaining, statusFor } from '../src/lib/agent/progress.ts';

const plan = (kinds) => ({
  goal: 'g',
  tasks: kinds.map((kind, i) => ({ id: `t${i}`, title: kind, kind, status: 'pending' })),
});

test('nothing is ticked without evidence', () => {
  for (const kind of ['analysis', 'codegen', 'export', 'terminal', 'deploy', 'verify']) {
    assert.equal(statusFor(kind, NO_EVIDENCE), null, kind);
  }
});

test('analysis needs a substantive answer, not a token', () => {
  assert.equal(statusFor('analysis', { ...NO_EVIDENCE, answerChars: 12 }), null);
  assert.equal(statusFor('analysis', { ...NO_EVIDENCE, answerChars: 500 }), 'completed');
});

test('codegen ticks on files, export only on an actual artifact', () => {
  assert.equal(statusFor('codegen', { ...NO_EVIDENCE, filesWritten: 3 }), 'completed');
  // Files without an archive is not a finished export.
  assert.equal(statusFor('export', { ...NO_EVIDENCE, filesWritten: 3 }), null);
  assert.equal(statusFor('export', { ...NO_EVIDENCE, artifactProduced: true }), 'completed');
});

test('a failed command fails its step, and a clean one completes it', () => {
  assert.equal(statusFor('terminal', { ...NO_EVIDENCE, commandsRun: 2 }), 'completed');
  assert.equal(statusFor('build', { ...NO_EVIDENCE, commandsRun: 2, commandsFailed: 1 }), 'failed');
});

test('verify is the last to claim anything', () => {
  assert.equal(statusFor('verify', { ...NO_EVIDENCE, failed: true }), 'failed');
  assert.equal(statusFor('verify', NO_EVIDENCE), null, 'a run that did nothing verifies nothing');
  assert.equal(statusFor('verify', { ...NO_EVIDENCE, filesWritten: 1 }), 'completed');
});

test('a settled task is never overwritten by evidence', () => {
  const p = { goal: 'g', tasks: [{ id: 'a', title: 'x', kind: 'codegen', status: 'failed' }, { id: 'b', title: 'y', kind: 'codegen', status: 'blocked' }] };
  const out = advancePlan(p, { ...NO_EVIDENCE, filesWritten: 5 });
  assert.deepEqual(out.tasks.map((t) => t.status), ['failed', 'blocked']);
});

test('a real run ticks the steps it actually did', () => {
  const out = advancePlan(plan(['analysis', 'codegen', 'export', 'verify']), {
    ...NO_EVIDENCE,
    answerChars: 900,
    filesWritten: 4,
    artifactProduced: true,
  });
  assert.deepEqual(out.tasks.map((t) => t.status), ['completed', 'completed', 'completed', 'completed']);
});

test('steps with no evidence are marked skipped, never claimed as done', () => {
  const evidence = { ...NO_EVIDENCE, answerChars: 900 };
  const out = settleRemaining(advancePlan(plan(['analysis', 'terminal', 'deploy']), evidence), evidence);
  assert.deepEqual(out.tasks.map((t) => t.status), ['completed', 'skipped', 'skipped']);
  assert.ok(out.tasks[1].detail?.includes('nothing in this run required it'));
});

test('a failed run leaves its remaining steps alone rather than tidying them away', () => {
  const evidence = { ...NO_EVIDENCE, failed: true };
  const out = settleRemaining(plan(['analysis', 'codegen']), evidence);
  assert.deepEqual(out.tasks.map((t) => t.status), ['pending', 'pending']);
});
