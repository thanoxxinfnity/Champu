import { area, err, lines, list, N, B, S, num, pick, rand, sel, stats, table, text, tog, txt, words } from '../helpers.ts';
import type { ToolDef } from '../types.ts';

const MORSE: Record<string, string> = { a: '.-', b: '-...', c: '-.-.', d: '-..', e: '.', f: '..-.', g: '--.', h: '....', i: '..', j: '.---', k: '-.-', l: '.-..', m: '--', n: '-.', o: '---', p: '.--.', q: '--.-', r: '.-.', s: '...', t: '-', u: '..-', v: '...-', w: '.--', x: '-..-', y: '-.--', z: '--..', '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-', '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.', '.': '.-.-.-', ',': '--..--', '?': '..--..', '!': '-.-.--', '/': '-..-.', '@': '.--.-.', '-': '-....-' };
const NATO: Record<string, string> = { a: 'Alfa', b: 'Bravo', c: 'Charlie', d: 'Delta', e: 'Echo', f: 'Foxtrot', g: 'Golf', h: 'Hotel', i: 'India', j: 'Juliett', k: 'Kilo', l: 'Lima', m: 'Mike', n: 'November', o: 'Oscar', p: 'Papa', q: 'Quebec', r: 'Romeo', s: 'Sierra', t: 'Tango', u: 'Uniform', v: 'Victor', w: 'Whiskey', x: 'X-ray', y: 'Yankee', z: 'Zulu', '0': 'Zero', '1': 'One', '2': 'Two', '3': 'Three', '4': 'Four', '5': 'Five', '6': 'Six', '7': 'Seven', '8': 'Eight', '9': 'Niner' };
const LOREM = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum'.split(' ');

const splitWords = (s: string): string[] => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_\-./]+/g, ' ').trim().split(/\s+/).filter(Boolean);
const cap = (w: string): string => (w ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w);

