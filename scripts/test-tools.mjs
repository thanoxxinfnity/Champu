/** node --experimental-strip-types --test scripts/test-tools.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { CATEGORIES, TOOLS, defaultsFor, outToText, runTool, searchTools, toolById } from '../src/lib/tools/index.ts';
import { md5, crc32, base32Encode, base32Decode, luhn } from '../src/lib/tools/defs/security.ts';
import { numberToWords, toRoman, fromRoman } from '../src/lib/tools/defs/convert.ts';
import { evaluate } from '../src/lib/tools/helpers.ts';
import { qrSvg } from '../src/lib/tools/defs/generate.ts';
import { parseCsv } from '../src/lib/tools/defs/dev.ts';

const run = async (id, v = {}) => runTool(toolById(id), { ...toolById(id).example, ...v });
const txt = async (id, v) => outToText(await run(id, v));

test('there are well over 150 tools, each with a unique id, a category, a form and an example', () => {
  assert.ok(TOOLS.length >= 150, `only ${TOOLS.length}`);
  assert.equal(new Set(TOOLS.map((t) => t.id)).size, TOOLS.length, 'ids are unique');
  for (const t of TOOLS) {
    assert.ok(CATEGORIES.some((c) => c.id === t.cat), `${t.id}: category`);
    assert.ok(t.name && t.glyph && t.blurb, `${t.id}: name/glyph/blurb`);
    assert.ok(t.fields.length > 0, `${t.id}: fields`);
    for (const f of t.fields) assert.ok(f.id && f.label, `${t.id}: field`);
    assert.ok(t.example && typeof t.example === 'object', `${t.id}: example`);
    for (const k of Object.keys(t.example)) assert.ok(t.fields.some((f) => f.id === k), `${t.id}: example key ${k} has no field`);
  }
  for (const c of CATEGORIES) assert.ok(TOOLS.filter((t) => t.cat === c.id).length >= 5, `${c.id} has few tools`);
});

test('every tool runs on its example and gives a real result, never a crash or an error', async () => {
  for (const t of TOOLS) {
    const o = await runTool(t, t.example);
    assert.notEqual(o.kind, 'error', `${t.id}: ${o.message}`);
    assert.ok(outToText(o).length > 0, `${t.id}: empty result`);
  }
});

test('every tool survives empty and hostile input without throwing', async () => {
  const hostile = ['', '   ', '\u0000\u202e', '<script>alert(1)</script>', '9'.repeat(400), '{"a":', '😀'.repeat(50), '-1e999'];
  for (const t of TOOLS) {
    for (const h of hostile) {
      const v = {};
      for (const f of t.fields) if (f.kind === 'text' || f.kind === 'area') v[f.id] = h;
      const o = await runTool(t, v);
      assert.ok(o && typeof o.kind === 'string', `${t.id}: ${JSON.stringify(h).slice(0, 20)}`);
    }
    const nums = {};
    for (const f of t.fields) if (f.kind === 'number' || f.kind === 'range') nums[f.id] = -1;
    assert.ok((await runTool(t, nums)).kind, `${t.id}: negative numbers`);
    for (const f of t.fields) if (f.kind === 'number' || f.kind === 'range') nums[f.id] = 1e12;
    assert.ok((await runTool(t, nums)).kind, `${t.id}: huge numbers`);
  }
});

test('text tools give the right answers', async () => {
  assert.match(await txt('word-counter', { t: 'one two three. four!' }), /Words: 4/);
  assert.match(await txt('case-converter', { t: 'hello big world' }), /camelCase\thelloBigWorld/);
  assert.match(await txt('case-converter', { t: 'hello big world' }), /snake_case\thello_big_world/);
  assert.equal(await txt('slugify', { t: 'Héllo Wörld! 10 Tips & Tricks', sep: '-' }), 'hello-world-10-tips-and-tricks');
  assert.equal(await txt('reverse-text', { t: 'abc', mode: 'chars' }), 'cba');
  assert.equal(await txt('sort-lines', { t: 'b\nA\nc', mode: 'az', ci: true }), 'A\nb\nc');
  assert.match(await txt('dedupe-lines', { t: 'a\nb\na', ci: false, trim: true }), /Removed: 1/);
  assert.equal(await txt('text-to-binary', { t: 'Hi', mode: 'bin' }), '01001000 01101001');
  assert.equal(await txt('text-to-binary', { t: '01001000 01101001', mode: 'unbin' }), 'Hi');
  assert.equal(await txt('morse-code', { t: 'SOS', mode: 'enc' }), '... --- ...');
  assert.equal(await txt('morse-code', { t: '... --- ...', mode: 'dec' }), 'sos');
  assert.equal(await txt('caesar-cipher', { t: 'Hello', shift: 13, dec: false }), 'Uryyb');
  assert.equal(await txt('caesar-cipher', { t: 'Uryyb', shift: 13, dec: true }), 'Hello');
  assert.equal(await txt('pig-latin', { t: 'hello apple' }), 'ellohay appleway');
  assert.equal(await txt('remove-accents', { t: 'Crème brûlée' }), 'Creme brulee');
  assert.equal(await txt('acronym-maker', { t: 'Portable Network Graphics', skip: true }), 'PNG');
  assert.match(await txt('palindrome', { a: 'A man, a plan, a canal: Panama', b: 'listen' }), /Palindrome\?: Yes/);
  assert.match(await txt('extract-data', { t: 'a@b.com and https://x.com/y', what: 'email' }), /a@b\.com/);
  assert.equal(await txt('word-wrap', { t: 'aaa bbb ccc', w: 10 }), 'aaa bbb\nccc');
  assert.equal(await txt('list-converter', { t: 'a\nb', mode: 'tocsv', sep: ', ', q: '"' }), '"a", "b"');
  const diff = await run('text-diff', { a: 'one\ntwo', b: 'one\n2\nthree' });
  assert.deepEqual(diff.rows.filter((r) => r.t !== ' ').map((r) => r.t + r.s), ['-two', '+2', '+three']);
});

test('developer tools give the right answers', async () => {
  assert.equal(await txt('json-formatter', { t: '{"b":1,"a":2}', mode: 'sort', ind: '2' }), '{\n  "a": 2,\n  "b": 1\n}');
  assert.equal((await run('json-formatter', { t: '{bad', mode: 'pretty' })).kind, 'error');
  assert.equal(await txt('json-to-csv', { t: '[{"a":1,"b":"x,y"}]', sep: ',' }), 'a,b\n1,"x,y"');
  assert.deepEqual(JSON.parse(await txt('csv-to-json', { t: 'n,a\nAsha,24', sep: ',', num: true })), [{ n: 'Asha', a: 24 }]);
  assert.deepEqual(parseCsv('a,"b ""q"" c",d\n1,2,3'), [['a', 'b "q" c', 'd'], ['1', '2', '3']]);
  assert.match(await txt('json-to-yaml', { t: '{"a":[1,2],"b":{"c":true}}' }), /a:\n {2}- 1\n {2}- 2\nb:\n {2}c: true/);
  assert.equal(await txt('json-path', { t: '{"u":[{"n":"A"},{"n":"B"}]}', p: '$.u[1].n' }), 'B');
  assert.equal(await txt('base64', { t: 'Hello, नमस्ते', mode: 'enc', url: false }), 'SGVsbG8sIOCkqOCkruCkuOCljeCkpOClhw==');
  assert.equal(await txt('base64', { t: 'SGVsbG8sIOCkqOCkruCkuOCljeCkpOClhw==', mode: 'dec', url: false }), 'Hello, नमस्ते');
  assert.equal(await txt('url-encode', { t: 'a b&c/ए', mode: 'enc' }), 'a%20b%26c%2F%E0%A4%8F');
  assert.equal(await txt('html-entities', { t: '<a href="x">&</a>', mode: 'enc' }), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  assert.equal(await txt('html-entities', { t: '&lt;b&gt; &amp; &#65;', mode: 'dec' }), '<b> & A');
  assert.match(await txt('jwt-decoder'), /"name": "Asha"/);
  assert.match(await txt('regex-tester', { re: '(\\d+)-(\\d+)', flags: 'g', t: 'a 10-20 b 3-4' }), /10-20\t10 \| 20/);
  assert.match(await txt('cron-explainer', { c: '0 9 * * 1' }), /hour\t9/);
  assert.equal((await run('cron-explainer', { c: '61 * * * *' })).kind, 'error');
  assert.match(await txt('chmod-calculator', { n: '754' }), /rwxr-xr--/);
  assert.match(await txt('semver-compare', { a: '1.4.2', b: '1.10.0' }), /1\.10\.0 is newer/);
  assert.match(await txt('css-minify', { t: '/* x */ .a { color : red ; }' }), /\.a\{color:red\}/);
  assert.match(await txt('markdown-to-html', { t: '# Hi\n**b** and *i*' }), /<h1>Hi<\/h1>\n<p><strong>b<\/strong> and <em>i<\/em><\/p>/);
  assert.match(await txt('cidr-calculator', { c: '192.168.1.37/24' }), /Network: 192\.168\.1\.0[\s\S]*Broadcast: 192\.168\.1\.255[\s\S]*Usable hosts: 254/);
  assert.match(await txt('curl-to-fetch'), /fetch\('https:\/\/api\.x\.com\/v1\/items'[\s\S]*method: 'POST'/);
  assert.deepEqual(JSON.parse(await txt('env-parser', { t: 'A=1\n# c\nB="x y"' })), { A: '1', B: 'x y' });
  const ids = (await txt('uuid-generator', { n: 3, upper: false, nodash: false })).split('\n');
  assert.equal(ids.length, 3); for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(await txt('unicode-lookup', { t: '₹' }), /U\+20B9\te2 82 b9/);
});

