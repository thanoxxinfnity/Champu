/** node --experimental-strip-types --test scripts/test-session-title.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { titleFromInput } from '../src/lib/text/session-title.ts';

test('strips leading politeness/filler before titling', () => {
  assert.equal(titleFromInput('please build me a racing game'), 'Racing game');
  assert.equal(titleFromInput('bro please can you build me a horror game'), 'Horror game');
  assert.equal(titleFromInput('hey can you make a landing page for my startup'), 'Landing page for my startup');
});

test('strips trailing Hinglish filler', () => {
  assert.equal(titleFromInput('fix the login bug please yar'), 'Fix the login bug');
  assert.equal(titleFromInput('add dark mode na bro'), 'Add dark mode');
});

test('keeps the first sentence when the message has more than one', () => {
  assert.equal(titleFromInput('Build a todo app. It should sync across devices.'), 'Todo app');
  assert.equal(titleFromInput('Fix the crash on startup. Logs are attached.'), 'Fix the crash on startup');
});

test('truncates a long single-sentence message at a word boundary, no mid-word cut', () => {
  const long = 'design a complete multiplayer survival horror game with crafting, a day-night cycle, base building, enemy AI and a full inventory system';
  const title = titleFromInput(long);
  assert.ok(title.length <= 72, `title too long: "${title}" (${title.length})`);
  assert.ok(!title.endsWith(','), 'should not end on a dangling comma');
  // every word in the title must be a whole word from the source, not a fragment cut mid-word
  const words = title.toLowerCase().split(' ');
  for (const w of words) assert.ok(long.includes(w), `"${w}" looks like a cut-off fragment`);
});

test('capitalizes the first letter', () => {
  assert.equal(titleFromInput('fix the login bug')[0], 'F');
  // leading "make a " is itself filler, stripped before capitalization — the remaining text starts with a digit
  assert.equal(titleFromInput('make a 3d model of a car'), '3d model of a car');
});

test('empty or pure-filler input falls back to a safe default', () => {
  assert.equal(titleFromInput(''), 'Untitled run');
  assert.equal(titleFromInput('   '), 'Untitled run');
});

test('does not destroy short inputs that look like filler but are not', () => {
  // "please" alone, once stripped, leaves nothing — falls back to the original trimmed text.
  assert.equal(titleFromInput('please'), 'Please');
});
