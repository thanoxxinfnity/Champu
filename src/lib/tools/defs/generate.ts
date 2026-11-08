import qrcode from 'qrcode-generator';
import { area, B, col, err, escapeHtml, fmt, hexToRgb, N, num, pick, rand, rng, S, sel, stats, table, text, tog, txt, words, list, gcd } from '../helpers.ts';
import type { ToolDef } from '../types.ts';

const WORDS = 'able acid aged also area army away baby back ball band bank base bath bear beat bell belt best bike bird blue boat body bold bone book boot born boss bowl bulb burn cafe cake calm camp card care cash cast cell chat chef chip city clay club coal coat code coin cold cook cool corn cost crew crop dark data dawn deal deep deer desk dish dive door down draw drop drum duck dust duty each earn east easy echo edge epic even ever exam face fact fair fall farm fast fear feed feel fern file film find fire fish flag flat flow foam fold food foot fork form fort four free from fuel full fund gain game gate gear gift girl glad glow goal gold golf good grab gray grid grow gulf hair half hall hand hard harp hawk heal heat help herb hero hill hold home hope horn host hour huge hunt idea inch iron jade jazz join joke jump june jury keen keep kind king kite knot lake lamp land lane last lead leaf lean life lift line lion list live loan lock long look loop lord love luck lush main make mall mane many map mark mask mass meal meet melt menu mild mile milk mind mint miss mode moon more moss move much music name navy near neat neck nest news nice node noon note oath ocean olive once only open oval pace pack page pail palm park part path peak pear pine pink pipe plan play plum pond pool port pure quay quick quiet race rain rank rare reed rest rice ride ring rise road rock roof room root rope rose ruby rush safe sail salt sand seal seed self shop show side silk sing site skin sky slim snow soft soil song soon star stay step stir sun swim tale tall team tent test tide tile time tiny tone tool tour town tree trip true tune turn twin vale vast view vine walk wall warm wave wind wing wise wolf wood wool word work yard year zero zone'.split(' ');
const FIRST = ['Aarav', 'Aditi', 'Arjun', 'Ananya', 'Bhavya', 'Chirag', 'Divya', 'Ishaan', 'Kavya', 'Karan', 'Meera', 'Neha', 'Nikhil', 'Pooja', 'Rahul', 'Riya', 'Rohan', 'Saanvi', 'Sahil', 'Tanvi', 'Vikram', 'Zoya', 'Maya', 'Leo', 'Nora', 'Omar', 'Sofia', 'Liam', 'Emma', 'Noah'];
const LAST = ['Sharma', 'Verma', 'Gupta', 'Patel', 'Singh', 'Khan', 'Reddy', 'Nair', 'Iyer', 'Das', 'Mehta', 'Joshi', 'Kapoor', 'Bose', 'Rao', 'Chopra', 'Malhotra', 'Sinha', 'Smith', 'Brown', 'Garcia', 'Lee', 'Walker', 'Young'];
const CITIES = ['Mumbai', 'Delhi', 'Bengaluru', 'Pune', 'Jaipur', 'Kolkata', 'Chennai', 'Hyderabad', 'Lucknow', 'Indore', 'Goa', 'Surat'];

export function qrSvg(data: string, level: 'L' | 'M' | 'Q' | 'H' = 'M', cell = 8, margin = 4, fg = '#000000', bg = '#ffffff'): string {
  const q = qrcode(0, level);
  q.addData(unescape(encodeURIComponent(data)));
  q.make();
  const n = q.getModuleCount(), size = (n + margin * 2) * cell;
  let path = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) path += `M${(c + margin) * cell},${(r + margin) * cell}h${cell}v${cell}h-${cell}z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="${bg}"/><path d="${path}" fill="${fg}"/></svg>`;
}

