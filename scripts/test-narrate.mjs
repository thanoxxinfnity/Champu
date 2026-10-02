/** node --experimental-strip-types --test scripts/test-narrate.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { describeCommand, openingPhrase, streamingPhrase } from '../src/lib/agent/narrate.ts';

test('the opening line is plain and says what is true', () => {
  assert.equal(openingPhrase('A'), 'Thinking…');
  assert.equal(openingPhrase('B'), 'Reading your request…');
});

test('a file being written is named; a finished one is not', () => {
  const open = 'Creating `index.html`.\n```html path=index.html\n<p>hi';
  assert.equal(streamingPhrase(open, 'B'), 'Writing index.html…');
  const done = `${open}</p>\n\`\`\`\n\nNow the styles.`;
  assert.equal(streamingPhrase(done, 'B'), 'Writing the answer…');
  const second = `${done}\n\`\`\`css path=src/styles/site.css\nbody{`;
  assert.equal(streamingPhrase(second, 'B'), 'Writing src/styles/site.css…');
  // A plain answer never claims to be writing files.
  assert.equal(streamingPhrase(open, 'A'), 'Writing the answer…');
});

test('a very long path is shortened from the front, keeping the file name', () => {
  const p = `a/${'deep/'.repeat(20)}main.gd`;
  const phrase = streamingPhrase(`\`\`\`gdscript path=${p}\nx`, 'B');
  assert.ok(phrase.length < 60 && phrase.endsWith('main.gd…'), phrase);
});

test('commands are described in plain words', () => {
  assert.equal(describeCommand('vercel --prod --yes'), 'Deploying to Vercel…');
  assert.equal(describeCommand('cd app && gradle assembleDebug'), 'Building the Android app…');
  assert.equal(describeCommand('npm install'), 'Installing packages…');
  assert.equal(describeCommand('npm run build'), 'Building the site…');
  assert.equal(describeCommand('godot --headless --export-release Android out.apk'), 'Exporting the Godot project…');
  assert.equal(describeCommand('ls -la'), 'Running ls -la…');
});

test('a token in a command never reaches the bubble', () => {
  const token = 'vcp_8F76abcdefghijklmnopqrstuvwxyz0123456789ABCD';
  for (const cmd of [`vercel --prod --yes --token ${token}`, `echo ${token} > x && cat x`, `curl -H "Authorization: Bearer ${token}" https://x.test`]) {
    assert.ok(!describeCommand(cmd).includes(token), cmd);
  }
  assert.ok(!describeCommand('some-tool --token abc123secretvalue').includes('abc123secretvalue'));
});
