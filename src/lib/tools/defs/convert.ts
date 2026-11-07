import { err, fmt, N, num, S, sel, stats, table, text, tog, txt } from '../helpers.ts';
import type { ToolDef } from '../types.ts';

type Units = Record<string, number>;

/** A converter whose units are all a fixed factor of one base unit. Shows the result in every unit at once. */
function unitTool(id: string, name: string, glyph: string, blurb: string, units: Units, from: string, example = 1): ToolDef {
  const names = Object.keys(units);
  return {
    id, name, cat: 'convert', glyph, blurb,
    fields: [num('x', 'Value', { default: 1 }), sel('from', 'From', names, from)], example: { x: example, from },
    run: (v) => {
      const f = units[S(v, 'from')]; if (f === undefined) return err('Pick a unit.');
      const base = N(v, 'x') * f;
      return table(['Unit', 'Value'], names.map((u) => [u, fmt(base / units[u]!, 8)]));
    },
  };
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function below1000(n: number): string { const p: string[] = []; if (n >= 100) { p.push(`${ONES[Math.floor(n / 100)]} hundred`); n %= 100; } if (n >= 20) { p.push(TENS[Math.floor(n / 10)]! + (n % 10 ? `-${ONES[n % 10]}` : '')); } else if (n > 0 || !p.length) p.push(ONES[n]!); return p.join(' '); }
export function numberToWords(n: number, indian = false): string {
  if (!Number.isInteger(n)) throw new Error('Whole numbers only');
  if (Math.abs(n) > 999_999_999_999_999) throw new Error('Too large');
  if (n === 0) return 'zero';
  const neg = n < 0; n = Math.abs(n); const parts: string[] = [];
  const scales: Array<[number, string]> = indian ? [[10_000_000, 'crore'], [100_000, 'lakh'], [1000, 'thousand']] : [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1000, 'thousand']];
  for (const [s, nm] of scales) { if (n >= s) { const q = Math.floor(n / s); parts.push(`${indian && q >= 100 && nm === 'crore' ? numberToWords(q, true) : below1000(q)} ${nm}`); n %= s; } }
  if (n > 0) parts.push(below1000(n));
  return (neg ? 'minus ' : '') + parts.join(' ');
}
export function toRoman(n: number): string { const t: Array<[number, string]> = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]; let r = ''; for (const [v, s] of t) while (n >= v) { r += s; n -= v; } return r; }
export function fromRoman(s: string): number { const m: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }; let t = 0; const u = s.toUpperCase(); for (let i = 0; i < u.length; i++) { const a = m[u[i]!], b = m[u[i + 1]!] ?? 0; if (!a) return NaN; t += a < b ? -a : a; } return t; }

