/** node --experimental-strip-types --test scripts/test-skill-icons.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { SKILL_ICON_NAMES, iconKey, iconSvg } from '../src/lib/skills/icons.ts';
import { BUILTIN_SKILLS, parseGeneratedSkill } from '../src/lib/skills/registry.ts';
import { renderMarkdown } from '../src/components/markdown.ts';

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

test('every built-in skill has a drawn icon, none is an emoji', () => {
  for (const s of BUILTIN_SKILLS) {
    assert.ok(SKILL_ICON_NAMES.includes(s.icon), `${s.command}: ${s.icon}`);
    assert.ok(!EMOJI.test(s.icon));
  }
});

test('an icon an older version saved as an emoji is drawn as its equivalent, unknown values get the default', () => {
  assert.equal(iconKey('📚'), 'books');
  assert.equal(iconKey('🎨'), 'palette');
  assert.equal(iconKey('palette'), 'palette');
  assert.equal(iconKey('🦄'), 'spark');
  assert.equal(iconKey(undefined), 'spark');
  assert.match(iconSvg('rocket'), /^<svg /);
});

test('a skill the model authors with an emoji icon is stored with a drawn one', () => {
  const skill = parseGeneratedSkill(JSON.stringify({ command: 'x-test', name: 'X', description: 'd', icon: '🚀', lane: 'B', template: 'do {{input}}' }));
  assert.equal(skill?.icon, 'rocket');
  const none = parseGeneratedSkill(JSON.stringify({ command: 'y-test', name: 'Y', template: 'do {{input}}' }));
  assert.equal(none?.icon, 'wand');
});

test('chat notes draw ::name:: as an icon and leave other text alone', () => {
  const html = renderMarkdown('::books:: Skill — using redis. ::nope:: stays');
  assert.match(html, /<svg class="ico"/);
  assert.match(html, /::nope::/);
  assert.ok(!EMOJI.test(html));
});
