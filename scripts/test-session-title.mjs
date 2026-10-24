/** node --experimental-strip-types --test scripts/test-session-title.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { isGenericTitle, isSmallTalk, NEW_CHAT_TITLE, titleFromInput } from '../src/lib/text/session-title.ts';

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

test('a bare greeting names nothing: the chat stays "New chat"', () => {
  for (const hi of ['hi', 'Hi', 'hello', 'Hey!', 'hiii', 'yo bro', 'namaste', 'hi bro kaise ho', 'how are you', 'good morning', 'thanks', 'ok', 'test', 'kya haal hai yar']) {
    assert.equal(isSmallTalk(hi), true, hi);
    assert.equal(titleFromInput(hi), NEW_CHAT_TITLE, hi);
  }
});

test('a message with a subject is not small talk, even if it opens with a greeting', () => {
  for (const real of ['hi, fix my login bug', 'hello can you build a todo app', 'bro goa trip plan karo', 'what is photosynthesis', 'hey write a poem about rain']) {
    assert.equal(isSmallTalk(real), false, real);
    assert.notEqual(titleFromInput(real), NEW_CHAT_TITLE, real);
  }
});

test('generic model titles are recognised and rejected', () => {
  for (const t of ['Casual Greeting', 'Friendly Greeting', 'Greeting', 'Simple Greeting Exchange', 'Hello', 'Chat', 'New Conversation', 'User Greeting', 'Introduction', 'Small Talk', 'Test Message', 'Hi']) {
    assert.equal(isGenericTitle(t), true, t);
  }
  for (const t of ['Fix Login Redirect Bug', 'Goa Trip Budget', 'Python CSV Merge Script', 'Greeting Card Design']) {
    assert.equal(isGenericTitle(t), false, t);
  }
});

test('the retitle prompt no longer teaches the model "Casual Greeting", and small talk is wired in', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/lib/agent/runtime.ts', import.meta.url), 'utf8');
  assert.equal(/becomes something like "Casual Greeting"/.test(src), false);
  assert.match(src, /isSmallTalk\(m\.content\)/);
  assert.match(src, /isGenericTitle\(title\)/);
});

test('a finished run never writes the raw message over the chat title', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/lib/agent/runtime.ts', import.meta.url), 'utf8');
  for (const m of src.matchAll(/touchSession\(sessionId, \{([^}]*)\}\)/g)) {
    if (/model: selection\.model/.test(m[1])) assert.equal(/\btitle:/.test(m[1]), false, 'the end-of-run touch must not set the title');
  }
});
