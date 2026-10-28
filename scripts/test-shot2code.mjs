/** node --experimental-strip-types --test scripts/test-shot2code.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { STACKS, createMessages, extractCode, fileName, updateMessages, withGeneratedImages } from '../src/lib/suites/shot2code/prompts.ts';

const page = '<!doctype html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body><h1>Hi</h1></body></html>';
const shot = { dataUrl: 'data:image/png;base64,AAAA', name: 'Home.png' };

test('the first request carries every screenshot as an image and the stack rules as text', () => {
  const m = createMessages([shot, shot], 'react_tailwind', 'dark mode');
  assert.equal(m[0].role, 'system');
  const parts = m[1].content;
  assert.equal(parts.filter((p) => p.type === 'image_url').length, 2);
  const text = parts.find((p) => p.type === 'text').text;
  assert.match(text, /@babel\/standalone@7\.25\.6/);
  assert.match(text, /Several screenshots/);
  assert.match(text, /Additional instructions: dark mode/);
  for (const s of STACKS) assert.ok(createMessages([shot], s.id)[1].content.at(-1).text.includes('Stack:'), s.id);
});

test('a revision sends the current code, the change and the picked element', () => {
  const m = updateMessages([shot], 'html_css', page, 'make the title red', '<h1>Hi</h1>');
  const text = m[1].content.at(-1).text;
  assert.ok(text.includes(page));
  assert.match(text, /make the title red/);
  assert.match(text, /picked in the rendered preview[\s\S]*<h1>Hi<\/h1>/);
  assert.match(text, /Do not use Tailwind/);
});

test('the page is pulled out of a chatty, fenced reply; a cut-off reply only when streaming', () => {
  assert.equal(extractCode(`Here it is:\n\`\`\`html\n${page}\n\`\`\`\nEnjoy`), page);
  assert.equal(extractCode(page), page);
  assert.equal(extractCode('Sorry, I cannot see images.'), null);
  const cut = '```html\n<!doctype html><html><body><h1>Hal';
  assert.equal(extractCode(cut), null);
  assert.equal(extractCode(cut, true), '<!doctype html><html><body><h1>Hal');
});

test('placeholder pictures become generated ones of the same size, other images stay', () => {
  const html = '<img src="https://placehold.co/640x360" alt="A red sports car on a beach"><img src="logo.png" alt="logo">';
  const out = withGeneratedImages(html);
  assert.match(out, /image\.pollinations\.ai\/prompt\/A%20red%20sports%20car%20on%20a%20beach\?width=640&height=360/);
  assert.match(out, /src="logo\.png"/);
  assert.match(withGeneratedImages('<img alt="x" src="https://placehold.co/300">'), /width=300&height=300/);
});

test('download names are short and safe', () => {
  assert.equal(fileName('vue_tailwind', 'My Shop Page.PNG'), 'my-shop-page-vue-tailwind.html');
  assert.equal(fileName('html_css'), 'screenshot-html-css.html');
});
