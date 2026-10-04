/** node --experimental-strip-types --test scripts/test-site-icons.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ICONS, addIconSprite, prepareSiteIcons, replaceSymbolsWithIcons } from '../src/lib/suites/web/icons.ts';
import { selectThreejsSkills, threejsSkillsPrompt } from '../src/lib/skills/threejs/select.ts';
import { THREEJS_SKILLS, THREEJS_SKILLS_SOURCE } from '../src/lib/skills/threejs/data.ts';
import { buildSystemPrompt, WEB_ADDENDUM, ANDROID_ADDENDUM } from '../src/lib/agent/system-prompt.ts';

test('emoji and symbol characters in page text become drawn icons', () => {
  const { html, count } = replaceSymbolsWithIcons('<a href="/">Start 🚀</a> <button>Next →</button> <li>✓ Fast</li> <p>Rating ★★★</p>');
  assert.equal(count, 6);
  assert.ok(!/[🚀→✓★]/u.test(html));
  assert.match(html, /<use href="#i-rocket">/);
  assert.match(html, /<use href="#i-arrow-right">/);
  assert.match(html, /<use href="#i-check">/);
  assert.equal((html.match(/#i-star/g) ?? []).length, 3);
});

test('emoji with a variation selector, a skin tone or a joiner are one icon each', () => {
  assert.equal(replaceSymbolsWithIcons('<p>❤️ 👍🏽 👨‍💻</p>').count, 3);
});

test('attributes, scripts, styles, existing SVG, titles and comments are left alone', () => {
  const src = '<title>Launch 🚀</title><!-- 🚀 --><a title="🚀 go" href="#">x</a><script>const a = "🚀 →";</script><style>.a::before{content:"→"}</style><svg><text>★</text></svg>';
  const { html, count } = replaceSymbolsWithIcons(src);
  assert.equal(count, 0);
  assert.equal(html, src);
});

test('typographic marks stay: © ® ™ and bullets', () => {
  const src = '<footer>© 2026 Acme® · Brand™ • terms</footer>';
  assert.equal(replaceSymbolsWithIcons(src).html, src);
});

test('an emoji with no icon of its own becomes the sparkle, not an empty box', () => {
  assert.match(replaceSymbolsWithIcons('<p>🦄</p>').html, /#i-sparkle/);
});

test('every icon the page uses gets its drawing, once, plus the base style', () => {
  const page = '<html><head></head><body><svg class="icon"><use href="#i-menu"></use></svg><svg class="icon"><use href="#i-menu"></use></svg><svg class="icon"><use href="#i-heart"></use></svg></body></html>';
  const { html, added, unknown } = addIconSprite(page);
  assert.deepEqual(added.sort(), ['heart', 'menu']);
  assert.deepEqual(unknown, []);
  assert.equal((html.match(/<symbol id="i-menu"/g) ?? []).length, 1);
  assert.match(html, /<style id="icon-base">/);
  assert.ok(html.indexOf('<symbol') > html.indexOf('<body'));
});

test('a page that draws its own icon keeps it, and one that styles .icon keeps its style', () => {
  const page = '<head><style>.icon{width:2em}</style></head><body><svg><symbol id="i-menu" viewBox="0 0 8 8"></symbol></svg><svg><use href="#i-menu"></use></svg></body>';
  const { html, added } = addIconSprite(page);
  assert.deepEqual(added, []);
  assert.equal(html, page);
});

test('a name with no drawing is reported, not invented', () => {
  const { unknown } = addIconSprite('<body><svg><use href="#i-nonexistent"></use></svg></body>');
  assert.deepEqual(unknown, ['nonexistent']);
});

test('only HTML files are touched', () => {
  const out = prepareSiteIcons([{ path: 'index.html', content: '<body><p>🚀</p></body>' }, { path: 'app.js', content: 'const x = "🚀";' }]);
  assert.equal(out.replaced, 1);
  assert.equal(out.files[1].content, 'const x = "🚀";');
  assert.match(out.files[0].content, /<symbol id="i-rocket"/);
});

test('every icon is a well-formed 24x24 stroke drawing', () => {
  for (const [name, inner] of Object.entries(ICONS)) {
    assert.match(name, /^[a-z0-9-]+$/);
    const open = (inner.match(/<(path|circle|rect|ellipse)\b/g) ?? []).length;
    const closed = (inner.match(/\/>/g) ?? []).length;
    assert.ok(open > 0 && open === closed, `${name} is malformed`);
    assert.ok(!/fill=|stroke=/.test(inner), `${name} sets its own colours`);
  }
});

test('the ten Three.js skills are vendored with their source and licence', () => {
  assert.equal(THREEJS_SKILLS.length, 10);
  assert.equal(THREEJS_SKILLS_SOURCE.license, 'MIT');
  assert.match(THREEJS_SKILLS_SOURCE.repo, /cloudai-x\/threejs-skills/);
  for (const s of THREEJS_SKILLS) assert.ok(s.body.length > 2000, s.id);
});

test('the fundamentals always go in, and a request pulls in at most two more by topic', () => {
  assert.deepEqual(selectThreejsSkills('a landing page for my bakery').map((s) => s.id), ['threejs-fundamentals']);
  const ids = selectThreejsSkills('a glowing neon scene with a custom glsl shader, bloom, and click to select with raycasting').map((s) => s.id);
  assert.equal(ids[0], 'threejs-fundamentals');
  assert.equal(ids.length, 3);
});

test('the prompt carries the skills for a site and nothing for other builds', () => {
  const site = buildSystemPrompt({ lane: 'B', buildingSite: true, threejsSkills: threejsSkillsPrompt('a 3d portfolio') });
  assert.match(site, /THREE\.JS REFERENCE/);
  assert.match(site, /threejs-fundamentals/);
  const other = buildSystemPrompt({ lane: 'B' });
  assert.ok(!/THREE\.JS REFERENCE/.test(other));
});

test('the website contract forbids typed icons and names the drawn ones; Android asks for vector drawables', () => {
  assert.match(WEB_ADDENDUM, /Icons are drawn, never typed/);
  assert.match(WEB_ADDENDUM, /arrow-right/);
  assert.match(ANDROID_ADDENDUM, /vector drawable/i);
});