export const textTools: ToolDef[] = [
  {
    id: 'word-counter', name: 'Word counter', cat: 'text', glyph: 'Aa', blurb: 'Words, characters, sentences, paragraphs and reading time.',
    fields: [area('t', 'Text', { placeholder: 'Paste or type…', rows: 7 })], example: { t: 'Chomugiri is a workspace. It has tools!\n\nSecond paragraph here.' },
    run: (v) => {
      const t = S(v, 't');
      const w = words(t);
      return stats([['Words', w.length], ['Characters', t.length], ['No spaces', t.replace(/\s/g, '').length], ['Sentences', (t.match(/[^.!?]+[.!?]+/g) ?? []).length || (t.trim() ? 1 : 0)], ['Paragraphs', t.split(/\n\s*\n/).filter((p) => p.trim()).length], ['Lines', t ? lines(t).length : 0], ['Reading time', `${Math.max(w.length ? 1 : 0, Math.round(w.length / 200))} min`], ['Speaking time', `${Math.max(w.length ? 1 : 0, Math.round(w.length / 130))} min`]]);
    },
  },
  {
    id: 'case-converter', name: 'Case converter', cat: 'text', glyph: 'aA', blurb: 'UPPER, lower, Title, camelCase, snake_case, kebab-case and more at once.',
    fields: [area('t', 'Text', { rows: 4 })], example: { t: 'hello world from Chomugiri' },
    run: (v) => {
      const t = S(v, 't'), w = splitWords(t);
      return table(['Style', 'Result'], [['UPPER CASE', t.toUpperCase()], ['lower case', t.toLowerCase()], ['Title Case', w.map(cap).join(' ')], ['Sentence case', t ? t[0]!.toUpperCase() + t.slice(1).toLowerCase() : ''], ['camelCase', w.map((x, i) => (i ? cap(x) : x.toLowerCase())).join('')], ['PascalCase', w.map(cap).join('')], ['snake_case', w.map((x) => x.toLowerCase()).join('_')], ['CONSTANT_CASE', w.map((x) => x.toUpperCase()).join('_')], ['kebab-case', w.map((x) => x.toLowerCase()).join('-')], ['dot.case', w.map((x) => x.toLowerCase()).join('.')], ['aLtErNaTiNg', [...t].map((c, i) => (i % 2 ? c.toUpperCase() : c.toLowerCase())).join('')]]);
    },
  },
  {
    id: 'slugify', name: 'Slug maker', cat: 'text', glyph: '/-', blurb: 'Turn a title into a clean URL slug.',
    fields: [txt('t', 'Title'), sel('sep', 'Separator', ['-', '_', '.'], '-')], example: { t: 'Héllo Wörld! 10 Tips & Tricks', sep: '-' },
    run: (v) => text(S(v, 't').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, S(v, 'sep') || '-').replace(new RegExp(`^\\${S(v, 'sep') || '-'}+|\\${S(v, 'sep') || '-'}+$`, 'g'), '')),
  },
  {
    id: 'reverse-text', name: 'Reverse text', cat: 'text', glyph: 'icon:swap', blurb: 'Reverse letters, words or lines.',
    fields: [area('t', 'Text', { rows: 4 }), sel('mode', 'Reverse', [{ value: 'chars', label: 'Letters' }, { value: 'words', label: 'Words' }, { value: 'lines', label: 'Lines' }], 'chars')], example: { t: 'one two three', mode: 'words' },
    run: (v) => {
      const t = S(v, 't'), m = S(v, 'mode');
      return text(m === 'words' ? t.split(/(\s+)/).reverse().join('') : m === 'lines' ? lines(t).reverse().join('\n') : [...t].reverse().join(''));
    },
  },
  {
    id: 'sort-lines', name: 'Sort lines', cat: 'text', glyph: 'A-Z', blurb: 'Sort, reverse or shuffle a list of lines.',
    fields: [area('t', 'Lines', { rows: 6 }), sel('mode', 'Order', [{ value: 'az', label: 'A → Z' }, { value: 'za', label: 'Z → A' }, { value: 'len', label: 'By length' }, { value: 'num', label: 'Numeric' }, { value: 'shuffle', label: 'Shuffle' }], 'az'), tog('ci', 'Ignore case', true)], example: { t: 'pear\nApple\nbanana\ncherry', mode: 'az', ci: true },
    run: (v) => {
      const a = lines(S(v, 't')).filter((x) => x.length), m = S(v, 'mode'), ci = B(v, 'ci');
      const key = (s: string) => (ci ? s.toLowerCase() : s);
      if (m === 'shuffle') { const r = rand(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; } return text(a.join('\n')); }
      if (m === 'num') return text(a.sort((x, y) => parseFloat(x) - parseFloat(y)).join('\n'));
      if (m === 'len') return text(a.sort((x, y) => x.length - y.length).join('\n'));
      a.sort((x, y) => (key(x) < key(y) ? -1 : key(x) > key(y) ? 1 : 0));
      return text((m === 'za' ? a.reverse() : a).join('\n'));
    },
  },
  {
    id: 'dedupe-lines', name: 'Remove duplicate lines', cat: 'text', glyph: '≠', blurb: 'Keep each line once and see how many went.',
    fields: [area('t', 'Lines', { rows: 6 }), tog('ci', 'Ignore case'), tog('trim', 'Trim spaces', true)], example: { t: 'a\nb\na\nB\nc\nb', ci: false, trim: true },
    run: (v) => {
      const seen = new Set<string>(), out: string[] = [], src = lines(S(v, 't'));
      for (const l0 of src) { const l = B(v, 'trim') ? l0.trim() : l0; const k = B(v, 'ci') ? l.toLowerCase() : l; if (!seen.has(k)) { seen.add(k); out.push(l); } }
      return { kind: 'multi', parts: [{ out: text(out.join('\n')) }, { out: stats([['Before', src.length], ['After', out.length], ['Removed', src.length - out.length]]) }] };
    },
  },
  {
    id: 'number-lines', name: 'Number lines', cat: 'text', glyph: '1.', blurb: 'Add line numbers or a bullet to every line.',
    fields: [area('t', 'Lines', { rows: 5 }), sel('style', 'Style', ['1.', '1)', '- ', '* ', '•  '], '1.'), num('start', 'Start at', { default: 1 })], example: { t: 'first\nsecond\nthird', style: '1.', start: 1 },
    run: (v) => {
      const st = S(v, 'style'), s0 = N(v, 'start', 1);
      return text(lines(S(v, 't')).map((l, i) => (/^\d/.test(st) ? `${s0 + i}${st.slice(1)} ${l}` : `${st}${l}`)).join('\n'));
    },
  },
  {
    id: 'whitespace-cleaner', name: 'Whitespace cleaner', cat: 'text', glyph: '␣', blurb: 'Trim, collapse spaces, drop blank lines or all line breaks.',
    fields: [area('t', 'Text', { rows: 5 }), tog('trim', 'Trim every line', true), tog('collapse', 'Collapse repeated spaces', true), tog('blank', 'Remove blank lines'), tog('join', 'Join into one line')], example: { t: '  hello    world  \n\n   next   line ', trim: true, collapse: true, blank: true, join: false },
    run: (v) => {
      let a = lines(S(v, 't'));
      if (B(v, 'trim')) a = a.map((l) => l.trim());
      if (B(v, 'collapse')) a = a.map((l) => l.replace(/[ \t]+/g, ' '));
      if (B(v, 'blank')) a = a.filter((l) => l.length);
      return text(B(v, 'join') ? a.join(' ').trim() : a.join('\n'));
    },
  },
  {
    id: 'find-replace', name: 'Find & replace', cat: 'text', glyph: 'icon:search', blurb: 'Plain or regular-expression find and replace.',
    fields: [area('t', 'Text', { rows: 5 }), txt('find', 'Find', { mono: true }), txt('rep', 'Replace with', { mono: true }), tog('re', 'Regular expression'), tog('ci', 'Ignore case')], example: { t: 'cat bat rat', find: '[cb]at', rep: 'dog', re: true, ci: false },
    run: (v) => {
      try {
        const f = S(v, 'find');
        if (!f) return text(S(v, 't'));
        const re = new RegExp(B(v, 're') ? f : f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), B(v, 'ci') ? 'gi' : 'g');
        const t = S(v, 't');
        return { kind: 'multi', parts: [{ out: text(t.replace(re, S(v, 'rep'))) }, { out: stats([['Matches', (t.match(re) ?? []).length]]) }] };
      } catch (e) { return err((e as Error).message); }
    },
  },
  {
    id: 'text-diff', name: 'Text diff', cat: 'text', glyph: '±', blurb: 'Compare two texts line by line.',
    fields: [area('a', 'Original', { rows: 5 }), area('b', 'Changed', { rows: 5 })], example: { a: 'one\ntwo\nthree', b: 'one\n2\nthree\nfour' },
    run: (v) => {
      const a = lines(S(v, 'a')), b = lines(S(v, 'b')), n = a.length, m = b.length;
      const L: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
      for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i]![j] = a[i] === b[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
      const rows: Array<{ t: ' ' | '+' | '-'; s: string }> = [];
      let i = 0, j = 0;
      while (i < n && j < m) { if (a[i] === b[j]) { rows.push({ t: ' ', s: a[i]! }); i++; j++; } else if (L[i + 1]![j]! >= L[i]![j + 1]!) rows.push({ t: '-', s: a[i++]! }); else rows.push({ t: '+', s: b[j++]! }); }
      while (i < n) rows.push({ t: '-', s: a[i++]! });
      while (j < m) rows.push({ t: '+', s: b[j++]! });
      return { kind: 'diff', rows };
    },
  },
  {
    id: 'lorem-ipsum', name: 'Lorem ipsum', cat: 'text', glyph: '¶', blurb: 'Placeholder paragraphs, sentences or words.',
    fields: [sel('unit', 'Make', ['paragraphs', 'sentences', 'words'], 'paragraphs'), num('n', 'How many', { default: 3, min: 1, max: 50 }), num('seed', 'Seed (0 = random)', { default: 0 })], example: { unit: 'paragraphs', n: 2, seed: 7 }, manual: false,
    run: (v) => {
      const r = rand(N(v, 'seed')), n = Math.max(1, Math.min(50, N(v, 'n', 3)));
      const sentence = () => { const k = 6 + Math.floor(r() * 9); const w = Array.from({ length: k }, () => pick(r, LOREM)); return cap(w.join(' ')).replace(/^./, (c) => c.toUpperCase()) + '.'; };
      const para = () => Array.from({ length: 3 + Math.floor(r() * 4) }, sentence).join(' ');
      const u = S(v, 'unit');
      return text(u === 'words' ? Array.from({ length: n }, () => pick(r, LOREM)).join(' ') : u === 'sentences' ? Array.from({ length: n }, sentence).join(' ') : Array.from({ length: n }, para).join('\n\n'));
    },
  },
  {
    id: 'text-to-binary', name: 'Text ⇄ binary', cat: 'text', glyph: '01', blurb: 'Text to 8-bit binary, hex or decimal codes, and back.',
    fields: [area('t', 'Input', { rows: 4 }), sel('mode', 'Convert', [{ value: 'bin', label: 'Text → binary' }, { value: 'hex', label: 'Text → hex' }, { value: 'dec', label: 'Text → decimal' }, { value: 'unbin', label: 'Binary → text' }, { value: 'unhex', label: 'Hex → text' }], 'bin')], example: { t: 'Hi!', mode: 'bin' },
    run: (v) => {
      const t = S(v, 't'), m = S(v, 'mode'), bytes = new TextEncoder().encode(t);
      if (m === 'bin') return text([...bytes].map((b) => b.toString(2).padStart(8, '0')).join(' '));
      if (m === 'hex') return text([...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' '));
      if (m === 'dec') return text([...bytes].join(' '));
      try {
        const parts = t.trim().split(/\s+/).filter(Boolean).map((p) => parseInt(p, m === 'unbin' ? 2 : 16));
        if (parts.some((x) => !Number.isFinite(x) || x > 255)) return err('Use bytes: 8 binary digits or 2 hex digits, separated by spaces.');
        return text(new TextDecoder().decode(Uint8Array.from(parts)));
      } catch { return err('That could not be decoded.'); }
    },
  },
  {
    id: 'morse-code', name: 'Morse code', cat: 'text', glyph: '·−', blurb: 'Encode text to Morse and decode Morse to text.',
    fields: [area('t', 'Input', { rows: 3 }), sel('mode', 'Direction', [{ value: 'enc', label: 'Text → Morse' }, { value: 'dec', label: 'Morse → text' }], 'enc')], example: { t: 'SOS help', mode: 'enc' },
    run: (v) => {
      const t = S(v, 't');
      if (S(v, 'mode') === 'enc') return text([...t.toLowerCase()].map((c) => (c === ' ' ? '/' : MORSE[c] ?? '?')).join(' '));
      const rev = Object.fromEntries(Object.entries(MORSE).map(([k, x]) => [x, k]));
      return text(t.trim().split(/\s+/).map((c) => (c === '/' ? ' ' : rev[c] ?? '?')).join(''));
    },
  },
  {
    id: 'nato-alphabet', name: 'NATO phonetic', cat: 'text', glyph: 'Αβ', blurb: 'Spell words with Alfa, Bravo, Charlie…',
    fields: [txt('t', 'Word or name')], example: { t: 'Chomu 24' },
    run: (v) => list([...S(v, 't').toLowerCase()].filter((c) => c !== ' ').map((c) => `${c.toUpperCase()} — ${NATO[c] ?? c}`)),
  },
  {
    id: 'caesar-cipher', name: 'Caesar & ROT13', cat: 'text', glyph: '⟳', blurb: 'Shift letters by any amount (13 = ROT13).',
    fields: [area('t', 'Text', { rows: 3 }), num('shift', 'Shift', { default: 13, min: -25, max: 25 }), tog('dec', 'Decode (shift back)')], example: { t: 'Hello, World!', shift: 13, dec: false },
    run: (v) => {
      const k = ((((B(v, 'dec') ? -1 : 1) * N(v, 'shift', 13)) % 26) + 26) % 26;
      return text(S(v, 't').replace(/[a-z]/gi, (c) => { const b = c <= 'Z' ? 65 : 97; return String.fromCharCode(((c.charCodeAt(0) - b + k) % 26) + b); }));
    },
  },
  {
    id: 'pig-latin', name: 'Pig Latin', cat: 'text', glyph: 'Pig', blurb: 'Translate English into Pig Latin.',
    fields: [area('t', 'Text', { rows: 3 })], example: { t: 'hello smart world' },
    run: (v) => text(S(v, 't').replace(/[a-z]+/gi, (w) => { const m = /^([^aeiou]*)(.*)$/i.exec(w)!; return m[1] ? `${m[2]}${m[1]}ay` : `${w}way`; })),
  },
  {
    id: 'text-repeater', name: 'Text repeater', cat: 'text', glyph: '×n', blurb: 'Repeat a text any number of times with a separator.',
    fields: [txt('t', 'Text'), num('n', 'Times', { default: 3, min: 1, max: 1000 }), txt('sep', 'Separator', { default: ' ' })], example: { t: 'ha', n: 4, sep: '-' },
    run: (v) => text(Array.from({ length: Math.max(1, Math.min(1000, N(v, 'n', 3))) }, () => S(v, 't')).join(S(v, 'sep'))),
  },
  {
    id: 'string-escape', name: 'Escape / unescape', cat: 'text', glyph: '\\n', blurb: 'Escape or unescape JSON, JS or regex strings.',
    fields: [area('t', 'Text', { rows: 4, mono: true }), sel('mode', 'Mode', [{ value: 'json', label: 'JSON escape' }, { value: 'unjson', label: 'JSON unescape' }, { value: 'regex', label: 'Regex escape' }], 'json')], example: { t: 'He said "hi"\nnew line', mode: 'json' },
    run: (v) => {
      const t = S(v, 't'), m = S(v, 'mode');
      if (m === 'json') return text(JSON.stringify(t).slice(1, -1));
      if (m === 'regex') return text(t.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&'));
      try { return text(JSON.parse(`"${t.replace(/"/g, '\\"').replace(/\\\\"/g, '\\"')}"`)); } catch { return err('That is not a valid escaped string.'); }
    },
  },
  {
    id: 'char-frequency', name: 'Letter frequency', cat: 'text', glyph: 'icon:chart', blurb: 'Which letters and words are used most.',
    fields: [area('t', 'Text', { rows: 5 }), sel('what', 'Count', [{ value: 'letters', label: 'Letters' }, { value: 'words', label: 'Words' }, { value: 'all', label: 'All characters' }], 'letters')], example: { t: 'Banana bandana banana', what: 'letters' },
    run: (v) => {
      const t = S(v, 't').toLowerCase(), what = S(v, 'what'), m = new Map<string, number>();
      const items = what === 'words' ? (t.match(/[\p{L}\p{N}']+/gu) ?? []) : what === 'all' ? [...t].filter((c) => !/\s/.test(c)) : (t.match(/\p{L}/gu) ?? []);
      for (const x of items) m.set(x, (m.get(x) ?? 0) + 1);
      return { kind: 'bars', items: [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 20).map(([label, value]) => ({ label, value })) };
    },
  },
  {
    id: 'extract-data', name: 'Extract emails, links, numbers', cat: 'text', glyph: '@#', blurb: 'Pull emails, URLs, phone numbers, hashtags or numbers out of text.',
    fields: [area('t', 'Text', { rows: 5 }), sel('what', 'Find', [{ value: 'email', label: 'Emails' }, { value: 'url', label: 'Links' }, { value: 'phone', label: 'Phone numbers' }, { value: 'hashtag', label: 'Hashtags' }, { value: 'mention', label: '@mentions' }, { value: 'number', label: 'Numbers' }], 'email')], example: { t: 'Mail a@b.com or visit https://chomu.app/x?y=1 #fun @bro 12.5', what: 'url' },
    run: (v) => {
      const re: Record<string, RegExp> = { email: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, url: /https?:\/\/[^\s<>"')]+/g, phone: /\+?\d[\d\s().-]{7,}\d/g, hashtag: /#[\p{L}\p{N}_]+/gu, mention: /@[\w.]+/g, number: /-?\d+(?:\.\d+)?/g };
      const found = [...new Set(S(v, 't').match(re[S(v, 'what')]!) ?? [])];
      return found.length ? list(found) : text('Nothing found.');
    },
  },
  {
    id: 'remove-accents', name: 'Remove accents', cat: 'text', glyph: 'e/é', blurb: 'Strip accents and diacritics (Café → Cafe).',
    fields: [area('t', 'Text', { rows: 4 })], example: { t: 'Crème brûlée à la Zoë' },
    run: (v) => text(S(v, 't').normalize('NFD').replace(/[̀-ͯ]/g, '')),
  },
  {
    id: 'fancy-text', name: 'Fancy text', cat: 'text', glyph: '𝓕', blurb: 'Bold, italic, script, double-struck, circled and more Unicode styles.',
    fields: [txt('t', 'Text')], example: { t: 'Chomugiri 24' },
    run: (v) => {
      const mk = (up: number, low: number, dig?: number) => (s: string) => [...s].map((c) => { const k = c.charCodeAt(0); return k >= 65 && k <= 90 && up ? String.fromCodePoint(up + k - 65) : k >= 97 && k <= 122 && low ? String.fromCodePoint(low + k - 97) : k >= 48 && k <= 57 && dig ? String.fromCodePoint(dig + k - 48) : c; }).join('');
      const styles: Array<[string, (s: string) => string]> = [['Bold', mk(0x1d400, 0x1d41a, 0x1d7ce)], ['Italic', mk(0x1d434, 0x1d44e)], ['Bold italic', mk(0x1d468, 0x1d482)], ['Script', mk(0x1d4d0, 0x1d4ea)], ['Fraktur', mk(0x1d56c, 0x1d586)], ['Double-struck', mk(0x1d538, 0x1d552, 0x1d7d8)], ['Monospace', mk(0x1d670, 0x1d68a, 0x1d7f6)], ['Sans bold', mk(0x1d5d4, 0x1d5ee, 0x1d7ec)], ['Circled', mk(0x24b6, 0x24d0)], ['Squared', mk(0x1f130, 0x1f130)], ['Fullwidth', mk(0xff21, 0xff41, 0xff10)]];
      return table(['Style', 'Result'], styles.map(([n, f]) => [n, f(S(v, 't'))]));
    },
  },
  {
    id: 'upside-down', name: 'Upside-down text', cat: 'text', glyph: 'ɐq', blurb: 'Flip text upside down.',
    fields: [txt('t', 'Text')], example: { t: 'Hello World' },
    run: (v) => {
      const from = 'abcdefghijklmnopqrstuvwxyz.,!?\'"()[]{}<>_&;', to = 'ɐqɔpǝɟƃɥᴉɾʞlɯuodbɹsʇnʌʍxʎz˙\'¡¿,„)(][}{><‾⅋؛';
      return text([...S(v, 't').toLowerCase()].map((c) => { const i = from.indexOf(c); return i >= 0 ? to[i]! : c; }).reverse().join(''));
    },
  },
  {
    id: 'word-wrap', name: 'Word wrap', cat: 'text', glyph: 'wrap', blurb: 'Wrap text to a fixed line width.',
    fields: [area('t', 'Text', { rows: 5 }), num('w', 'Width', { default: 40, min: 10, max: 200 })], example: { t: 'The quick brown fox jumps over the lazy dog and keeps running through the field.', w: 24 },
    run: (v) => {
      const w = Math.max(10, N(v, 'w', 40)), out: string[] = [];
      for (const para of lines(S(v, 't'))) { let cur = ''; for (const x of words(para)) { if ((cur + ' ' + x).trim().length > w) { if (cur) out.push(cur); cur = x; } else cur = (cur + ' ' + x).trim(); } out.push(cur); }
      return text(out.join('\n'));
    },
  },
  {
    id: 'list-converter', name: 'List ⇄ comma', cat: 'text', glyph: 'a,b', blurb: 'Lines to comma separated and back, with quotes if you like.',
    fields: [area('t', 'Input', { rows: 5 }), sel('mode', 'Convert', [{ value: 'tocsv', label: 'Lines → one line' }, { value: 'tolines', label: 'One line → lines' }], 'tocsv'), txt('sep', 'Separator', { default: ', ' }), sel('q', 'Quotes', [{ value: '', label: 'None' }, { value: '"', label: 'Double "' }, { value: "'", label: "Single '" }], '')], example: { t: 'red\ngreen\nblue', mode: 'tocsv', sep: ', ', q: '"' },
    run: (v) => {
      const q = S(v, 'q'), sep = S(v, 'sep') || ', ';
      if (S(v, 'mode') === 'tocsv') return text(lines(S(v, 't')).map((l) => l.trim()).filter(Boolean).map((l) => q + l + q).join(sep));
      return text(S(v, 't').split(sep.trim() || ',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean).join('\n'));
    },
  },
  {
    id: 'prefix-suffix', name: 'Prefix & suffix lines', cat: 'text', glyph: '[ ]', blurb: 'Add text before and after every line.',
    fields: [area('t', 'Lines', { rows: 4 }), txt('pre', 'Before every line'), txt('suf', 'After every line')], example: { t: 'a\nb\nc', pre: '<li>', suf: '</li>' },
    run: (v) => text(lines(S(v, 't')).map((l) => S(v, 'pre') + l + S(v, 'suf')).join('\n')),
  },
  {
    id: 'palindrome', name: 'Palindrome & anagram', cat: 'text', glyph: 'abba', blurb: 'Check if a text is a palindrome, or if two texts are anagrams.',
    fields: [txt('a', 'Text'), txt('b', 'Second text (for anagram)')], example: { a: 'A man, a plan, a canal: Panama', b: 'listen' },
    run: (v) => {
      const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      const a = norm(S(v, 'a')), b = norm(S(v, 'b'));
      const sort = (s: string) => [...s].sort().join('');
      return stats([['Palindrome?', a && a === [...a].reverse().join('') ? 'Yes ✓' : 'No'], ['Anagram of the second?', a && b ? (sort(a) === sort(b) ? 'Yes ✓' : 'No') : '—'], ['Letters compared', a.length]]);
    },
  },
  {
    id: 'vowel-counter', name: 'Vowels & consonants', cat: 'text', glyph: 'AEI', blurb: 'Count vowels, consonants, digits and symbols.',
    fields: [area('t', 'Text', { rows: 4 })], example: { t: 'Chomugiri 2024!' },
    run: (v) => { const t = S(v, 't'); const vow = (t.match(/[aeiou]/gi) ?? []).length, let_ = (t.match(/\p{L}/gu) ?? []).length; return stats([['Vowels', vow], ['Consonants', let_ - vow], ['Digits', (t.match(/\d/g) ?? []).length], ['Spaces', (t.match(/\s/g) ?? []).length], ['Symbols', (t.match(/[^\p{L}\p{N}\s]/gu) ?? []).length]]); },
  },
  {
    id: 'acronym-maker', name: 'Acronym maker', cat: 'text', glyph: 'ABC', blurb: 'First letters of every word, in capitals.',
    fields: [txt('t', 'Phrase'), tog('skip', 'Skip small words (of, the, and…)', true)], example: { t: 'Portable Network Graphics of the web', skip: true },
    run: (v) => text(words(S(v, 't')).filter((w) => !(B(v, 'skip') && /^(of|the|and|a|an|in|on|for|to)$/i.test(w))).map((w) => w[0]!.toUpperCase()).join('')),
  },
  {
    id: 'text-columns', name: 'Text to table', cat: 'text', glyph: 'icon:table', blurb: 'Align columns of text (tab, comma or space separated) into a neat table.',
    fields: [area('t', 'Rows', { rows: 5, mono: true }), sel('sep', 'Separated by', [{ value: ',', label: 'Comma' }, { value: '\t', label: 'Tab' }, { value: ' ', label: 'Space' }, { value: ';', label: 'Semicolon' }, { value: '|', label: 'Pipe' }], ',')], example: { t: 'name,age\nAsha,24\nRavi,31', sep: ',' },
    run: (v) => {
      const rows = lines(S(v, 't')).filter(Boolean).map((l) => l.split(S(v, 'sep')).map((c) => c.trim()));
      return rows.length ? table(rows[0]!, rows.slice(1)) : err('Add some rows.');
    },
  },
  {
    id: 'random-text-picker', name: 'Pick a random line', cat: 'text', glyph: 'icon:dice', blurb: 'Pick one or more random lines from your list.',
    fields: [area('t', 'Options (one per line)', { rows: 5 }), num('n', 'How many', { default: 1, min: 1, max: 50 }), num('seed', 'Seed (0 = random)', { default: 0 })], example: { t: 'pizza\nburger\nbiryani\nmomos', n: 2, seed: 3 }, manual: true,
    run: (v) => {
      const a = lines(S(v, 't')).filter((x) => x.trim()), r = rand(N(v, 'seed'));
      if (!a.length) return err('Add some options.');
      const pool = [...a]; const out: string[] = [];
      for (let i = 0; i < Math.min(pool.length, N(v, 'n', 1)); i++) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]!);
      return list(out);
    },
  },
];