export function makePassword(len: number, o: { lower: boolean; upper: boolean; digits: boolean; symbols: boolean; noAmbiguous: boolean }, r: () => number): string {
  let sets = [o.lower && 'abcdefghijklmnopqrstuvwxyz', o.upper && 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', o.digits && '0123456789', o.symbols && '!@#$%^&*()-_=+[]{};:,.?'].filter(Boolean) as string[];
  if (o.noAmbiguous) sets = sets.map((s) => s.replace(/[O0Il1|]/g, ''));
  if (!sets.length) return '';
  len = Math.max(1, Math.min(256, Math.trunc(len) || 16));
  const all = sets.join(''); const out = sets.map((s) => pick(r, [...s]));
  while (out.length < len) out.push(pick(r, [...all]));
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out.slice(0, len).join('');
}

export const generateTools: ToolDef[] = [
  {
    id: 'password-generator', name: 'Password generator', cat: 'generate', glyph: 'icon:lock', blurb: 'Strong random passwords, made on your device and never sent anywhere.',
    fields: [rng('len', 'Length', 6, 64, 16), tog('lower', 'a–z', true), tog('upper', 'A–Z', true), tog('digits', '0–9', true), tog('symbols', 'Symbols', true), tog('noAmbiguous', 'Skip look-alikes (O 0 l 1 I)', true), num('n', 'How many', { default: 5, min: 1, max: 20 })], example: { len: 16, lower: true, upper: true, digits: true, symbols: true, noAmbiguous: true, n: 3 }, manual: true,
    run: (v) => { const r = rand(); const o = { lower: B(v, 'lower'), upper: B(v, 'upper'), digits: B(v, 'digits'), symbols: B(v, 'symbols'), noAmbiguous: B(v, 'noAmbiguous') }; const out = Array.from({ length: Math.max(1, Math.min(20, N(v, 'n', 5))) }, () => makePassword(N(v, 'len', 16), o, r)); return out[0] ? list(out) : err('Tick at least one kind of character.'); },
  },
  {
    id: 'passphrase-generator', name: 'Passphrase generator', cat: 'generate', glyph: 'icon:key', blurb: 'Easy-to-remember phrases made of random words.',
    fields: [rng('n', 'Words', 3, 10, 4), txt('sep', 'Separator', { default: '-' }), tog('cap', 'Capitalise', true), tog('num', 'Add a number', true)], example: { n: 4, sep: '-', cap: true, num: true }, manual: true,
    run: (v) => { const r = rand(); return list(Array.from({ length: 5 }, () => { const w = Array.from({ length: Math.max(1, Math.min(12, N(v, 'n', 4))) }, () => { const x = pick(r, WORDS); return B(v, 'cap') ? x[0]!.toUpperCase() + x.slice(1) : x; }); if (B(v, 'num')) w.push(String(Math.floor(r() * 100))); return w.join(S(v, 'sep')); })); },
  },
  {
    id: 'random-string', name: 'Random string / token', cat: 'generate', glyph: '#⃣', blurb: 'Random letters, hex or Base64 tokens of any length.',
    fields: [num('len', 'Length', { default: 32, min: 1, max: 512 }), sel('set', 'Characters', [{ value: 'alnum', label: 'Letters + digits' }, { value: 'hex', label: 'Hex' }, { value: 'b64', label: 'Base64-like' }, { value: 'letters', label: 'Letters' }, { value: 'digits', label: 'Digits' }], 'alnum')], example: { len: 24, set: 'hex' }, manual: true,
    run: (v) => { const sets: Record<string, string> = { alnum: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', hex: '0123456789abcdef', b64: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', letters: 'abcdefghijklmnopqrstuvwxyz', digits: '0123456789' }; const r = rand(); return text(Array.from({ length: Math.max(1, Math.min(512, N(v, 'len', 32))) }, () => pick(r, [...sets[S(v, 'set')]!])).join('')); },
  },
  {
    id: 'qr-code', name: 'QR code maker', cat: 'generate', glyph: 'icon:qr', blurb: 'A QR code for any text, link, Wi-Fi or UPI, as a crisp SVG you can save.',
    fields: [area('t', 'Text or link', { rows: 3, default: 'https://chomu.app' }), sel('lvl', 'Error correction', [{ value: 'L', label: 'Low' }, { value: 'M', label: 'Medium' }, { value: 'Q', label: 'Quartile' }, { value: 'H', label: 'High' }], 'M'), col('fg', 'Colour', '#111111'), col('bg', 'Background', '#ffffff')], example: { t: 'https://chomu.app', lvl: 'M', fg: '#111111', bg: '#ffffff' },
    run: (v) => { const t = S(v, 't'); if (!t) return err('Type something to encode.'); try { return { kind: 'svg', svg: qrSvg(t, S(v, 'lvl') as 'M', 8, 4, S(v, 'fg') || '#000', S(v, 'bg') || '#fff'), name: 'qr-code.svg' }; } catch { return err('That is too long for a QR code. Shorten it or lower the error correction.'); } },
  },
  {
    id: 'wifi-qr', name: 'Wi-Fi QR code', cat: 'generate', glyph: 'icon:signal', blurb: 'Scan to join your Wi-Fi: no typing the password.',
    fields: [txt('ssid', 'Network name', { default: 'HomeWiFi' }), txt('pw', 'Password', { default: 'chai1234' }), sel('sec', 'Security', ['WPA', 'WEP', 'nopass'], 'WPA'), tog('hidden', 'Hidden network')], example: { ssid: 'HomeWiFi', pw: 'chai1234', sec: 'WPA', hidden: false },
    run: (v) => { const e = (s: string) => s.replace(/([\\;,:"])/g, '\\$1'); const data = `WIFI:T:${S(v, 'sec')};S:${e(S(v, 'ssid'))};${S(v, 'sec') === 'nopass' ? '' : `P:${e(S(v, 'pw'))};`}${B(v, 'hidden') ? 'H:true;' : ''};`; return { kind: 'multi', parts: [{ out: { kind: 'svg', svg: qrSvg(data), name: 'wifi-qr.svg' } }, { out: text(data) }] }; },
  },
  {
    id: 'upi-qr', name: 'UPI payment QR', cat: 'generate', glyph: '₹QR', blurb: 'A QR that opens any UPI app with your ID and amount filled in.',
    fields: [txt('vpa', 'UPI ID', { default: 'name@upi' }), txt('name', 'Payee name', { default: 'Chai Stall' }), num('amt', 'Amount (0 = any)', { default: 0 }), txt('note', 'Note', { default: 'Thanks' })], example: { vpa: 'name@upi', name: 'Chai Stall', amt: 50, note: 'Thanks' },
    run: (v) => { if (!/^[\w.-]+@[\w-]+$/.test(S(v, 'vpa'))) return err('A UPI ID looks like name@bank.'); const q = new URLSearchParams({ pa: S(v, 'vpa'), pn: S(v, 'name') }); if (N(v, 'amt') > 0) { q.set('am', String(N(v, 'amt'))); q.set('cu', 'INR'); } if (S(v, 'note')) q.set('tn', S(v, 'note')); const u = `upi://pay?${q}`; return { kind: 'multi', parts: [{ out: { kind: 'svg', svg: qrSvg(u), name: 'upi-qr.svg' } }, { out: text(u) }] }; },
  },
  {
    id: 'placeholder-image', name: 'Placeholder image', cat: 'generate', glyph: 'icon:image', blurb: 'A sized SVG placeholder with your text.',
    fields: [num('w', 'Width', { default: 640, min: 16, max: 4000 }), num('h', 'Height', { default: 360, min: 16, max: 4000 }), txt('t', 'Text (empty = size)'), col('bg', 'Background', '#4f7cff'), col('fg', 'Text colour', '#ffffff')], example: { w: 640, h: 360, t: '', bg: '#4f7cff', fg: '#ffffff' },
    run: (v) => { const w = N(v, 'w', 640), h = N(v, 'h', 360), t = escapeHtml(S(v, 't') || `${w} × ${h}`); return { kind: 'svg', name: 'placeholder.svg', svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="${S(v, 'bg')}"/><text x="50%" y="50%" fill="${S(v, 'fg')}" font-family="system-ui,sans-serif" font-size="${Math.max(12, Math.min(w, h) / 6)}" font-weight="700" text-anchor="middle" dominant-baseline="central">${t}</text></svg>` }; },
  },
  {
    id: 'avatar-generator', name: 'Initials avatar', cat: 'generate', glyph: 'AB', blurb: 'A round avatar with initials on a gradient.',
    fields: [txt('n', 'Name', { default: 'Chomu Giri' }), col('a', 'Colour 1', '#7c5cff'), col('b', 'Colour 2', '#22d3ee'), tog('round', 'Round', true)], example: { n: 'Chomu Giri', a: '#7c5cff', b: '#22d3ee', round: true },
    run: (v) => { const ini = words(S(v, 'n')).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?'; return { kind: 'svg', name: 'avatar.svg', svg: `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${S(v, 'a')}"/><stop offset="1" stop-color="${S(v, 'b')}"/></linearGradient></defs><rect width="256" height="256" rx="${B(v, 'round') ? 128 : 36}" fill="url(#g)"/><text x="50%" y="52%" fill="#fff" font-family="system-ui,sans-serif" font-size="104" font-weight="700" text-anchor="middle" dominant-baseline="central">${escapeHtml(ini)}</text></svg>` }; },
  },
  {
    id: 'svg-pattern', name: 'SVG pattern maker', cat: 'generate', glyph: '▒', blurb: 'Dots, grids, stripes and waves as a repeating background.',
    fields: [sel('kind', 'Pattern', ['dots', 'grid', 'stripes', 'checks', 'waves', 'diamonds'], 'dots'), rng('s', 'Size', 8, 80, 28), col('a', 'Colour', '#7c5cff'), col('bg', 'Background', '#0f1020')], example: { kind: 'dots', s: 28, a: '#7c5cff', bg: '#0f1020' },
    run: (v) => { const s = N(v, 's', 28), a = S(v, 'a'), k = S(v, 'kind'); const tile: Record<string, string> = { dots: `<circle cx="${s / 2}" cy="${s / 2}" r="${s / 8}" fill="${a}"/>`, grid: `<path d="M${s} 0H0V${s}" fill="none" stroke="${a}" stroke-width="1.5"/>`, stripes: `<path d="M0 ${s}L${s} 0" stroke="${a}" stroke-width="${s / 5}"/>`, checks: `<rect width="${s / 2}" height="${s / 2}" fill="${a}"/><rect x="${s / 2}" y="${s / 2}" width="${s / 2}" height="${s / 2}" fill="${a}"/>`, waves: `<path d="M0 ${s / 2}Q${s / 4} 0 ${s / 2} ${s / 2}T${s} ${s / 2}" fill="none" stroke="${a}" stroke-width="2"/>`, diamonds: `<path d="M${s / 2} 2L${s - 2} ${s / 2}L${s / 2} ${s - 2}L2 ${s / 2}Z" fill="none" stroke="${a}" stroke-width="1.5"/>` }; return { kind: 'svg', name: 'pattern.svg', svg: `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320"><defs><pattern id="p" width="${s}" height="${s}" patternUnits="userSpaceOnUse">${tile[k]}</pattern></defs><rect width="100%" height="100%" fill="${S(v, 'bg')}"/><rect width="100%" height="100%" fill="url(#p)"/></svg>` }; },
  },
  {
    id: 'css-gradient', name: 'CSS gradient', cat: 'generate', glyph: 'icon:palette2', blurb: 'Linear, radial or conic gradients with live preview and CSS to copy.',
    fields: [sel('type', 'Type', ['linear', 'radial', 'conic'], 'linear'), rng('deg', 'Angle', 0, 360, 135, 1, '°'), col('a', 'Colour 1', '#7c5cff'), col('b', 'Colour 2', '#22d3ee'), col('c', 'Colour 3 (optional)', '#ff6ec7'), tog('three', 'Use colour 3')], example: { type: 'linear', deg: 135, a: '#7c5cff', b: '#22d3ee', c: '#ff6ec7', three: true },
    run: (v) => { const stops = [S(v, 'a'), S(v, 'b'), ...(B(v, 'three') ? [S(v, 'c')] : [])].join(', '); const t = S(v, 'type'); const g = t === 'linear' ? `linear-gradient(${N(v, 'deg')}deg, ${stops})` : t === 'radial' ? `radial-gradient(circle, ${stops})` : `conic-gradient(from ${N(v, 'deg')}deg, ${stops})`; return { kind: 'css', css: `background: ${g};`, preview: `background:${g}` }; },
  },
  {
    id: 'box-shadow', name: 'Box shadow', cat: 'generate', glyph: 'icon:window', blurb: 'Layered soft shadows with live preview.',
    fields: [rng('x', 'Offset X', -50, 50, 0), rng('y', 'Offset Y', -50, 50, 12), rng('blur', 'Blur', 0, 100, 32), rng('spread', 'Spread', -30, 50, -4), rng('op', 'Opacity', 0, 100, 28, 1, '%'), col('c', 'Colour', '#000000'), tog('inset', 'Inset')], example: { x: 0, y: 12, blur: 32, spread: -4, op: 28, c: '#000000', inset: false },
    run: (v) => { const [r, g, b] = hexToRgb(S(v, 'c')) ?? [0, 0, 0]; const sh = `${B(v, 'inset') ? 'inset ' : ''}${N(v, 'x')}px ${N(v, 'y')}px ${N(v, 'blur')}px ${N(v, 'spread')}px rgba(${r}, ${g}, ${b}, ${N(v, 'op') / 100})`; return { kind: 'css', css: `box-shadow: ${sh};`, preview: `background:#fff;border-radius:16px;box-shadow:${sh}` }; },
  },
  {
    id: 'border-radius', name: 'Border radius', cat: 'generate', glyph: 'icon:circle', blurb: 'Each corner on its own, blobs included.',
    fields: [rng('tl', 'Top left', 0, 100, 30, 1, '%'), rng('tr', 'Top right', 0, 100, 70, 1, '%'), rng('br', 'Bottom right', 0, 100, 60, 1, '%'), rng('bl', 'Bottom left', 0, 100, 40, 1, '%')], example: { tl: 30, tr: 70, br: 60, bl: 40 },
    run: (v) => { const r = `${N(v, 'tl')}% ${N(v, 'tr')}% ${N(v, 'br')}% ${N(v, 'bl')}% / ${N(v, 'bl')}% ${N(v, 'tl')}% ${N(v, 'tr')}% ${N(v, 'br')}%`; return { kind: 'css', css: `border-radius: ${r};`, preview: `background:linear-gradient(135deg,#7c5cff,#22d3ee);border-radius:${r}` }; },
  },
  {
    id: 'glassmorphism', name: 'Glass card', cat: 'generate', glyph: 'icon:window', blurb: 'Frosted-glass CSS (backdrop blur) with preview.',
    fields: [rng('blur', 'Blur', 0, 40, 16, 1, 'px'), rng('op', 'Opacity', 0, 100, 18, 1, '%'), col('c', 'Tint', '#ffffff'), rng('r', 'Radius', 0, 48, 20, 1, 'px')], example: { blur: 16, op: 18, c: '#ffffff', r: 20 },
    run: (v) => { const [r, g, b] = hexToRgb(S(v, 'c')) ?? [255, 255, 255]; const css = `background: rgba(${r}, ${g}, ${b}, ${N(v, 'op') / 100});\nbackdrop-filter: blur(${N(v, 'blur')}px);\n-webkit-backdrop-filter: blur(${N(v, 'blur')}px);\nborder: 1px solid rgba(255, 255, 255, 0.25);\nborder-radius: ${N(v, 'r')}px;`; return { kind: 'css', css, preview: `background:linear-gradient(135deg,#7c5cff,#22d3ee);box-shadow:inset 0 0 0 999px rgba(${r},${g},${b},${N(v, 'op') / 100});border-radius:${N(v, 'r')}px;border:1px solid rgba(255,255,255,.25)` }; },
  },
  {
    id: 'text-shadow', name: 'Text shadow & glow', cat: 'generate', glyph: 'Tx', blurb: 'Neon glows and drop shadows for headings.',
    fields: [rng('x', 'X', -20, 20, 0), rng('y', 'Y', -20, 20, 0), rng('blur', 'Blur', 0, 40, 14), col('c', 'Glow colour', '#22d3ee'), rng('layers', 'Layers', 1, 4, 3)], example: { x: 0, y: 0, blur: 14, c: '#22d3ee', layers: 3 },
    run: (v) => { const sh = Array.from({ length: Math.max(1, Math.min(4, N(v, 'layers', 3))) }, (_, i) => `${N(v, 'x')}px ${N(v, 'y')}px ${N(v, 'blur') * (i + 1) / 2}px ${S(v, 'c')}`).join(', '); return { kind: 'css', css: `text-shadow: ${sh};`, preview: `background:#0b0d14;color:#fff;font:700 34px system-ui;text-shadow:${sh};display:grid;place-items:center` }; },
  },
  {
    id: 'css-clamp', name: 'Fluid type (clamp)', cat: 'generate', glyph: 'clamp', blurb: 'A font size that scales smoothly between two screen widths.',
    fields: [num('min', 'Min size (px)', { default: 16 }), num('max', 'Max size (px)', { default: 32 }), num('w1', 'From screen width (px)', { default: 360 }), num('w2', 'To screen width (px)', { default: 1200 })], example: { min: 16, max: 32, w1: 360, w2: 1200 },
    run: (v) => { const a = N(v, 'min'), b = N(v, 'max'), w1 = N(v, 'w1'), w2 = N(v, 'w2'); if (w2 <= w1) return err('The second width must be larger.'); const slope = (b - a) / (w2 - w1), base = a - slope * w1; return text(`font-size: clamp(${fmt(a / 16, 4)}rem, ${fmt(base / 16, 4)}rem + ${fmt(slope * 100, 4)}vw, ${fmt(b / 16, 4)}rem);`, 'css'); },
  },
  {
    id: 'px-rem', name: 'px ⇄ rem ⇄ em', cat: 'generate', glyph: 'rem', blurb: 'CSS length units at any base size.',
    fields: [num('x', 'Value', { default: 24 }), sel('from', 'From', ['px', 'rem', 'em'], 'px'), num('base', 'Base font size (px)', { default: 16 })], example: { x: 24, from: 'px', base: 16 },
    run: (v) => { const px = S(v, 'from') === 'px' ? N(v, 'x') : N(v, 'x') * N(v, 'base', 16); return table(['Unit', 'Value'], [['px', fmt(px)], ['rem / em', fmt(px / N(v, 'base', 16))], ['pt', fmt(px * 0.75)], ['% of base', fmt((px / N(v, 'base', 16)) * 100) + '%']]); },
  },
  {
    id: 'aspect-ratio', name: 'Aspect ratio', cat: 'generate', glyph: '16:9', blurb: 'Ratio of a size and the other side for a new width.',
    fields: [num('w', 'Width', { default: 1920 }), num('h', 'Height', { default: 1080 }), num('nw', 'New width', { default: 1280 })], example: { w: 1920, h: 1080, nw: 1280 },
    run: (v) => { const w = N(v, 'w'), h = N(v, 'h'); if (w <= 0 || h <= 0) return err('Use positive sizes.'); const g = gcd(w, h); return stats([['Ratio', `${w / g}:${h / g}`], ['New height', fmt((N(v, 'nw') * h) / w, 2)], ['Decimal', fmt(w / h, 4)], ['Megapixels', fmt((w * h) / 1e6, 2)]]); },
  },
  {
    id: 'fake-data', name: 'Fake data', cat: 'generate', glyph: 'icon:user2', blurb: 'Names, emails, phones and cities for test data, as a table or JSON.',
    fields: [num('n', 'Rows', { default: 5, min: 1, max: 100 }), num('seed', 'Seed (0 = random)', { default: 0 }), sel('fmt', 'Show as', ['table', 'json', 'csv'], 'table')], example: { n: 3, seed: 5, fmt: 'table' }, manual: true,
    run: (v) => {
      const r = rand(N(v, 'seed')); const rows = Array.from({ length: Math.max(1, Math.min(100, N(v, 'n', 5))) }, () => { const f = pick(r, FIRST), l = pick(r, LAST); return { name: `${f} ${l}`, email: `${f}.${l}${Math.floor(r() * 99)}@example.com`.toLowerCase(), phone: `+91 9${String(Math.floor(r() * 1e9)).padStart(9, '0')}`, city: pick(r, CITIES), age: 18 + Math.floor(r() * 45) }; });
      const f = S(v, 'fmt'); if (f === 'json') return text(JSON.stringify(rows, null, 2), 'json'); if (f === 'csv') return text(['name,email,phone,city,age', ...rows.map((x) => Object.values(x).join(','))].join('\n'), 'csv');
      return table(['Name', 'Email', 'Phone', 'City', 'Age'], rows.map((x) => Object.values(x)));
    },
  },
  {
    id: 'meta-tags', name: 'Meta tags & Open Graph', cat: 'generate', glyph: '<og>', blurb: 'SEO title, description and social preview tags.',
    fields: [txt('title', 'Title', { default: 'Chomugiri — workspace' }), area('desc', 'Description', { rows: 2, default: 'Build apps, sites and games from your phone.' }), txt('url', 'Page URL', { default: 'https://chomu.app/' }), txt('img', 'Image URL', { default: 'https://chomu.app/og.png' })], example: { title: 'Chomugiri — workspace', desc: 'Build apps, sites and games from your phone.', url: 'https://chomu.app/', img: 'https://chomu.app/og.png' },
    run: (v) => { const e = escapeHtml; return text(`<title>${e(S(v, 'title'))}</title>\n<meta name="description" content="${e(S(v, 'desc'))}">\n<link rel="canonical" href="${e(S(v, 'url'))}">\n<meta property="og:type" content="website">\n<meta property="og:title" content="${e(S(v, 'title'))}">\n<meta property="og:description" content="${e(S(v, 'desc'))}">\n<meta property="og:url" content="${e(S(v, 'url'))}">\n<meta property="og:image" content="${e(S(v, 'img'))}">\n<meta name="twitter:card" content="summary_large_image">`, 'html'); },
  },
  {
    id: 'robots-txt', name: 'robots.txt maker', cat: 'generate', glyph: 'icon:ban', blurb: 'Allow or block crawlers and add your sitemap.',
    fields: [area('dis', 'Disallow paths (one per line)', { rows: 3, default: '/admin\n/private' }), txt('map', 'Sitemap URL', { default: 'https://chomu.app/sitemap.xml' }), tog('ai', 'Block common AI training crawlers')], example: { dis: '/admin\n/private', map: 'https://chomu.app/sitemap.xml', ai: true },
    run: (v) => { const dis = S(v, 'dis').split('\n').map((x) => x.trim()).filter(Boolean); const out = ['User-agent: *', ...(dis.length ? dis.map((d) => `Disallow: ${d}`) : ['Allow: /'])]; if (B(v, 'ai')) for (const b of ['GPTBot', 'CCBot', 'Google-Extended', 'anthropic-ai', 'ClaudeBot']) out.push('', `User-agent: ${b}`, 'Disallow: /'); if (S(v, 'map')) out.push('', `Sitemap: ${S(v, 'map')}`); return text(out.join('\n')); },
  },
  {
    id: 'utm-builder', name: 'UTM link builder', cat: 'generate', glyph: 'utm', blurb: 'Campaign tracking links.',
    fields: [txt('u', 'Page URL', { default: 'https://chomu.app/' }), txt('src', 'Source', { default: 'instagram' }), txt('med', 'Medium', { default: 'social' }), txt('cmp', 'Campaign', { default: 'launch' })], example: { u: 'https://chomu.app/', src: 'instagram', med: 'social', cmp: 'launch' },
    run: (v) => { try { const u = new URL(S(v, 'u')); for (const [k, f] of [['utm_source', 'src'], ['utm_medium', 'med'], ['utm_campaign', 'cmp']] as const) if (S(v, f)) u.searchParams.set(k, S(v, f)); return text(u.toString()); } catch { return err('Enter a full URL (https://…).'); } },
  },
  {
    id: 'whatsapp-link', name: 'WhatsApp link', cat: 'generate', glyph: 'icon:chat', blurb: 'A wa.me link that opens a chat with your message pre-filled.',
    fields: [txt('p', 'Phone (with country code)', { default: '919876543210' }), area('m', 'Message', { rows: 2, default: 'Hi! I saw your app.' })], example: { p: '919876543210', m: 'Hi! I saw your app.' },
    run: (v) => { const p = S(v, 'p').replace(/\D/g, ''); return p.length < 8 ? err('Enter the number with its country code.') : text(`https://wa.me/${p}${S(v, 'm') ? `?text=${encodeURIComponent(S(v, 'm'))}` : ''}`); },
  },
];