test('converters and calculators give the right answers', async () => {
  assert.match(await txt('length-converter', { x: 1, from: 'mile' }), /kilometre\t1\.609344/);
  assert.match(await txt('temperature-converter', { x: 100, from: 'Celsius' }), /Fahrenheit\t212/);
  assert.match(await txt('temperature-converter', { x: -40, from: 'Fahrenheit' }), /Celsius\t-40/);
  assert.match(await txt('data-size-converter', { x: 1, from: 'GB' }), /MB\t1024/);
  assert.match(await txt('number-base', { n: '255', from: 10 }), /Binary \(2\)\t11111111[\s\S]*Hex \(16\)\tFF/);
  assert.match(await txt('number-base', { n: 'ff', from: 16 }), /Decimal \(10\)\t255/);
  assert.equal(await txt('roman-numerals', { t: '2024' }), 'MMXXIV');
  assert.equal(await txt('roman-numerals', { t: 'MCMXCIV' }), '1994');
  assert.equal(toRoman(4), 'IV'); assert.equal(fromRoman('XLII'), 42);
  assert.equal(numberToWords(1234567, true), 'twelve lakh thirty-four thousand five hundred sixty-seven');
  assert.equal(numberToWords(1234567, false), 'one million two hundred thirty-four thousand five hundred sixty-seven');
  assert.equal(numberToWords(0), 'zero'); assert.equal(numberToWords(-15), 'minus fifteen');
  assert.equal(await txt('ordinal-numbers', { n: 11 }), '11th'); assert.equal(await txt('ordinal-numbers', { n: 22 }), '22nd');
  assert.match(await txt('duration-converter', { t: '1d 2h 3m 4s' }), /Seconds: 93784/);
  assert.equal(evaluate('2+3*4'), 14); assert.equal(evaluate('(2+3)*4'), 20); assert.equal(evaluate('2^3^2'), 512); assert.equal(evaluate('-3+5'), 2);
  assert.equal(evaluate('sqrt(16)+5!'), 124); assert.ok(Math.abs(evaluate('sin(30)', true) - 0.5) < 1e-9); assert.equal(evaluate('50%'), 0.5);
  assert.throws(() => evaluate('2+')); assert.throws(() => evaluate('foo(2)')); assert.throws(() => evaluate('process.exit()'));
  assert.match(await txt('percentage-calculator', { x: 15, y: 2000 }), /15% of 2000\t300/);
  assert.match(await txt('bmi-calculator', { kg: 70, cm: 175 }), /BMI: 22\.9[\s\S]*Normal/);
  assert.match(await txt('emi-calculator', { p: 1000000, r: 9, y: 10 }), /Monthly EMI: ₹12,667\.58/);
  assert.match(await txt('gst-calculator', { a: 1180, r: 18, mode: 'incl' }), /Price before GST: ₹1,000\.00[\s\S]*GST: ₹180\.00/);
  assert.match(await txt('fraction-calculator', { a: '3/4', op: '+', b: '5/6' }), /Result: 19\/12/);
  assert.match(await txt('gcd-lcm', { t: '12, 18' }), /GCD \(HCF\): 6[\s\S]*LCM: 36/);
  assert.match(await txt('prime-checker', { n: 360 }), /2\^3 × 3\^2 × 5/);
  assert.match(await txt('prime-checker', { n: 97 }), /Prime\?: Yes/);
  assert.match(await txt('permutation-combination', { n: 10, r: 3 }), /nPr: 720[\s\S]*nCr: 120/);
  assert.match(await txt('quadratic-solver', { a: 1, b: -3, c: 2 }), /x₁: 2[\s\S]*x₂: 1/);
  assert.match(await txt('statistics', { t: '2, 4, 4, 4, 5, 5, 7, 9' }), /Mean: 5[\s\S]*Median: 4\.5[\s\S]*Mode: 4[\s\S]*population\): 2/);
  assert.match(await txt('ratio-simplifier', { t: '1920:1080', scale: 1280 }), /Simplified: 16 : 9/);
  assert.match(await txt('geometry-shapes', { shape: 'circle', a: 1 }), /Area: 3\.1416/);
  assert.match(await txt('pythagoras', { a: 3, b: 4, c: 0 }), /Hypotenuse c: 5/);
  assert.match(await txt('average-speed', { d: 120, s: 0, t: 2 }), /Speed: 60 km\/h/);
  assert.match(await txt('compound-interest', { p: 100000, r: 8, y: 10, n: '1' }), /Final amount: ₹2,15,892\.50/);
  assert.match(await txt('matrix-determinant', { t: '1 2\n3 4' }), /Determinant: -2/);
  assert.match(await txt('break-even', { fixed: 50000, price: 250, var: 150 }), /Break-even units: 500/);
  assert.match(await txt('cagr-calculator', { a: 100, b: 200, y: 1 }), /CAGR: 100%/);
});

