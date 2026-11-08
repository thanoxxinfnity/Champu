import { col, contrast, err, fmt, hexToRgb, hslHex, N, num, pick, rand, rgbToHex, rgbToHsl, rng, S, sel, stats, table, text, tog, txt, B } from '../helpers.ts';
import type { ToolDef } from '../types.ts';

const NAMED: Array<[string, string]> = [['black', '#000000'], ['white', '#ffffff'], ['red', '#ff0000'], ['lime', '#00ff00'], ['blue', '#0000ff'], ['yellow', '#ffff00'], ['cyan', '#00ffff'], ['magenta', '#ff00ff'], ['silver', '#c0c0c0'], ['gray', '#808080'], ['maroon', '#800000'], ['olive', '#808000'], ['green', '#008000'], ['purple', '#800080'], ['teal', '#008080'], ['navy', '#000080'], ['orange', '#ffa500'], ['pink', '#ffc0cb'], ['brown', '#a52a2a'], ['gold', '#ffd700'], ['coral', '#ff7f50'], ['salmon', '#fa8072'], ['indigo', '#4b0082'], ['violet', '#ee82ee'], ['turquoise', '#40e0d0'], ['crimson', '#dc143c'], ['khaki', '#f0e68c'], ['lavender', '#e6e6fa'], ['beige', '#f5f5dc'], ['tomato', '#ff6347'], ['skyblue', '#87ceeb'], ['saffron', '#ff9933'], ['chocolate', '#d2691e'], ['plum', '#dda0dd']];
const parseColor = (s: string): [number, number, number] | null => {
  const t = s.trim().toLowerCase();
  const named = NAMED.find(([n]) => n === t); if (named) return hexToRgb(named[1]);
  const hx = hexToRgb(t.startsWith('#') || /^[0-9a-f]{3}$|^[0-9a-f]{6}$/.test(t) ? t : ''); if (hx) return hx;
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(t); if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const hsl = /^hsla?\(\s*([\d.]+)[\s,]+([\d.]+)%?[\s,]+([\d.]+)%?/.exec(t); if (hsl) { const h = Number(hsl[1]), s = Number(hsl[2]) / 100, l = Number(hsl[3]) / 100, k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return [f(0) * 255, f(8) * 255, f(4) * 255]; }
  return null;
};
const toCmyk = ([r, g, b]: [number, number, number]) => { const k = 1 - Math.max(r, g, b) / 255; return k === 1 ? [0, 0, 0, 100] : [(1 - r / 255 - k) / (1 - k), (1 - g / 255 - k) / (1 - k), (1 - b / 255 - k) / (1 - k), k].map((x) => Math.round(x * 100)); };
const base = (v: Record<string, string | number | boolean>): [number, number, number] | null => parseColor(S(v, 'c'));

export const colorTools: ToolDef[] = [
  {
    id: 'color-converter', name: 'Color converter', cat: 'color', glyph: 'icon:palette2', blurb: 'HEX, RGB, HSL, HSV and CMYK from any of them, with a name guess.',
    fields: [col('pick', 'Pick', '#7c5cff'), txt('c', 'Or type a colour', { default: '#7c5cff', mono: true })], example: { pick: '#7c5cff', c: '#7c5cff' },
    run: (v) => {
      const c = parseColor(S(v, 'c')) ?? hexToRgb(S(v, 'pick')); if (!c) return err('Try #ff8800, rgb(255,136,0), hsl(32,100%,50%) or a name.');
      const [h, s, l] = rgbToHsl(...c), mx = Math.max(...c) / 255, mn = Math.min(...c) / 255, hex = rgbToHex(...c);
      const near = NAMED.map(([n, x]) => { const y = hexToRgb(x)!; return [n, Math.hypot(c[0] - y[0], c[1] - y[1], c[2] - y[2])] as const; }).sort((a, b) => a[1] - b[1])[0]![0];
      return { kind: 'multi', parts: [{ out: { kind: 'swatches', items: [{ hex, label: near }] } }, { out: table(['Format', 'Value'], [['HEX', hex.toUpperCase()], ['RGB', `rgb(${c.map(Math.round).join(', ')})`], ['HSL', `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`], ['HSV', `hsv(${Math.round(h)}, ${Math.round(mx ? ((mx - mn) / mx) * 100 : 0)}%, ${Math.round(mx * 100)}%)`], ['CMYK', `cmyk(${toCmyk(c).join('%, ')}%)`], ['Closest name', near]]) }] };
    },
  },
  {
    id: 'palette-generator', name: 'Palette from one colour', cat: 'color', glyph: 'icon:palette2', blurb: 'Complementary, triadic, analogous and split palettes.',
    fields: [col('c', 'Base colour', '#7c5cff'), sel('mode', 'Scheme', ['complementary', 'triadic', 'analogous', 'split-complementary', 'tetradic', 'monochrome'], 'triadic')], example: { c: '#7c5cff', mode: 'triadic' },
    run: (v) => { const c = hexToRgb(S(v, 'c')); if (!c) return err('Pick a colour.'); const [h, s, l] = rgbToHsl(...c); const rot = (d: number) => hslHex(h + d, s, l); const m = S(v, 'mode'); const items = m === 'complementary' ? [rot(0), rot(180)] : m === 'triadic' ? [rot(0), rot(120), rot(240)] : m === 'analogous' ? [rot(-30), rot(0), rot(30)] : m === 'split-complementary' ? [rot(0), rot(150), rot(210)] : m === 'tetradic' ? [rot(0), rot(90), rot(180), rot(270)] : [15, 30, 50, 70, 90].map((x) => hslHex(h, s, x)); return { kind: 'swatches', items: items.map((hex) => ({ hex })) }; },
  },
  {
    id: 'shade-generator', name: 'Shades & tints', cat: 'color', glyph: 'icon:circleHalf', blurb: 'A 50–900 scale from one colour, like Tailwind.',
    fields: [col('c', 'Base colour', '#7c5cff')], example: { c: '#7c5cff' },
    run: (v) => { const c = hexToRgb(S(v, 'c')); if (!c) return err('Pick a colour.'); const [h, s] = rgbToHsl(...c); const steps = [[50, 96], [100, 91], [200, 82], [300, 72], [400, 62], [500, 52], [600, 44], [700, 36], [800, 27], [900, 18]]; return { kind: 'swatches', items: steps.map(([n, l]) => ({ hex: hslHex(h, s, l!), label: String(n) })) }; },
  },
  {
    id: 'contrast-checker', name: 'Contrast checker', cat: 'color', glyph: 'Aa', blurb: 'WCAG contrast of text on a background.',
    fields: [col('fg', 'Text', '#ffffff'), col('bg', 'Background', '#7c5cff')], example: { fg: '#ffffff', bg: '#7c5cff' },
    run: (v) => { const r = contrast(S(v, 'fg'), S(v, 'bg')); const ok = (x: number) => (r >= x ? 'Pass ✓' : 'Fail ✗'); return { kind: 'multi', parts: [{ out: { kind: 'css', css: '', preview: `background:${S(v, 'bg')};color:${S(v, 'fg')};font:600 22px system-ui;display:grid;place-items:center` } }, { out: stats([['Contrast', `${fmt(r, 2)} : 1`], ['AA normal text (4.5)', ok(4.5)], ['AA large text (3)', ok(3)], ['AAA normal (7)', ok(7)], ['AAA large (4.5)', ok(4.5)]]) }] }; },
  },
  {
    id: 'color-mixer', name: 'Color mixer', cat: 'color', glyph: 'icon:flask', blurb: 'Blend two colours in steps.',
    fields: [col('a', 'Colour A', '#ff3b6b'), col('b', 'Colour B', '#3b82f6'), num('n', 'Steps', { default: 7, min: 3, max: 15 })], example: { a: '#ff3b6b', b: '#3b82f6', n: 7 },
    run: (v) => { const a = hexToRgb(S(v, 'a')), b = hexToRgb(S(v, 'b')); if (!a || !b) return err('Pick two colours.'); const n = Math.max(3, Math.min(15, N(v, 'n', 7))); return { kind: 'swatches', items: Array.from({ length: n }, (_, i) => ({ hex: rgbToHex(...(a.map((x, k) => x + ((b[k]! - x) * i) / (n - 1)) as [number, number, number])) })) }; },
  },
  {
    id: 'lighten-darken', name: 'Lighten / darken', cat: 'color', glyph: 'icon:circleHalf', blurb: 'Adjust lightness, saturation and hue.',
    fields: [col('c', 'Colour', '#7c5cff'), rng('l', 'Lightness', -50, 50, 15, 1, '%'), rng('s', 'Saturation', -50, 50, 0, 1, '%'), rng('h', 'Hue shift', -180, 180, 0, 1, '°')], example: { c: '#7c5cff', l: 15, s: 0, h: 0 },
    run: (v) => { const c = hexToRgb(S(v, 'c')); if (!c) return err('Pick a colour.'); const [h, s, l] = rgbToHsl(...c); const out = hslHex(h + N(v, 'h'), Math.max(0, Math.min(100, s + N(v, 's'))), l + N(v, 'l')); return { kind: 'swatches', items: [{ hex: S(v, 'c'), label: 'before' }, { hex: out, label: 'after' }] }; },
  },
  {
    id: 'random-color', name: 'Random colors', cat: 'color', glyph: 'icon:dice', blurb: 'Random pleasant colours (vivid, pastel or dark).',
    fields: [sel('style', 'Style', ['vivid', 'pastel', 'dark', 'any'], 'vivid'), num('n', 'How many', { default: 8, min: 1, max: 24 })], example: { style: 'pastel', n: 6 }, manual: true,
    run: (v) => { const r = rand(); const st = S(v, 'style'); return { kind: 'swatches', items: Array.from({ length: Math.max(1, Math.min(24, N(v, 'n', 8))) }, () => ({ hex: st === 'pastel' ? hslHex(r() * 360, 70, 85) : st === 'dark' ? hslHex(r() * 360, 50, 22) : st === 'any' ? rgbToHex(r() * 255, r() * 255, r() * 255) : hslHex(r() * 360, 85, 55) })) }; },
  },
  {
    id: 'hex-to-rgba', name: 'HEX → rgba()', cat: 'color', glyph: 'rgba', blurb: 'Add transparency to any colour, with 8-digit hex.',
    fields: [col('c', 'Colour', '#7c5cff'), rng('a', 'Opacity', 0, 100, 60, 1, '%')], example: { c: '#7c5cff', a: 60 },
    run: (v) => { const c = hexToRgb(S(v, 'c')); if (!c) return err('Pick a colour.'); const a = N(v, 'a') / 100; return table(['Format', 'Value'], [['rgba()', `rgba(${c.join(', ')}, ${a})`], ['8-digit hex', S(v, 'c') + Math.round(a * 255).toString(16).padStart(2, '0')], ['hsla()', (() => { const [h, s, l] = rgbToHsl(...c); return `hsla(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%, ${a})`; })()]]); },
  },
  {
    id: 'colorblind-sim', name: 'Color-blind preview', cat: 'color', glyph: 'icon:eye', blurb: 'How a colour looks with common colour-vision types.',
    fields: [col('c', 'Colour', '#e0457b')], example: { c: '#e0457b' },
    run: (v) => {
      const c = hexToRgb(S(v, 'c')); if (!c) return err('Pick a colour.');
      const M: Record<string, number[]> = { Normal: [1, 0, 0, 0, 1, 0, 0, 0, 1], 'Protanopia (red-blind)': [0.567, 0.433, 0, 0.558, 0.442, 0, 0, 0.242, 0.758], 'Deuteranopia (green-blind)': [0.625, 0.375, 0, 0.7, 0.3, 0, 0, 0.3, 0.7], 'Tritanopia (blue-blind)': [0.95, 0.05, 0, 0, 0.433, 0.567, 0, 0.475, 0.525], Achromatopsia: [0.299, 0.587, 0.114, 0.299, 0.587, 0.114, 0.299, 0.587, 0.114] };
      return { kind: 'swatches', items: Object.entries(M).map(([n, m]) => ({ hex: rgbToHex(m[0]! * c[0] + m[1]! * c[1] + m[2]! * c[2], m[3]! * c[0] + m[4]! * c[1] + m[5]! * c[2], m[6]! * c[0] + m[7]! * c[1] + m[8]! * c[2]), label: n })) };
    },
  },
  {
    id: 'text-on-color', name: 'Readable text color', cat: 'color', glyph: 'Aa', blurb: 'Black or white text for any background.',
    fields: [col('c', 'Background', '#ffb703')], example: { c: '#ffb703' },
    run: (v) => { const w = contrast('#ffffff', S(v, 'c')), b = contrast('#000000', S(v, 'c')); return { kind: 'multi', parts: [{ out: { kind: 'css', css: '', preview: `background:${S(v, 'c')};color:${b >= w ? '#000' : '#fff'};font:700 24px system-ui;display:grid;place-items:center` } }, { out: stats([['Best text', b >= w ? 'Black' : 'White'], ['Contrast', `${fmt(Math.max(w, b), 2)} : 1`]]) }] }; },
  },
  {
    id: 'named-colors', name: 'Color names', cat: 'color', glyph: 'abc', blurb: 'Browse and search named CSS colours.',
    fields: [txt('q', 'Search', { placeholder: 'blue' })], example: { q: 'o' },
    run: (v) => { const q = S(v, 'q').toLowerCase(); const r = NAMED.filter(([n]) => !q || n.includes(q)); return r.length ? { kind: 'swatches', items: r.map(([n, hex]) => ({ hex, label: n })) } : text('No colour with that name here.'); },
  },
  {
    id: 'gradient-palette', name: 'Gradient steps', cat: 'color', glyph: 'icon:table', blurb: 'Colours along a gradient between two or three stops.',
    fields: [col('a', 'Start', '#7c5cff'), col('b', 'Middle', '#ff6ec7'), col('c', 'End', '#22d3ee'), num('n', 'Steps', { default: 9, min: 3, max: 20 })], example: { a: '#7c5cff', b: '#ff6ec7', c: '#22d3ee', n: 9 },
    run: (v) => { const stops = [S(v, 'a'), S(v, 'b'), S(v, 'c')].map((x) => hexToRgb(x)); if (stops.some((x) => !x)) return err('Pick three colours.'); const n = Math.max(3, Math.min(20, N(v, 'n', 9))); const at = (t: number) => { const seg = t < 0.5 ? [stops[0]!, stops[1]!, t * 2] : [stops[1]!, stops[2]!, (t - 0.5) * 2]; const [p, q, k] = seg as [number[], number[], number]; return rgbToHex(...(p.map((x, i) => x + (q[i]! - x) * k) as [number, number, number])); }; return { kind: 'swatches', items: Array.from({ length: n }, (_, i) => ({ hex: at(i / (n - 1)) })) }; },
  },
  {
    id: 'color-temperature', name: 'Warm / cool tint', cat: 'color', glyph: 'icon:thermometer', blurb: 'Shift a colour warmer or cooler.',
    fields: [col('c', 'Colour', '#a0b4ff'), rng('t', 'Warm ← → Cool', -100, 100, -40)], example: { c: '#a0b4ff', t: -40 },
    run: (v) => { const c = hexToRgb(S(v, 'c')); if (!c) return err('Pick a colour.'); const t = N(v, 't') / 100; return { kind: 'swatches', items: [{ hex: S(v, 'c'), label: 'before' }, { hex: rgbToHex(c[0] - 40 * t, c[1], c[2] + 40 * t), label: 'after' }] }; },
  },
  {
    id: 'brand-palette', name: 'Random brand palette', cat: 'color', glyph: 'icon:sparkle', blurb: 'A balanced 5-colour palette: background, surface, text, accent, highlight.',
    fields: [tog('dark', 'Dark theme', true), num('seed', 'Seed (0 = random)', { default: 0 })], example: { dark: true, seed: 11 }, manual: true,
    run: (v) => { const r = rand(N(v, 'seed')), h = r() * 360, d = B(v, 'dark'); return { kind: 'swatches', items: [{ hex: hslHex(h, 25, d ? 8 : 97), label: 'background' }, { hex: hslHex(h, 22, d ? 14 : 92), label: 'surface' }, { hex: hslHex(h, 15, d ? 92 : 12), label: 'text' }, { hex: hslHex(h + 8, 80, 58), label: 'accent' }, { hex: hslHex(h + 150, 75, 60), label: 'highlight' }] }; },
  },
];
void pick;
