/** node --experimental-strip-types --test scripts/test-robustness.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { looksDegenerate, extractArtifacts, commandsOf } from '../src/lib/agent/artifacts.ts';
import { chipifyHtml } from '../src/lib/sites/domains.ts';

test('a reply full of leaked control tokens, or of path-less scraps, is recognised as noise', () => {
  assert.equal(looksDegenerate('Creating the file.\n\n<|close|> ,<|close|>\nitem\n<|close|>emos'), true);
  const scraps = Array.from({ length: 20 }, (_, i) => '```\nscrap ' + i + '\n```\n').join('\n') + 'x'.repeat(500);
  assert.equal(looksDegenerate(scraps), true);
  assert.equal(looksDegenerate('Creating `app/index.html`.\n\n```html path=app/index.html\n<html></html>\n```\n'), false);
});

test('a link to the bridge (an address, not a website) does not get a site logo', () => {
  const html = '<a href="http://127.0.0.1:7717/v1/artifact/app.apk">app.apk</a>';
  assert.equal(chipifyHtml(html), html);
  assert.match(chipifyHtml('<a href="https://github.com/a/b">repo</a>'), /site-chip/);
});

test('a stray backtick around a command is not part of the command', () => {
  const cmds = commandsOf(extractArtifacts('```bash path=@terminal cwd=.\n`cd app && npm install\n```\n'));
  assert.equal(cmds[0].command, 'cd app && npm install');
  assert.equal(commandsOf(extractArtifacts('```bash path=@terminal\necho `date`\n```\n'))[0].command, 'echo `date`');
});