test('date tools give the right answers', async () => {
  assert.match(await txt('date-difference', { a: '2024-01-26', b: '2026-08-15' }), /Difference: 2y 6m 20d[\s\S]*Total days: 932/);
  assert.match(await txt('add-days', { d: '2026-01-31', n: 1, u: 'months' }), /Result: 2026-02-28/);
  assert.match(await txt('add-days', { d: '2026-01-01', n: 45, u: 'days' }), /Result: 2026-02-15[\s\S]*Sunday/);
  assert.match(await txt('age-calculator', { b: '2000-03-15', on: '2026-03-14' }), /Age: 25 years, 11 months, 27 days/);
  assert.match(await txt('day-of-week', { d: '2026-08-15' }), /Weekday: Saturday[\s\S]*ISO week: 33/);
  assert.match(await txt('days-until', { d: '2026-12-25', from: '2026-12-01' }), /Days left: 24/);
  assert.match(await txt('working-days', { a: '2026-08-03', b: '2026-08-09', we: 'sat-sun' }), /Working days: 5/);
  assert.match(await txt('leap-years', { y: 2024 }), /Leap year/);
  assert.match(await txt('unix-timestamp', { t: '0' }), /1970-01-01T00:00:00\.000Z/);
  assert.match(await txt('timezone-converter', { t: '2026-08-15T18:30', from: 'Asia/Kolkata' }), /UTC\t15 Aug 2026,? 13:00/);
  assert.match(await txt('zodiac-sign', { d: '2000-03-15' }), /Pisces[\s\S]*Dragon/);
  assert.match(await txt('time-add', { t: '1:45\n2:30\n-0:20' }), /Total: 3:55/);
  assert.match(await txt('sleep-calculator', { t: '06:30', mode: 'sleep' }), /6\t9 h\t21:15/);
  const cal = await run('calendar-view', { y: 2026, m: '8', mark: '15' });
  assert.equal(cal.kind, 'calendar'); assert.equal(cal.month, 7);
});

