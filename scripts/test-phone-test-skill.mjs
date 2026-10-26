/** node --experimental-strip-types --test scripts/test-phone-test-skill.mjs — the /phone-test skill (Google ARTEMIS) */
import assert from 'node:assert/strict';
import test from 'node:test';
import { BUILTIN_SKILLS } from '../src/lib/skills/registry.ts';

const skill = BUILTIN_SKILLS.find((s) => s.command === 'phone-test');

test('/phone-test exists once and carries the task', () => {
  assert.ok(skill);
  assert.equal(BUILTIN_SKILLS.filter((s) => s.command === 'phone-test').length, 1);
  assert.match(skill.template, /\{\{input\}\}/);
  assert.equal(skill.lane, 'B');
});

test('it names the project, its licence and how to run it, and never claims a run without a device', () => {
  assert.match(skill.template, /github\.com\/google\/artemis/);
  assert.match(skill.template, /Apache-2\.0/);
  assert.match(skill.template, /adb devices/);
  assert.match(skill.template, /uv run artemis run/);
  assert.match(skill.template, /do not pretend a run happened/i);
  assert.match(skill.template, /never print it/i);
});
