/** node --experimental-strip-types --test scripts/test-opendesign.mjs */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { pickOpenDesign, matchSystem, isDesignRequest } from '../src/lib/skills/opendesign/select.ts';
import { condense, openDesignContext, parseOd, OD_HELP } from '../src/lib/skills/opendesign/context.ts';
import { renderCatalog, renderPromptSearch } from '../src/lib/skills/opendesign/catalog.ts';

const root = new URL('../public/od/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', root), 'utf8'));
const io = {
  text: async (p) => (existsSync(new URL(p, root)) ? readFileSync(new URL(p, root), 'utf8') : null),
  json: async (p) => (existsSync(new URL(p, root)) ? JSON.parse(readFileSync(new URL(p, root), 'utf8')) : null),
};

test('the pack is complete: every indexed file exists', () => {
  for (const s of index.skills) assert.ok(existsSync(new URL(`skills/${s.id}.md`, root)), s.id);
  for (const s of index.systems) assert.ok(existsSync(new URL(`systems/${s.id}.md`, root)), s.id);
  for (const t of index.templates) assert.ok(existsSync(new URL(`templates/${t.id}.md`, root)), t.id);
  for (const c of index.craft) assert.ok(existsSync(new URL(`craft/${c.id}.md`, root)), c.id);
  assert.ok(index.skills.length > 100 && index.systems.length > 100);
});

test('a brand named in the request picks that design system', () => {
  assert.equal(pickOpenDesign('Stripe jaisa landing page banao', index).system?.id, 'stripe');
  assert.equal(pickOpenDesign('make a dashboard like Airbnb', index).system?.id, 'airbnb');
  assert.equal(pickOpenDesign('spotify style music player website', index).system?.id, 'spotify');
});

test('an ordinary style word does not pick a system by accident', () => {
  assert.equal(matchSystem('make a clean simple modern website', index.systems), null);
  assert.equal(matchSystem('I want a bold minimal portfolio', index.systems), null);
  assert.equal(matchSystem('brutalism style portfolio', index.systems)?.item.id, 'brutalism');
});

test('design work brings craft rules; code and games bring nothing', () => {
  const site = pickOpenDesign('build a landing page for my bakery', index);
  assert.ok(site.design && site.craft.includes('anti-ai-slop') && site.craft.includes('typography'));
  const game = pickOpenDesign('zombie shooter game with guns', index);
  assert.equal(game.skills.length + game.craft.length, 0);
  assert.ok(!isDesignRequest('write a python script that renames files'));
});

test('the right skill triggers for the right request, in English and Hinglish', () => {
  const ids = (q) => pickOpenDesign(q, index).skills.map((s) => s.id);
  assert.ok(ids('review my design and tell me what is wrong with the ui').includes('design-review'));
  assert.ok(ids('meri website ka ui improve karo, bahut ganda lag raha hai').includes('impeccable-design-polish'));
  assert.ok(ids('build a landing page for my bakery').includes('frontend-design'));
  assert.ok(ids('create a pitch deck for my startup').includes('frontend-slides'));
  assert.ok(ids('login page banao').includes('login-flow'));
  assert.ok(ids('animated scroll landing page with gsap').includes('gsap-scrolltrigger'));
  assert.equal(pickOpenDesign('admin analytics dashboard with charts', index).template?.id, 'dashboard');
});

test('skills that need an outside service are never injected on their own', () => {
  for (const req of ['figma design to code', 'generate image with fal upscale', 'use the browser agent to screenshot']) {
    const p = pickOpenDesign(req, index);
    for (const s of p.skills) assert.ok(!/^(fal-|figma-|agent-browser)/.test(s.id), `${req} -> ${s.id}`);
  }
});

test('the context is bounded and says what it used', async () => {
  const ctx = await openDesignContext('Stripe jaisa pricing landing page with dashboard preview', index, io);
  assert.ok(ctx);
  assert.match(ctx.text, /## DESIGN SYSTEM: Stripe/);
  assert.match(ctx.text, /## DESIGN CRAFT RULES/);
  assert.ok(ctx.text.length < 48_000, `too big: ${ctx.text.length}`);
  assert.match(ctx.summary, /Open Design/);
  assert.equal(await openDesignContext('zombie shooter game', index, io), null);
});

test('condense keeps rules and drops code fences', () => {
  const out = condense('# T\n\nlong paragraph '.padEnd(300, 'x') + '\n\n- must do this\n```\ncode()\n```\n- never that', 500);
  assert.match(out, /must do this/);
  assert.ok(!/code\(\)/.test(out));
});

test('/od commands', () => {
  assert.deepEqual(parseOd('/od'), { kind: 'help' });
  assert.equal(parseOd('hello'), null);
  assert.deepEqual(parseOd('/od list styles'), { kind: 'list', what: 'systems' });
  assert.deepEqual(parseOd('/od prompt cinematic portrait'), { kind: 'prompt', query: 'cinematic portrait' });
  assert.deepEqual(parseOd('/od design-review check my login page', index), { kind: 'use', force: { skill: 'design-review' }, task: 'check my login page' });
  assert.deepEqual(parseOd('/od style stripe pricing page', index), { kind: 'use', force: { system: 'stripe' }, task: 'pricing page' });
  assert.deepEqual(parseOd('/od stripe pricing page', index), { kind: 'use', force: { system: 'stripe' }, task: 'pricing page' });
  assert.deepEqual(parseOd('/od template dashboard expenses', index), { kind: 'use', force: { template: 'dashboard' }, task: 'expenses' });
  assert.match(OD_HELP, /\/od list/);
});

test('catalogue and prompt search read from the pack', async () => {
  assert.match(renderCatalog(index, 'all'), /Open Design is in/);
  assert.match(renderCatalog(index, 'systems'), /stripe/);
  const found = await renderPromptSearch(index, io, 'infographic stone');
  assert.match(found, /Ready prompts/);
  assert.ok(!/\{argument name/.test(found), 'blanks are filled with their defaults');
});

test('a native app gets the craft rules and the brand look, not the HTML skills', async () => {
  const ctx = await openDesignContext('expense tracker android app in Airbnb style', index, io, { native: true });
  assert.ok(ctx);
  assert.match(ctx.text, /DESIGN SYSTEM: Airbnb/);
  assert.ok(!/## SKILL:|## TEMPLATE:/.test(ctx.text));
});
