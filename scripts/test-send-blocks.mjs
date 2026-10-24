/** node --experimental-strip-types --test scripts/test-send-blocks.mjs — pictures and files the assistant sends. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { baseName, dataUrlOf, isImageMime, mimeFor, parseSendBlocks, stripSendBlocks, textToBase64 } from '../src/lib/text/send-blocks.ts';

const REPLY = 'Here you go.\n\n```send\nout/logo.png | The new logo\n- dist/app.apk\nhttps://example.com/p.jpg | A photo\n/etc/passwd\n../secret.txt\n```\n\nAnd a command:\n```bash path=@terminal\nls\n```';

test('items come from the block: path, caption, links; absolute and parent paths are refused', () => {
  assert.deepEqual(parseSendBlocks(REPLY), [
    { source: 'out/logo.png', caption: 'The new logo', url: false },
    { source: 'dist/app.apk', caption: undefined, url: false },
    { source: 'https://example.com/p.jpg', caption: 'A photo', url: true },
  ]);
});

test('a single file can ride on the info string, a block still streaming sends nothing', () => {
  assert.deepEqual(parseSendBlocks('```send path=report.pdf\n```'), [{ source: 'report.pdf', caption: undefined, url: false }]);
  assert.deepEqual(parseSendBlocks('```send\nout/a.png'), []);
});

test('only send blocks count, and the same file is sent once', () => {
  assert.deepEqual(parseSendBlocks('```js\nout/a.png\n```'), []);
  assert.equal(parseSendBlocks('```send\na.png\na.png\n```').length, 1);
});

test('the reply reads as words without the send block, other blocks stay', () => {
  const t = stripSendBlocks(REPLY);
  assert.ok(!t.includes('out/logo.png'));
  assert.match(t, /Here you go\./);
  assert.match(t, /```bash path=@terminal\nls\n```/);
  assert.equal(stripSendBlocks('Sending.\n```send\nout/a.pn'), 'Sending.');
});

test('mime types and names', () => {
  assert.equal(mimeFor('a/b.PNG'), 'image/png');
  assert.equal(mimeFor('x.apk'), 'application/vnd.android.package-archive');
  assert.equal(mimeFor('x.unknown'), 'application/octet-stream');
  assert.equal(mimeFor('https://h/p.jpg?x=1'), 'image/jpeg');
  assert.ok(isImageMime('image/webp') && !isImageMime('application/pdf'));
  assert.equal(baseName('out/dir/file.png'), 'file.png');
  assert.equal(baseName('https://h/a/b.jpg?x=1'), 'b.jpg');
  assert.equal(dataUrlOf('text/plain', textToBase64('héllo')), 'data:text/plain;base64,aMOpbGxv');
});

test('the runtime delivers sends after the commands, the chat shows them, and the prompt teaches the block', () => {
  const rt = readFileSync(new URL('../src/lib/agent/runtime.ts', import.meta.url), 'utf8');
  assert.match(rt, /parseSendBlocks\(/);
  assert.match(rt, /deliverSends\(/);
  const msg = readFileSync(new URL('../src/components/Message.tsx', import.meta.url), 'utf8');
  assert.match(msg, /stripSendBlocks\(/);
  assert.match(msg, /SentFiles/);
  const sp = readFileSync(new URL('../src/lib/agent/opus-prompt.ts', import.meta.url), 'utf8');
  assert.match(sp, /send\\nout\/logo\.png/);
});
