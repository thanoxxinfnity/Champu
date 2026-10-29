/** node --experimental-strip-types --test scripts/test-memory.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { LESSON_SYSTEM, addMemories, captureInput, findToForget, formatLessons, formatMemory, isCorrection, lessonInput, looksSecret, makeMemory, parseMemory, parseObservations, prune, recall, renderList, worthCapturing } from '../src/lib/memory/memory.ts';

const mem = (text, o = {}) => makeMemory({ text, kind: o.kind ?? 'fact', tags: o.tags ?? [] }, { now: o.now ?? 1_000, pinned: o.pinned });

test('a secret is never kept', () => {
  assert.equal(looksSecret('my token is vcp_abcdefghijklmnop1234'), true);
  assert.equal(looksSecret('password: hunter2hunter2'), true);
  assert.equal(looksSecret('nvapi-abcdefghijklmnopqrstuv'), true);
  assert.equal(looksSecret('I like Hinglish replies and short answers'), false);
  assert.equal(mem('api key is sk-abcdefghijklmnop12345'), null);
  assert.equal(mem('ok'), null);
});

test('plain words are understood as remember / forget, in English and Hinglish', () => {
  assert.deepEqual(parseMemory('yaad rakho: mujhe Hinglish mein jawab chahiye'), { kind: 'add', text: 'mujhe Hinglish mein jawab chahiye', natural: true });
  assert.deepEqual(parseMemory('Remember that my app is called Chai Time'), { kind: 'add', text: 'my app is called Chai Time', natural: true });
  assert.deepEqual(parseMemory('bhool jao chai time wali baat'), { kind: 'forget', query: 'chai time wali baat', natural: true });
  assert.deepEqual(parseMemory('/memory'), { kind: 'list', query: '' });
  assert.deepEqual(parseMemory('/memory off'), { kind: 'toggle', on: false });
  assert.deepEqual(parseMemory('/memory add use tabs not spaces'), { kind: 'add', text: 'use tabs not spaces', natural: false });
  assert.deepEqual(parseMemory('/memory chai'), { kind: 'list', query: 'chai' });
  assert.equal(parseMemory('build me a chai app and remember nothing'), null);
  assert.equal(parseMemory('I remember when we built that app'), null);
});

test('what is relevant comes back, what is not stays out, preferences always come', () => {
  const list = [
    mem('The user wants replies in Hinglish', { kind: 'preference', now: 5 }),
    mem('The Chai Time app is Kotlin with Jetpack Compose, package com.chai.time', { tags: ['kotlin', 'android'] }),
    mem('Godot export needs the templates installed at ~/.local/share/godot', { tags: ['godot'] }),
    mem('Pizza place website uses a red and cream palette', { tags: ['website'] }),
  ];
  const got = recall(list, 'fix the crash in my Chai Time Kotlin app').map((m) => m.text);
  assert.ok(got.some((t) => /Chai Time app is Kotlin/.test(t)));
  assert.ok(got.some((t) => /Hinglish/.test(t)), 'standing preference');
  assert.ok(!got.some((t) => /Godot|Pizza/.test(t)));
  assert.deepEqual(recall([], 'anything'), []);
  assert.ok(recall(list, 'export my godot game to apk').some((m) => /Godot export/.test(m.text)));
});

test('the section for the prompt is bounded and says to use it quietly', () => {
  const big = Array.from({ length: 30 }, (_, i) => mem(`fact number ${i} about the chai project and kotlin things ${'x'.repeat(150)}`, { kind: 'fact' }));
  const out = recall(big, 'chai kotlin project', { limit: 30 });
  assert.ok(out.join('').length < 1800 + out.length * 250);
  assert.match(formatMemory(out), /do not recite/);
  assert.equal(formatMemory([]), '');
});

test('the same thing said twice is one memory; the list is bounded and keeps what was pinned', () => {
  const a = mem('The user prefers short answers with no filler');
  const { list, added, merged } = addMemories([a], [mem('The user prefers short answers, no filler')]);
  assert.equal(list.length, 1); assert.equal(added.length, 0); assert.equal(merged, 1);
  const many = Array.from({ length: 12 }, (_, i) => mem(`unrelated note ${i} alpha${i}`, { now: i }));
  const pinned = mem('pinned fact stays forever', { pinned: true, now: 0 });
  const kept = prune([pinned, ...many], 5);
  assert.equal(kept.length, 5);
  assert.ok(kept.some((m) => m.id === pinned.id));
});

test('forgetting finds the memory by words or by id, and a vague phrase finds nothing', () => {
  const a = mem('The Chai Time app uses Kotlin'); const b = mem('Pizza site is red and cream');
  assert.deepEqual(findToForget([a, b], 'chai time').map((m) => m.id), [a.id]);
  assert.deepEqual(findToForget([a, b], b.id).map((m) => m.id), [b.id]);
  assert.deepEqual(findToForget([a, b], 'the').map((m) => m.id), []);
  assert.match(renderList([a, b], 'pizza'), /Pizza/);
  assert.match(renderList([], ''), /Nothing remembered/);
});

test('what the model says it noticed is parsed defensively', () => {
  const got = parseObservations('Sure!\n[{"kind":"preference","text":"Prefers Hinglish replies","tags":["style"]},{"kind":"weird","text":"Uses Kotlin for the Chai app"},{"text":"my token is vcp_abcdefghijklmnop1234"},{"nope":1}]');
  assert.equal(got.length, 2);
  assert.equal(got[0].kind, 'preference'); assert.equal(got[1].kind, 'fact');
  assert.deepEqual(parseObservations('no json here'), []);
  assert.deepEqual(parseObservations('[not json]'), []);
  assert.ok(captureInput({ request: 'build x', outcome: 'done', files: ['a.kt'] }).includes('FILES WRITTEN: a.kt'));
});

test('only real work is worth a second model call', () => {
  assert.equal(worthCapturing('hi', 'hello there'), false);
  assert.equal(worthCapturing('/memory list', 'x'.repeat(200)), false);
  assert.equal(worthCapturing('build me a chai ordering app in kotlin', 'Built the project with 12 files and an APK. '.repeat(3)), true);
});

test('a mistake becomes a lesson that is in EVERY later prompt, not only when the request resembles it', () => {
  assert.deepEqual(parseMemory('/lesson never overwrite the saved game files'), { kind: 'add', text: 'never overwrite the saved game files', natural: false, lesson: true });
  assert.deepEqual(parseMemory('galti yaad rakho: models ko bina dekhe publish mat karna'), { kind: 'add', text: 'models ko bina dekhe publish mat karna', natural: true, lesson: true });
  assert.deepEqual(parseMemory('/lessons'), { kind: 'list', query: 'lesson' });
  const list = [mem('Never publish a 3D model without rendering it first', { kind: 'lesson', now: 9, pinned: true }), mem('Pizza site uses red', { now: 8 }), mem('Always run the tests before saying done', { kind: 'lesson', now: 7 })];
  const block = formatLessons(list);
  assert.match(block, /Never repeat them/);
  assert.match(block, /rendering it first/); assert.match(block, /run the tests/); assert.ok(!/Pizza/.test(block));
  assert.equal(formatLessons([mem('Pizza site uses red')]), '');
  assert.ok(formatLessons(Array.from({ length: 40 }, (_, i) => mem(`Never repeat mistake number ${i}`, { kind: 'lesson', now: i }))).split('\n').length <= 18);
});

test('a complaint is recognised as a correction, an ordinary request is not', () => {
  for (const t of ['ye galat hai, phir se wahi galti ki', 'buttons still not working bro', 'you broke the loading screen again', 'maine kaha tha holes nahi chahiye', 'kaam nahi kar raha yaar']) assert.equal(isCorrection(t), true, t);
  for (const t of ['build me a chai ordering app', 'add a dark mode toggle to settings', 'thanks, looks great', 'hi']) assert.equal(isCorrection(t), false, t);
  assert.match(LESSON_SYSTEM, /Never/); assert.match(lessonInput({ before: 'a', correction: 'b', after: 'c' }), /CORRECTION/);
});