export const convertTools: ToolDef[] = [
  unitTool('length-converter', 'Length converter', '📏', 'Metres, feet, inches, miles, km and more.', { 'millimetre': 0.001, 'centimetre': 0.01, 'metre': 1, 'kilometre': 1000, 'inch': 0.0254, 'foot': 0.3048, 'yard': 0.9144, 'mile': 1609.344, 'nautical mile': 1852, 'light-year': 9.4607e15 }, 'foot', 6),
  unitTool('weight-converter', 'Weight converter', '⚖', 'Kilograms, pounds, ounces, tola, quintal and more.', { 'milligram': 1e-6, 'gram': 0.001, 'kilogram': 1, 'quintal': 100, 'tonne': 1000, 'ounce': 0.0283495, 'pound': 0.45359237, 'stone': 6.35029, 'tola': 0.01166, 'seer': 0.933 }, 'kilogram', 70),
  unitTool('volume-converter', 'Volume converter', '🧪', 'Litres, millilitres, gallons, cups and more.', { 'millilitre': 0.001, 'litre': 1, 'cubic metre': 1000, 'teaspoon': 0.00492892, 'tablespoon': 0.0147868, 'cup (US)': 0.236588, 'pint (US)': 0.473176, 'quart (US)': 0.946353, 'gallon (US)': 3.78541, 'gallon (UK)': 4.54609 }, 'litre', 2),
  unitTool('area-converter', 'Area converter', '▭', 'Square metres, acres, hectares, bigha and more.', { 'sq centimetre': 0.0001, 'sq metre': 1, 'sq kilometre': 1e6, 'hectare': 1e4, 'acre': 4046.8564, 'sq foot': 0.092903, 'sq yard': 0.836127, 'sq mile': 2589988.11, 'guntha': 101.17, 'bigha (UP)': 2529.29 }, 'acre', 1),
  unitTool('speed-converter', 'Speed converter', '🚀', 'km/h, mph, m/s, knots and Mach.', { 'm/s': 1, 'km/h': 1 / 3.6, 'mph': 0.44704, 'knot': 0.514444, 'foot/s': 0.3048, 'Mach': 340.29 }, 'km/h', 100),
  unitTool('data-size-converter', 'Data size converter', '💾', 'Bytes, KB, MB, GB, TB (1024) and bits.', { 'bit': 1 / 8, 'byte': 1, 'KB': 1024, 'MB': 1024 ** 2, 'GB': 1024 ** 3, 'TB': 1024 ** 4, 'PB': 1024 ** 5 }, 'MB', 256),
  unitTool('time-unit-converter', 'Time unit converter', '⏳', 'Seconds, minutes, hours, days, weeks, years.', { 'millisecond': 0.001, 'second': 1, 'minute': 60, 'hour': 3600, 'day': 86400, 'week': 604800, 'month (30 d)': 2592000, 'year (365 d)': 31536000 }, 'hour', 36),
  unitTool('pressure-converter', 'Pressure converter', '🎈', 'Pascal, bar, atm, psi, mmHg.', { 'pascal': 1, 'kilopascal': 1000, 'bar': 1e5, 'atmosphere': 101325, 'psi': 6894.757, 'mmHg': 133.322, 'torr': 133.322 }, 'psi', 32),
  unitTool('energy-converter', 'Energy converter', '⚡', 'Joules, calories, kWh, BTU.', { 'joule': 1, 'kilojoule': 1000, 'calorie': 4.184, 'kilocalorie': 4184, 'watt-hour': 3600, 'kilowatt-hour': 3.6e6, 'BTU': 1055.06 }, 'kilocalorie', 500),
  unitTool('power-converter', 'Power converter', '🔌', 'Watts, kW, horsepower.', { 'watt': 1, 'kilowatt': 1000, 'megawatt': 1e6, 'horsepower (mech)': 745.7, 'horsepower (metric)': 735.5 }, 'horsepower (mech)', 150),
  unitTool('angle-converter', 'Angle converter', '∠', 'Degrees, radians, gradians, turns.', { 'degree': 1, 'radian': 180 / Math.PI, 'gradian': 0.9, 'turn': 360, 'arcminute': 1 / 60, 'arcsecond': 1 / 3600 }, 'degree', 90),
  unitTool('frequency-converter', 'Frequency converter', '〰', 'Hz, kHz, MHz, GHz, RPM.', { 'hertz': 1, 'kilohertz': 1e3, 'megahertz': 1e6, 'gigahertz': 1e9, 'RPM': 1 / 60 }, 'megahertz', 98.3),
  unitTool('cooking-converter', 'Cooking measures', '🍳', 'Cups, spoons and millilitres for the kitchen.', { 'millilitre': 1, 'teaspoon': 4.92892, 'tablespoon': 14.7868, 'fluid ounce': 29.5735, 'cup': 236.588, 'pint': 473.176, 'litre': 1000 }, 'cup', 1.5),
  {
    id: 'temperature-converter', name: 'Temperature converter', cat: 'convert', glyph: '🌡', blurb: 'Celsius, Fahrenheit, Kelvin and Rankine.',
    fields: [num('x', 'Value', { default: 36.6 }), sel('from', 'From', ['Celsius', 'Fahrenheit', 'Kelvin', 'Rankine'], 'Celsius')], example: { x: 100, from: 'Celsius' },
    run: (v) => {
      const x = N(v, 'x'), f = S(v, 'from'); const c = f === 'Celsius' ? x : f === 'Fahrenheit' ? ((x - 32) * 5) / 9 : f === 'Kelvin' ? x - 273.15 : ((x - 491.67) * 5) / 9;
      return table(['Scale', 'Value'], [['Celsius', fmt(c)], ['Fahrenheit', fmt((c * 9) / 5 + 32)], ['Kelvin', fmt(c + 273.15)], ['Rankine', fmt(((c + 273.15) * 9) / 5)]]);
    },
  },
  {
    id: 'fuel-economy', name: 'Fuel economy', cat: 'convert', glyph: '⛽', blurb: 'km/L, L/100 km, mpg (US and UK).',
    fields: [num('x', 'Value', { default: 15 }), sel('from', 'From', ['km/L', 'L/100km', 'mpg (US)', 'mpg (UK)'], 'km/L')], example: { x: 15, from: 'km/L' },
    run: (v) => {
      const x = N(v, 'x'); if (x <= 0) return err('Use a positive number.'); const f = S(v, 'from');
      const kml = f === 'km/L' ? x : f === 'L/100km' ? 100 / x : f === 'mpg (US)' ? x * 0.425144 : x * 0.354006;
      return table(['Unit', 'Value'], [['km/L', fmt(kml)], ['L/100km', fmt(100 / kml)], ['mpg (US)', fmt(kml / 0.425144)], ['mpg (UK)', fmt(kml / 0.354006)]]);
    },
  },
  {
    id: 'number-base', name: 'Number base converter', cat: 'convert', glyph: '0x', blurb: 'Binary, octal, decimal, hex and any base up to 36.',
    fields: [txt('n', 'Number', { default: '255', mono: true }), num('from', 'From base', { default: 10, min: 2, max: 36 })], example: { n: '255', from: 10 },
    run: (v) => {
      const b = N(v, 'from', 10), s = S(v, 'n').trim().toLowerCase().replace(/^0[xbo]/, ''); const digits = '0123456789abcdefghijklmnopqrstuvwxyz'.slice(0, b);
      if (!s || [...s.replace(/^-/, '')].some((c) => !digits.includes(c))) return err(`"${s}" is not a base-${b} number.`);
      let x = 0n; for (const c of s.replace(/^-/, '')) x = x * BigInt(b) + BigInt(digits.indexOf(c)); if (s.startsWith('-')) x = -x;
      return table(['Base', 'Value'], [['Binary (2)', x.toString(2)], ['Octal (8)', x.toString(8)], ['Decimal (10)', x.toString(10)], ['Hex (16)', x.toString(16).toUpperCase()], ['Base 32', x.toString(32)], ['Base 36', x.toString(36)]]);
    },
  },
  {
    id: 'roman-numerals', name: 'Roman numerals', cat: 'convert', glyph: 'XIV', blurb: 'Numbers to Roman numerals and back.',
    fields: [txt('t', 'Number or numeral', { default: '2024' })], example: { t: '2024' },
    run: (v) => { const t = S(v, 't').trim(); if (/^\d+$/.test(t)) { const n = Number(t); return n < 1 || n > 3999 ? err('Use 1 to 3999.') : text(toRoman(n)); } const n = fromRoman(t); return Number.isNaN(n) || !t ? err('Not a Roman numeral.') : text(String(n)); },
  },
  {
    id: 'number-to-words', name: 'Number to words', cat: 'convert', glyph: '1→one', blurb: 'Spell a number in English (international or Indian lakh/crore).',
    fields: [txt('n', 'Number', { default: '1234567' }), tog('ind', 'Indian system (lakh, crore)', true)], example: { n: '1234567', ind: true },
    run: (v) => { try { return text(numberToWords(Math.trunc(Number(S(v, 'n').replace(/,/g, ''))), B2(v, 'ind'))); } catch (e) { return err((e as Error).message); } },
  },
  {
    id: 'number-formatter', name: 'Number formatter', cat: 'convert', glyph: '1,000', blurb: 'Commas (Indian or international), scientific, percent and currency.',
    fields: [txt('n', 'Number', { default: '1234567.891' })], example: { n: '1234567.891' },
    run: (v) => { const x = Number(S(v, 'n').replace(/,/g, '')); if (!Number.isFinite(x)) return err('Not a number.'); return table(['Format', 'Result'], [['International', x.toLocaleString('en-US')], ['Indian', x.toLocaleString('en-IN')], ['Scientific', x.toExponential(3)], ['Percent', (x * 100).toLocaleString('en-US') + '%'], ['Rupees', '₹' + x.toLocaleString('en-IN', { maximumFractionDigits: 2 })], ['Dollars', '$' + x.toLocaleString('en-US', { maximumFractionDigits: 2 })], ['Compact', new Intl.NumberFormat('en', { notation: 'compact' }).format(x)]]); },
  },
  {
    id: 'ordinal-numbers', name: 'Ordinal numbers', cat: 'convert', glyph: '1st', blurb: '1st, 2nd, 3rd… for any number.',
    fields: [num('n', 'Number', { default: 23 })], example: { n: 23 },
    run: (v) => { const n = Math.trunc(N(v, 'n')), a = Math.abs(n) % 100, s = a >= 11 && a <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][Math.abs(n) % 10] ?? 'th'; return text(`${n}${s}`); },
  },
  {
    id: 'duration-converter', name: 'Duration ⇄ seconds', cat: 'convert', glyph: 'h:m:s', blurb: 'Seconds to days/hours/minutes, and back.',
    fields: [txt('t', 'Seconds or 1d 2h 3m 4s', { default: '93784' })], example: { t: '93784' },
    run: (v) => {
      const t = S(v, 't').trim(); let sec = 0;
      if (/^\d+(\.\d+)?$/.test(t)) sec = Number(t); else { const re = /(\d+(?:\.\d+)?)\s*([dhms])/gi; let m; let any = false; while ((m = re.exec(t))) { any = true; sec += Number(m[1]) * ({ d: 86400, h: 3600, m: 60, s: 1 } as Record<string, number>)[m[2]!.toLowerCase()]!; } if (!any) return err('Try 93784 or 1d 2h 3m 4s.'); }
      const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
      return stats([['Seconds', sec], ['Breakdown', `${d}d ${h}h ${m}m ${s}s`], ['Clock', `${String(Math.floor(sec / 3600)).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`], ['Hours', fmt(sec / 3600)], ['Days', fmt(sec / 86400)]]);
    },
  },
  {
    id: 'bytes-human', name: 'File size, human', cat: 'convert', glyph: 'KiB', blurb: 'Bytes to a readable size, in 1000 and 1024 units.',
    fields: [num('n', 'Bytes', { default: 157286400 })], example: { n: 157286400 },
    run: (v) => { const b = N(v, 'n'); const f = (base: number, u: string[]) => { let i = 0, x = Math.abs(b); while (x >= base && i < u.length - 1) { x /= base; i++; } return `${fmt(Math.sign(b) * x, 2)} ${u[i]}`; }; return stats([['Decimal (1000)', f(1000, ['B', 'kB', 'MB', 'GB', 'TB', 'PB'])], ['Binary (1024)', f(1024, ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'])]]); },
  },
  {
    id: 'shoe-size', name: 'Shoe size converter', cat: 'convert', glyph: '👟', blurb: 'Indian/UK, US and EU shoe sizes (adult, approximate).',
    fields: [num('x', 'Size', { default: 8, step: 0.5 }), sel('from', 'From', ['UK / India', 'US men', 'US women', 'EU'], 'UK / India')], example: { x: 8, from: 'UK / India' },
    run: (v) => { const x = N(v, 'x'), f = S(v, 'from'); const uk = f === 'UK / India' ? x : f === 'US men' ? x - 1 : f === 'US women' ? x - 2.5 : x - 33.5; return table(['System', 'Size'], [['UK / India', fmt(uk, 1)], ['US men', fmt(uk + 1, 1)], ['US women', fmt(uk + 2.5, 1)], ['EU', fmt(uk + 33.5, 1)], ['Foot length (cm)', fmt((uk + 23) * 0.847 + 0.0, 1)]]); },
  },
];

function B2(v: Record<string, string | number | boolean>, k: string): boolean { return v[k] === true || v[k] === 'true'; }