test('security tools give the right answers', async () => {
  assert.equal(md5(new TextEncoder().encode('')), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(md5(new TextEncoder().encode('hello')), '5d41402abc4b2a76b9719d911017c592');
  assert.equal(md5(new TextEncoder().encode('The quick brown fox jumps over the lazy dog')), '9e107d9d372bb6826bd81d3542a419d6');
  assert.equal(crc32(new TextEncoder().encode('123456789')), 'cbf43926');
  assert.equal(base32Encode(new TextEncoder().encode('foobar')), 'MZXW6YTBOI'); assert.equal(new TextDecoder().decode(base32Decode('MZXW6YTBOI======')), 'foobar');
  assert.equal(luhn('4111111111111111'), true); assert.equal(luhn('4111111111111112'), false);
  const h = await txt('hash-generator', { t: 'hello' });
  assert.match(h, /SHA-256\t2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824/);
  assert.match(h, /SHA-1\taaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d/);
  assert.match(await txt('hmac-generator', { m: 'The quick brown fox jumps over the lazy dog', k: 'key', a: 'SHA-256' }), /f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8/);
  assert.match(await txt('totp-generator', { s: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', at: 59 }), /Code: 287082/);
  const blob = await txt('text-encrypt', { t: 'my secret', pw: 'pass1', mode: 'enc' });
  assert.match(blob, /^v1\./);
  assert.equal(await txt('text-encrypt', { t: blob, pw: 'pass1', mode: 'dec' }), 'my secret');
  assert.equal((await run('text-encrypt', { t: blob, pw: 'wrong', mode: 'dec' })).kind, 'error');
  assert.match(await txt('card-validator', { n: '4111 1111 1111 1111' }), /Valid[\s\S]*Visa/);
  assert.match(await txt('password-strength', { p: 'password' }), /Weak/);
  assert.match(await txt('ip-info', { ip: '10.1.2.3' }), /Private/);
});

test('generators make real, valid output', async () => {
  const pw = (await txt('password-generator', { len: 20, lower: true, upper: true, digits: true, symbols: true, noAmbiguous: true, n: 4 })).split('\n');
  assert.equal(pw.length, 4); for (const p of pw) { assert.equal(p.length, 20); assert.match(p, /[a-z]/); assert.match(p, /[A-Z]/); assert.match(p, /\d/); assert.match(p, /[^A-Za-z0-9]/); assert.ok(!/[O0Il1|]/.test(p)); }
  assert.equal((await run('password-generator', { lower: false, upper: false, digits: false, symbols: false })).kind, 'error');
  assert.equal((await txt('random-string', { len: 40, set: 'hex' })).length, 40);
  const qr = await run('qr-code', { t: 'https://chomu.app' });
  assert.equal(qr.kind, 'svg'); assert.match(qr.svg, /^<svg[\s\S]*<path d="M/);
  assert.notEqual(qrSvg('a'), qrSvg('b'));
  assert.ok(qrSvg('नमस्ते ₹').length > 200);
  assert.match(await txt('wifi-qr', { ssid: 'Home;Net', pw: 'p:w', sec: 'WPA', hidden: false }), /WIFI:T:WPA;S:Home\\;Net;P:p\\:w;;/);
  assert.match(await txt('upi-qr', { vpa: 'a@upi', name: 'Chai', amt: 50, note: 'hi' }), /upi:\/\/pay\?pa=a%40upi&pn=Chai&am=50&cu=INR&tn=hi/);
  assert.match(await txt('css-gradient', { type: 'linear', deg: 90, a: '#000000', b: '#ffffff', c: '#ff0000', three: false }), /linear-gradient\(90deg, #000000, #ffffff\)/);
  assert.match(await txt('css-clamp', { min: 16, max: 32, w1: 400, w2: 1200 }), /clamp\(1rem, 0\.5rem \+ 2vw, 2rem\)/);
  assert.match(await txt('aspect-ratio', { w: 1920, h: 1080, nw: 1280 }), /Ratio: 16:9[\s\S]*New height: 720/);
  const a = await txt('fake-data', { n: 3, seed: 5, fmt: 'json' }), b = await txt('fake-data', { n: 3, seed: 5, fmt: 'json' });
  assert.equal(a, b, 'same seed, same data'); assert.equal(JSON.parse(a).length, 3);
  assert.match(await txt('robots-txt', { dis: '/x', map: 'https://a.b/s.xml', ai: true }), /Disallow: \/x[\s\S]*GPTBot[\s\S]*Sitemap: https:\/\/a\.b\/s\.xml/);
  assert.match(await txt('whatsapp-link', { p: '+91 98765 43210', m: 'hi there' }), /^https:\/\/wa\.me\/919876543210\?text=hi%20there$/);
  assert.match(await txt('utm-builder', { u: 'https://a.b/', src: 'x', med: 'y', cmp: 'z' }), /utm_source=x&utm_medium=y&utm_campaign=z/);
});

test('colour tools give the right answers', async () => {
  assert.match(await txt('color-converter', { c: '#ff8800' }), /RGB\trgb\(255, 136, 0\)[\s\S]*HSL\thsl\(32, 100%, 50%\)/);
  assert.match(await txt('color-converter', { c: 'rgb(0, 0, 255)' }), /HEX\t#0000FF/);
  assert.match(await txt('contrast-checker', { fg: '#000000', bg: '#ffffff' }), /Contrast: 21 : 1[\s\S]*AAA normal \(7\): Pass/);
  assert.match(await txt('contrast-checker', { fg: '#777777', bg: '#ffffff' }), /AA normal text \(4\.5\): Fail/);
  const pal = await run('palette-generator', { c: '#ff0000', mode: 'complementary' });
  assert.deepEqual(pal.items.map((i) => i.hex), ['#ff0000', '#00ffff']);
  assert.equal((await run('shade-generator', { c: '#7c5cff' })).items.length, 10);
  assert.equal((await run('color-mixer', { a: '#000000', b: '#ffffff', n: 3 })).items[1].hex, '#808080');
  assert.match(await txt('hex-to-rgba', { c: '#7c5cff', a: 50 }), /rgba\(124, 92, 255, 0\.5\)[\s\S]*#7c5cff80/);
});

test('search finds tools by name, meaning and category', () => {
  assert.equal(searchTools('qr')[0].id, 'qr-code');
  assert.ok(searchTools('base64').some((t) => t.id === 'base64'));
  assert.ok(searchTools('emi').some((t) => t.id === 'emi-calculator'));
  assert.ok(searchTools('password').length >= 3);
  assert.ok(searchTools('', 'color').every((t) => t.cat === 'color'));
  assert.deepEqual(searchTools('zzzzqqq'), []);
  assert.equal(defaultsFor(toolById('password-generator')).len, 16);
});
