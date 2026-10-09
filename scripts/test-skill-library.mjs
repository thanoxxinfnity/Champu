/** node --experimental-strip-types --test scripts/test-skill-library.mjs */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { pickSkills, searchSkills } from '../src/lib/skills/library/select.ts';
import { parseSkillsCommand, renderSkillsOverview, renderSkillsSearch, skillLibraryContext } from '../src/lib/skills/library/context.ts';

const root = new URL('../public/skills/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', root), 'utf8'));
const io = {
  text: async (p) => (existsSync(new URL(p, root)) ? readFileSync(new URL(p, root), 'utf8') : null),
  json: async (p) => (existsSync(new URL(p, root)) ? JSON.parse(readFileSync(new URL(p, root), 'utf8')) : null),
};
const ids = (q, o) => pickSkills(q, index, o).map((p) => p.id);

test('the library is complete and every skill file exists', () => {
  assert.ok(index.skills.length > 500);
  for (const s of index.skills) assert.ok(existsSync(new URL(`files/${s.id}.md`, root)), s.id);
  assert.deepEqual(Object.keys(index.sources).sort(), ['agentic', 'anthropic', 'superpowers']);
});

test('nothing offensive or design-duplicated came in', () => {
  for (const s of index.skills) assert.ok(!/^hunt-|pentest|exploit|jailbreak/.test(s.id), s.id);
});

test('the working-method skill comes for the situation it is for, in English and Hinglish', () => {
  assert.equal(ids('mera app crash ho raha hai NullPointerException aa raha hai')[0], 'systematic-debugging');
  assert.equal(ids('login not working, getting an error')[0], 'systematic-debugging');
  assert.equal(ids('write unit tests for my payment module')[0], 'test-driven-development');
  assert.equal(ids('do a code review of this diff')[0], 'requesting-code-review');
});

test('topic skills are found by the thing the request is about', () => {
  assert.ok(ids('optimize my slow sql queries').includes('sql-optimization-patterns'));
  assert.ok(ids('docker compose for node app with redis').includes('docker-compose'));
  assert.ok(ids('add caching with redis to my express server').includes('redis'));
  assert.ok(ids('kotlin coroutines flow in my android viewmodel').includes('kotlin-coroutines-expert'));
  assert.ok(ids('set up github actions CI pipeline').includes('github-actions'));
});

test('a request that is not about any of them brings nothing', () => {
  assert.deepEqual(ids('make me a nice poster'), []);
  assert.deepEqual(ids('hello how are you'), []);
});

test('naming a skill forces it', () => {
  assert.deepEqual(ids('anything', { force: ['redis'] }), ['redis']);
});

test('the context says why, names the source, and is bounded', async () => {
  const ctx = await skillLibraryContext('my app crashes with a traceback', index, io);
  assert.ok(ctx);
  assert.match(ctx.text, /SKILL: systematic-debugging \(obra\/superpowers\)/);
  assert.match(ctx.summary, /systematic-debugging/);
  assert.ok(ctx.text.length < 20_000);
  assert.equal(await skillLibraryContext('hello there', index, io), null);
});

test('/skills and /use commands', () => {
  assert.deepEqual(parseSkillsCommand('/skills'), { kind: 'overview' });
  assert.deepEqual(parseSkillsCommand('/skills redis caching'), { kind: 'search', query: 'redis caching' });
  assert.deepEqual(parseSkillsCommand('/skills auto off'), { kind: 'auto', on: false });
  assert.deepEqual(parseSkillsCommand('/skills auto'), { kind: 'auto', on: null });
  assert.deepEqual(parseSkillsCommand('/use redis add a cache', index), { kind: 'use', id: 'redis', task: 'add a cache' });
  assert.deepEqual(parseSkillsCommand('/use nonsense-skill words', index), { kind: 'search', query: 'nonsense-skill words' });
  assert.equal(parseSkillsCommand('/od list'), null);
});

test('the overview and search read from the library', () => {
  assert.match(renderSkillsOverview(index, { skills: 163, systems: 152 }, true), /Automatic use is \*\*on\*\*/);
  assert.match(renderSkillsSearch(index, 'redis'), /`redis`/);
  assert.ok(searchSkills('postgres', index).some((s) => s.id.includes('postgres')));
});

test('a method skill and a topic skill come together, one does not push the other out', () => {
  const got = ids('add redis caching to my express api, the server crashes with ECONNREFUSED when redis is down');
  assert.equal(got[0], 'systematic-debugging');
  assert.ok(got.includes('redis'), got.join(','));
  assert.equal(got.length, 2);
});
