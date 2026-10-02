/** node --experimental-strip-types --test scripts/test-code-blocks.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderMarkdown } from '../src/components/markdown.ts';

const count = (s, re) => (s.match(re) ?? []).length;

test('every code block gets a header with a copy and an expand button', () => {
  const html = renderMarkdown('Here:\n\n```python\nprint("hi")\n```\n\nand\n\n```\nplain text\n```');
  assert.equal(count(html, /class="code-block"/g), 2);
  assert.equal(count(html, /data-code-action="copy"/g), 2);
  assert.equal(count(html, /data-code-action="expand"/g), 2);
  assert.equal(count(html, /aria-label="Copy code"/g), 2);
});

test('the header says what the block is: language, file path, or just Code', () => {
  assert.match(renderMarkdown('```python\nx = 1\n```'), /class="code-label">python</);
  assert.match(renderMarkdown('```gdscript path=scripts/player.gd\nextends Node\n```'), /class="code-label is-path">.*scripts\/player\.gd/);
  assert.match(renderMarkdown('```\nno language\n```'), /class="code-label">Code</);
});

test('the code is shown escaped, so what the copy button reads is what the reader sees', () => {
  const html = renderMarkdown('```html\n<script>alert(1)</script> & done\n```');
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;/);
  assert.match(html, /<code class="hljs language-html">/);
});

test('buttons carry no script and nothing from the model is placed in an attribute', () => {
  const html = renderMarkdown('```js" onmouseover="alert(1)\nx\n```');
  assert.doesNotMatch(html, /onmouseover=/);
  assert.doesNotMatch(html, /\son[a-z]+=/i);
});

test('website names inside code are left as code, outside code they still get a logo', () => {
  const html = renderMarkdown('Open claude.com now\n\n```bash\ncurl https://nvidia.com\n```');
  assert.equal(count(html, /class="site-chip"/g), 1);
  assert.match(html, /curl https:\/\/nvidia\.com/);
});
