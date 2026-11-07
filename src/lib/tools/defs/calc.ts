import { B, err, evaluate, factorial, fmt, gcd, money, N, num, S, sel, stats, table, text, tog, txt, area, round } from '../helpers.ts';
import type { ToolDef } from '../types.ts';

const nums = (s: string): number[] => (s.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi) ?? []).map(Number);

export const calcTools: ToolDef[] = [
  {
    id: 'calculator', name: 'Calculator', cat: 'calc', glyph: '＋−', blurb: 'Type any expression: 2+3*4, sqrt(16), sin(30), 5!, 12% …',
    fields: [txt('e', 'Expression', { default: '(12+8)*3 - sqrt(49)', mono: true }), tog('deg', 'Angles in degrees', true)], example: { e: '(12+8)*3 - sqrt(49)', deg: true },
    run: (v) => { try { const r = evaluate(S(v, 'e'), B(v, 'deg')); return Number.isFinite(r) ? stats([['Result', fmt(r, 10)], ['Scientific', r.toExponential(6)]]) : err('That is not a finite number.'); } catch (e) { return err((e as Error).message); } },
  },
  {
    id: 'percentage-calculator', name: 'Percentage calculator', cat: 'calc', glyph: '%', blurb: 'X% of Y, X is what % of Y, and increase / decrease.',
    fields: [num('x', 'X', { default: 15 }), num('y', 'Y', { default: 2000 })], example: { x: 15, y: 2000 },
    run: (v) => { const x = N(v, 'x'), y = N(v, 'y'); return table(['Question', 'Answer'], [[`${fmt(x)}% of ${fmt(y)}`, fmt((x / 100) * y)], [`${fmt(x)} is what % of ${fmt(y)}`, y ? fmt((x / y) * 100) + '%' : '—'], [`${fmt(y)} increased by ${fmt(x)}%`, fmt(y * (1 + x / 100))], [`${fmt(y)} decreased by ${fmt(x)}%`, fmt(y * (1 - x / 100))], [`Change from ${fmt(x)} to ${fmt(y)}`, x ? fmt(((y - x) / Math.abs(x)) * 100) + '%' : '—']]); },
  },
  {
    id: 'bmi-calculator', name: 'BMI calculator', cat: 'calc', glyph: 'BMI', blurb: 'Body mass index and your healthy weight range.',
    fields: [num('kg', 'Weight', { default: 70, unit: 'kg' }), num('cm', 'Height', { default: 172, unit: 'cm' })], example: { kg: 70, cm: 172 },
    run: (v) => { const h = N(v, 'cm') / 100, kg = N(v, 'kg'); if (h <= 0 || kg <= 0) return err('Enter height and weight.'); const b = kg / (h * h); return stats([['BMI', fmt(b, 1)], ['Category', b < 18.5 ? 'Underweight' : b < 25 ? 'Normal' : b < 30 ? 'Overweight' : 'Obese'], ['Healthy weight', `${fmt(18.5 * h * h, 1)} – ${fmt(24.9 * h * h, 1)} kg`]]); },
  },
  {
    id: 'calorie-calculator', name: 'Calorie needs', cat: 'calc', glyph: '🔥', blurb: 'BMR and daily calories (Mifflin–St Jeor).',
    fields: [sel('sex', 'Sex', ['male', 'female'], 'male'), num('age', 'Age', { default: 25 }), num('kg', 'Weight (kg)', { default: 70 }), num('cm', 'Height (cm)', { default: 172 }), sel('act', 'Activity', [{ value: '1.2', label: 'Sitting most of the day' }, { value: '1.375', label: 'Light exercise' }, { value: '1.55', label: 'Moderate exercise' }, { value: '1.725', label: 'Hard exercise' }], '1.375')], example: { sex: 'male', age: 25, kg: 70, cm: 172, act: '1.375' },
    run: (v) => { const bmr = 10 * N(v, 'kg') + 6.25 * N(v, 'cm') - 5 * N(v, 'age') + (S(v, 'sex') === 'male' ? 5 : -161), tdee = bmr * Number(S(v, 'act')); return stats([['BMR', `${Math.round(bmr)} kcal`], ['Maintain', `${Math.round(tdee)} kcal`], ['Lose weight', `${Math.round(tdee - 500)} kcal`], ['Gain weight', `${Math.round(tdee + 500)} kcal`]]); },
  },
  {
    id: 'emi-calculator', name: 'EMI / loan calculator', cat: 'calc', glyph: '₹', blurb: 'Monthly instalment, total interest and the full cost of a loan.',
    fields: [num('p', 'Loan amount', { default: 1000000 }), num('r', 'Interest % per year', { default: 9, step: 0.1 }), num('y', 'Years', { default: 10, step: 0.5 })], example: { p: 1000000, r: 9, y: 10 },
    run: (v) => { const p = N(v, 'p'), n = Math.round(N(v, 'y') * 12), i = N(v, 'r') / 1200; if (p <= 0 || n <= 0) return err('Enter an amount and a term.'); const emi = i ? (p * i * (1 + i) ** n) / ((1 + i) ** n - 1) : p / n; return stats([['Monthly EMI', '₹' + money(emi)], ['Total paid', '₹' + money(emi * n)], ['Total interest', '₹' + money(emi * n - p)], ['Months', n]]); },
  },
  {
    id: 'compound-interest', name: 'Compound interest', cat: 'calc', glyph: '📈', blurb: 'How an amount grows with compounding.',
    fields: [num('p', 'Principal', { default: 100000 }), num('r', 'Rate % per year', { default: 8, step: 0.1 }), num('y', 'Years', { default: 10 }), sel('n', 'Compounded', [{ value: '1', label: 'Yearly' }, { value: '2', label: 'Half-yearly' }, { value: '4', label: 'Quarterly' }, { value: '12', label: 'Monthly' }], '4')], example: { p: 100000, r: 8, y: 10, n: '4' },
    run: (v) => { const p = N(v, 'p'), r = N(v, 'r') / 100, y = N(v, 'y'), n = Number(S(v, 'n')), a = p * (1 + r / n) ** (n * y); return { kind: 'multi', parts: [{ out: stats([['Final amount', '₹' + money(a)], ['Interest earned', '₹' + money(a - p)], ['Simple interest would give', '₹' + money(p * (1 + r * y))]]) }, { out: { kind: 'bars', items: Array.from({ length: Math.min(12, Math.ceil(y)) }, (_, k) => ({ label: `Year ${k + 1}`, value: Math.round(p * (1 + r / n) ** (n * (k + 1))) })) } }] }; },
  },
  {
    id: 'simple-interest', name: 'Simple interest', cat: 'calc', glyph: 'SI', blurb: 'Interest = principal × rate × time.',
    fields: [num('p', 'Principal', { default: 50000 }), num('r', 'Rate % per year', { default: 7.5, step: 0.1 }), num('y', 'Years', { default: 3, step: 0.5 })], example: { p: 50000, r: 7.5, y: 3 },
    run: (v) => { const i = (N(v, 'p') * N(v, 'r') * N(v, 'y')) / 100; return stats([['Interest', '₹' + money(i)], ['Total', '₹' + money(N(v, 'p') + i)]]); },
  },
  {
    id: 'sip-calculator', name: 'SIP calculator', cat: 'calc', glyph: 'SIP', blurb: 'What a monthly investment can grow to.',
    fields: [num('m', 'Monthly amount', { default: 5000 }), num('r', 'Expected return % / year', { default: 12, step: 0.5 }), num('y', 'Years', { default: 15 })], example: { m: 5000, r: 12, y: 15 },
    run: (v) => { const i = N(v, 'r') / 1200, n = N(v, 'y') * 12, m = N(v, 'm'), fv = i ? m * (((1 + i) ** n - 1) / i) * (1 + i) : m * n; return stats([['Invested', '₹' + money(m * n)], ['Estimated value', '₹' + money(fv)], ['Gain', '₹' + money(fv - m * n)]]); },
  },
  {
    id: 'gst-calculator', name: 'GST / VAT calculator', cat: 'calc', glyph: 'GST', blurb: 'Add or remove GST from a price.',
    fields: [num('a', 'Amount', { default: 1180 }), num('r', 'GST %', { default: 18 }), sel('mode', 'The amount is', [{ value: 'excl', label: 'Without GST' }, { value: 'incl', label: 'With GST (find base)' }], 'incl')], example: { a: 1180, r: 18, mode: 'incl' },
    run: (v) => { const a = N(v, 'a'), r = N(v, 'r') / 100, base = S(v, 'mode') === 'incl' ? a / (1 + r) : a, g = base * r; return stats([['Price before GST', '₹' + money(base)], ['GST', '₹' + money(g)], ['CGST + SGST (each)', '₹' + money(g / 2)], ['Total', '₹' + money(base + g)]]); },
  },
  {
    id: 'tip-split', name: 'Tip & split the bill', cat: 'calc', glyph: '🍽', blurb: 'Tip and each person\'s share.',
    fields: [num('b', 'Bill', { default: 2400 }), rng0('tip', 'Tip %', 10), num('n', 'People', { default: 4, min: 1 })], example: { b: 2400, tip: 10, n: 4 },
    run: (v) => { const b = N(v, 'b'), tip = (b * N(v, 'tip')) / 100, n = Math.max(1, N(v, 'n', 1)); return stats([['Tip', '₹' + money(tip)], ['Total', '₹' + money(b + tip)], ['Each person pays', '₹' + money((b + tip) / n)]]); },
  },
  {
    id: 'discount-calculator', name: 'Discount calculator', cat: 'calc', glyph: '🏷', blurb: 'Sale price after one or two discounts.',
    fields: [num('p', 'Price', { default: 2999 }), num('d1', 'Discount %', { default: 30 }), num('d2', 'Extra discount %', { default: 10 })], example: { p: 2999, d1: 30, d2: 10 },
    run: (v) => { const p = N(v, 'p'), a = p * (1 - N(v, 'd1') / 100), b = a * (1 - N(v, 'd2') / 100); return stats([['After first discount', '₹' + money(a)], ['Final price', '₹' + money(b)], ['You save', '₹' + money(p - b)], ['Real total discount', fmt(((p - b) / p) * 100, 2) + '%']]); },
  },
  {
    id: 'profit-loss', name: 'Profit & loss', cat: 'calc', glyph: '±%', blurb: 'Profit or loss, margin and markup.',
    fields: [num('c', 'Cost price', { default: 800 }), num('s', 'Selling price', { default: 1000 })], example: { c: 800, s: 1000 },
    run: (v) => { const c = N(v, 'c'), s = N(v, 's'), d = s - c; return stats([[d >= 0 ? 'Profit' : 'Loss', '₹' + money(Math.abs(d))], ['Profit % (markup)', c ? fmt((d / c) * 100, 2) + '%' : '—'], ['Margin %', s ? fmt((d / s) * 100, 2) + '%' : '—']]); },
  },
  {
    id: 'fraction-calculator', name: 'Fraction calculator', cat: 'calc', glyph: '½', blurb: 'Add, subtract, multiply, divide and simplify fractions.',
    fields: [txt('a', 'Fraction A', { default: '3/4' }), sel('op', 'Operation', ['+', '−', '×', '÷'], '+'), txt('b', 'Fraction B', { default: '5/6' })], example: { a: '3/4', op: '+', b: '5/6' },
    run: (v) => {
      const p = (s: string): [number, number] | null => { const m = /^\s*(-?\d+)(?:\s*\/\s*(\d+))?\s*$/.exec(s); return m ? [Number(m[1]), Number(m[2] ?? 1)] : null; };
      const a = p(S(v, 'a')), b = p(S(v, 'b')); if (!a || !b || !a[1] || !b[1]) return err('Use fractions like 3/4 or whole numbers.');
      const op = S(v, 'op'); let n = 0, d = 1;
      if (op === '+') { n = a[0] * b[1] + b[0] * a[1]; d = a[1] * b[1]; } else if (op === '−') { n = a[0] * b[1] - b[0] * a[1]; d = a[1] * b[1]; } else if (op === '×') { n = a[0] * b[0]; d = a[1] * b[1]; } else { if (!b[0]) return err('Cannot divide by zero.'); n = a[0] * b[1]; d = a[1] * b[0]; }
      if (d < 0) { n = -n; d = -d; } const g = gcd(n, d) || 1; n /= g; d /= g;
      return stats([['Result', d === 1 ? String(n) : `${n}/${d}`], ['Mixed', d === 1 ? String(n) : `${Math.trunc(n / d)} ${Math.abs(n) % d}/${d}`.replace(/^0 /, '')], ['Decimal', fmt(n / d, 6)]]);
    },
  },
  {
    id: 'gcd-lcm', name: 'GCD & LCM', cat: 'calc', glyph: 'gcd', blurb: 'Greatest common divisor and least common multiple.',
    fields: [txt('t', 'Numbers', { default: '12, 18, 30' })], example: { t: '12, 18, 30' },
    run: (v) => { const a = nums(S(v, 't')).map(Math.trunc).filter((x) => x > 0); if (a.length < 2) return err('Give at least two positive whole numbers.'); const g = a.reduce(gcd); const l = a.reduce((x, y) => (x / gcd(x, y)) * y); return stats([['GCD (HCF)', g], ['LCM', l]]); },
  },
  {
    id: 'prime-checker', name: 'Prime checker', cat: 'calc', glyph: 'P', blurb: 'Is it prime? Prime factors, and primes up to a limit.',
    fields: [num('n', 'Number', { default: 360 })], example: { n: 360 },
    run: (v) => { const n = Math.trunc(N(v, 'n')); if (n < 2 || n > 9e15) return err('Use a whole number from 2 to 9 000 000 000 000 000.'); let x = n; const f: number[] = []; for (let d = 2; d * d <= x; d++) while (x % d === 0) { f.push(d); x /= d; } if (x > 1) f.push(x); const counts = new Map<number, number>(); f.forEach((p) => counts.set(p, (counts.get(p) ?? 0) + 1)); return stats([['Prime?', f.length === 1 ? 'Yes ✓' : 'No'], ['Prime factors', [...counts].map(([p, k]) => (k > 1 ? `${p}^${k}` : `${p}`)).join(' × ')], ['Divisors', (() => { const ds: number[] = []; for (let d = 1; d * d <= n && ds.length < 200; d++) if (n % d === 0) { ds.push(d); if (d * d !== n) ds.push(n / d); } return ds.sort((a, b) => a - b).join(', '); })()]]); },
  },
  {
    id: 'fibonacci', name: 'Fibonacci', cat: 'calc', glyph: 'φ', blurb: 'The first N Fibonacci numbers, or the Nth exactly.',
    fields: [num('n', 'N', { default: 20, min: 1, max: 300 })], example: { n: 20 },
    run: (v) => { const n = Math.max(1, Math.min(300, Math.trunc(N(v, 'n', 20)))); let a = 0n, b = 1n; const out: string[] = []; for (let i = 0; i < n; i++) { out.push(a.toString()); [a, b] = [b, a + b]; } return { kind: 'multi', parts: [{ out: stats([[`F(${n - 1})`, out[n - 1]!]]) }, { out: text(out.join(', ')) }] }; },
  },
  {
    id: 'permutation-combination', name: 'nPr & nCr', cat: 'calc', glyph: 'nCr', blurb: 'Permutations, combinations and factorials.',
    fields: [num('n', 'n', { default: 10 }), num('r', 'r', { default: 3 })], example: { n: 10, r: 3 },
    run: (v) => { try { const n = N(v, 'n'), r = N(v, 'r'); if (!Number.isInteger(n) || !Number.isInteger(r) || n < 0 || n > 170) return err('Use whole numbers, n from 0 to 170.'); if (r > n || r < 0) return err('r must be between 0 and n.'); let p = 1; for (let i = 0; i < r; i++) p *= n - i; return stats([['nPr', fmt(p, 0)], ['nCr', fmt(p / factorial(r), 0)], ['n!', fmt(factorial(n), 0)]]); } catch (e) { return err((e as Error).message); } },
  },
  {
    id: 'quadratic-solver', name: 'Quadratic solver', cat: 'calc', glyph: 'x²', blurb: 'Roots of ax² + bx + c = 0, real or complex.',
    fields: [num('a', 'a', { default: 1 }), num('b', 'b', { default: -3 }), num('c', 'c', { default: 2 })], example: { a: 1, b: -3, c: 2 },
    run: (v) => { const a = N(v, 'a'), b = N(v, 'b'), c = N(v, 'c'); if (!a) return err('a cannot be 0.'); const d = b * b - 4 * a * c; if (d >= 0) return stats([['Discriminant', fmt(d)], ['x₁', fmt((-b + Math.sqrt(d)) / (2 * a))], ['x₂', fmt((-b - Math.sqrt(d)) / (2 * a))], ['Vertex', `(${fmt(-b / (2 * a))}, ${fmt(c - (b * b) / (4 * a))})`]]); return stats([['Discriminant', fmt(d)], ['x₁', `${fmt(-b / (2 * a))} + ${fmt(Math.sqrt(-d) / (2 * a))}i`], ['x₂', `${fmt(-b / (2 * a))} − ${fmt(Math.sqrt(-d) / (2 * a))}i`]]); },
  },
  {
    id: 'statistics', name: 'Statistics', cat: 'calc', glyph: 'σ', blurb: 'Mean, median, mode, range and standard deviation of a list.',
    fields: [area('t', 'Numbers', { rows: 4, default: '4, 8, 15, 16, 23, 42' })], example: { t: '4, 8, 15, 16, 23, 42, 8' },
    run: (v) => { const a = nums(S(v, 't')); if (!a.length) return err('Add some numbers.'); const s = [...a].sort((x, y) => x - y), n = a.length, mean = a.reduce((x, y) => x + y, 0) / n, med = n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2, cnt = new Map<number, number>(); a.forEach((x) => cnt.set(x, (cnt.get(x) ?? 0) + 1)); const mx = Math.max(...cnt.values()), vr = a.reduce((x, y) => x + (y - mean) ** 2, 0); return stats([['Count', n], ['Sum', fmt(a.reduce((x, y) => x + y, 0))], ['Mean', fmt(mean)], ['Median', fmt(med)], ['Mode', mx > 1 ? [...cnt].filter(([, k]) => k === mx).map(([x]) => x).join(', ') : 'none'], ['Min / Max', `${s[0]} / ${s[n - 1]}`], ['Range', fmt(s[n - 1]! - s[0]!)], ['Std dev (population)', fmt(Math.sqrt(vr / n))], ['Std dev (sample)', n > 1 ? fmt(Math.sqrt(vr / (n - 1))) : '—']]); },
  },
  {
    id: 'ratio-simplifier', name: 'Ratio simplifier', cat: 'calc', glyph: 'a:b', blurb: 'Reduce a ratio and scale it.',
    fields: [txt('t', 'Ratio', { default: '1920:1080' }), num('scale', 'Scale to a first value of', { default: 1280 })], example: { t: '1920:1080', scale: 1280 },
    run: (v) => { const a = nums(S(v, 't')); if (a.length < 2 || a.some((x) => x <= 0)) return err('Use positive numbers like 16:9.'); const g = a.reduce(gcd); const r = a.map((x) => x / g); return stats([['Simplified', r.join(' : ')], ['Scaled', a.map((x) => fmt((x * N(v, 'scale')) / a[0]!, 2)).join(' : ')], ['Decimal', fmt(a[0]! / a[1]!, 4)]]); },
  },
  {
    id: 'geometry-shapes', name: 'Area & perimeter', cat: 'calc', glyph: '△○', blurb: 'Area, perimeter and volume of common shapes.',
    fields: [sel('shape', 'Shape', ['circle', 'rectangle', 'triangle', 'square', 'trapezoid', 'sphere', 'cylinder', 'cone', 'cube', 'box'], 'circle'), num('a', 'a (radius / length / base)', { default: 5 }), num('b', 'b (width / height)', { default: 3 }), num('c', 'c (third side / height)', { default: 4 })], example: { shape: 'circle', a: 5, b: 3, c: 4 },
    run: (v) => {
      const a = N(v, 'a'), b = N(v, 'b'), c = N(v, 'c'), P = Math.PI, s = S(v, 'shape');
      const r: Record<string, Array<[string, number]>> = { circle: [['Area', P * a * a], ['Circumference', 2 * P * a], ['Diameter', 2 * a]], rectangle: [['Area', a * b], ['Perimeter', 2 * (a + b)], ['Diagonal', Math.hypot(a, b)]], square: [['Area', a * a], ['Perimeter', 4 * a], ['Diagonal', a * Math.SQRT2]], triangle: [['Area (Heron)', (() => { const p = (a + b + c) / 2; return Math.sqrt(Math.max(0, p * (p - a) * (p - b) * (p - c))); })()], ['Perimeter', a + b + c]], trapezoid: [['Area', ((a + b) / 2) * c]], sphere: [['Surface', 4 * P * a * a], ['Volume', (4 / 3) * P * a ** 3]], cylinder: [['Surface', 2 * P * a * (a + b)], ['Volume', P * a * a * b]], cone: [['Volume', (P * a * a * b) / 3], ['Slant', Math.hypot(a, b)], ['Surface', P * a * (a + Math.hypot(a, b))]], cube: [['Surface', 6 * a * a], ['Volume', a ** 3]], box: [['Surface', 2 * (a * b + b * c + a * c)], ['Volume', a * b * c]] };
      return stats((r[s] ?? []).map(([k, x]) => [k, fmt(x, 4)]));
    },
  },
  {
    id: 'pythagoras', name: 'Pythagoras', cat: 'calc', glyph: 'c²', blurb: 'Find the missing side of a right triangle.',
    fields: [num('a', 'Side a', { default: 3 }), num('b', 'Side b', { default: 4 }), num('c', 'Hypotenuse c (0 = unknown)', { default: 0 })], example: { a: 3, b: 4, c: 0 },
    run: (v) => { const a = N(v, 'a'), b = N(v, 'b'), c = N(v, 'c'); if (c > 0 && a > 0 && !b) return stats([['Side b', fmt(Math.sqrt(c * c - a * a))]]); if (c > 0 && b > 0 && !a) return stats([['Side a', fmt(Math.sqrt(c * c - b * b))]]); return stats([['Hypotenuse c', fmt(Math.hypot(a, b))], ['Angle A', fmt((Math.atan2(a, b) * 180) / Math.PI, 2) + '°'], ['Angle B', fmt((Math.atan2(b, a) * 180) / Math.PI, 2) + '°']]); },
  },
  {
    id: 'average-speed', name: 'Speed, distance, time', cat: 'calc', glyph: 'v=d/t', blurb: 'Give two, get the third.',
    fields: [num('d', 'Distance (km, 0 = unknown)', { default: 120 }), num('s', 'Speed (km/h, 0 = unknown)', { default: 0 }), num('t', 'Time (hours, 0 = unknown)', { default: 2 })], example: { d: 120, s: 0, t: 2 },
    run: (v) => { const d = N(v, 'd'), s = N(v, 's'), t = N(v, 't'); if (!d && s && t) return stats([['Distance', fmt(s * t) + ' km']]); if (d && !s && t) return stats([['Speed', fmt(d / t) + ' km/h']]); if (d && s && !t) { const h = d / s; return stats([['Time', `${Math.floor(h)} h ${Math.round((h % 1) * 60)} min`]]); } return err('Leave exactly one of the three as 0.'); },
  },
  {
    id: 'trip-cost', name: 'Trip fuel cost', cat: 'calc', glyph: '🛣', blurb: 'What a trip costs in fuel, and each rider\'s share.',
    fields: [num('km', 'Distance (km)', { default: 450 }), num('mileage', 'Mileage (km/L)', { default: 16 }), num('price', 'Fuel price per litre', { default: 105 }), num('n', 'Riders', { default: 3, min: 1 })], example: { km: 450, mileage: 16, price: 105, n: 3 },
    run: (v) => { const l = N(v, 'km') / Math.max(0.1, N(v, 'mileage')), c = l * N(v, 'price'); return stats([['Fuel needed', fmt(l, 1) + ' L'], ['Cost', '₹' + money(c)], ['Per rider', '₹' + money(c / Math.max(1, N(v, 'n')))]]); },
  },
  {
    id: 'cgpa-percentage', name: 'CGPA ⇄ percentage', cat: 'calc', glyph: 'CGPA', blurb: 'Convert CGPA to percentage (× 9.5) and back.',
    fields: [num('x', 'Value', { default: 8.4, step: 0.01 }), sel('mode', 'Convert', [{ value: 'c2p', label: 'CGPA → %' }, { value: 'p2c', label: '% → CGPA' }], 'c2p')], example: { x: 8.4, mode: 'c2p' },
    run: (v) => stats([[S(v, 'mode') === 'c2p' ? 'Percentage' : 'CGPA', S(v, 'mode') === 'c2p' ? fmt(N(v, 'x') * 9.5, 2) + '%' : fmt(N(v, 'x') / 9.5, 2)]]),
  },
  {
    id: 'marks-percentage', name: 'Marks to percentage', cat: 'calc', glyph: '📝', blurb: 'Percentage and grade from marks.',
    fields: [num('got', 'Marks obtained', { default: 432 }), num('max', 'Maximum marks', { default: 500 })], example: { got: 432, max: 500 },
    run: (v) => { const p = (N(v, 'got') / Math.max(1, N(v, 'max'))) * 100; return stats([['Percentage', fmt(p, 2) + '%'], ['Grade', p >= 90 ? 'A+' : p >= 80 ? 'A' : p >= 70 ? 'B' : p >= 60 ? 'C' : p >= 50 ? 'D' : p >= 33 ? 'E (pass)' : 'Fail'], ['Division', p >= 60 ? 'First' : p >= 45 ? 'Second' : p >= 33 ? 'Third' : '—']]); },
  },
  {
    id: 'fd-calculator', name: 'FD maturity', cat: 'calc', glyph: 'FD', blurb: 'Fixed deposit maturity with quarterly compounding.',
    fields: [num('p', 'Deposit', { default: 200000 }), num('r', 'Rate % per year', { default: 7.1, step: 0.05 }), num('y', 'Years', { default: 5, step: 0.5 })], example: { p: 200000, r: 7.1, y: 5 },
    run: (v) => { const a = N(v, 'p') * (1 + N(v, 'r') / 400) ** (4 * N(v, 'y')); return stats([['Maturity amount', '₹' + money(a)], ['Interest', '₹' + money(a - N(v, 'p'))]]); },
  },
  {
    id: 'cagr-calculator', name: 'CAGR calculator', cat: 'calc', glyph: 'CAGR', blurb: 'Yearly growth rate between two values.',
    fields: [num('a', 'Start value', { default: 100000 }), num('b', 'End value', { default: 250000 }), num('y', 'Years', { default: 6 })], example: { a: 100000, b: 250000, y: 6 },
    run: (v) => { const a = N(v, 'a'), b = N(v, 'b'), y = N(v, 'y'); if (a <= 0 || b <= 0 || y <= 0) return err('Use positive numbers.'); return stats([['CAGR', fmt((Math.pow(b / a, 1 / y) - 1) * 100, 2) + '% per year'], ['Total growth', fmt(((b - a) / a) * 100, 1) + '%'], ['Doubles in about', fmt(Math.log(2) / Math.log(Math.pow(b / a, 1 / y)), 1) + ' years']]); },
  },
  {
    id: 'hourly-salary', name: 'Salary converter', cat: 'calc', glyph: '💼', blurb: 'Hourly, daily, monthly and yearly pay.',
    fields: [num('x', 'Amount', { default: 50000 }), sel('per', 'Per', ['hour', 'day', 'week', 'month', 'year'], 'month'), num('hours', 'Hours per week', { default: 40 })], example: { x: 50000, per: 'month', hours: 40 },
    run: (v) => { const f: Record<string, number> = { hour: 1, day: 8, week: N(v, 'hours', 40), month: (N(v, 'hours', 40) * 52) / 12, year: N(v, 'hours', 40) * 52 }, h = N(v, 'x') / f[S(v, 'per')]!; return table(['Per', 'Amount'], [['Hour', money(h)], ['Day (8 h)', money(h * 8)], ['Week', money(h * N(v, 'hours', 40))], ['Month', money((h * N(v, 'hours', 40) * 52) / 12)], ['Year', money(h * N(v, 'hours', 40) * 52)]]); },
  },
  {
    id: 'matrix-determinant', name: 'Matrix determinant', cat: 'calc', glyph: '|M|', blurb: '2×2 and 3×3 determinant, one row per line.',
    fields: [area('t', 'Matrix', { rows: 3, mono: true, default: '2 1 3\n0 4 1\n5 2 6' })], example: { t: '2 1 3\n0 4 1\n5 2 6' },
    run: (v) => { const m = S(v, 't').trim().split('\n').map((r) => nums(r)); if (m.length === 2 && m.every((r) => r.length === 2)) return stats([['Determinant', fmt(m[0]![0]! * m[1]![1]! - m[0]![1]! * m[1]![0]!)]]); if (m.length === 3 && m.every((r) => r.length === 3)) { const [a, b, c] = m[0]!, [d, e, f] = m[1]!, [g, h, i] = m[2]!; return stats([['Determinant', fmt(a! * (e! * i! - f! * h!) - b! * (d! * i! - f! * g!) + c! * (d! * h! - e! * g!))]]); } return err('Use a 2×2 or 3×3 matrix.'); },
  },
  {
    id: 'break-even', name: 'Break-even point', cat: 'calc', glyph: 'B/E', blurb: 'How many units to sell before you make a profit.',
    fields: [num('fixed', 'Fixed costs', { default: 50000 }), num('price', 'Price per unit', { default: 250 }), num('var', 'Variable cost per unit', { default: 150 })], example: { fixed: 50000, price: 250, var: 150 },
    run: (v) => { const m = N(v, 'price') - N(v, 'var'); if (m <= 0) return err('Price must be above the variable cost.'); const u = Math.ceil(N(v, 'fixed') / m); return stats([['Break-even units', u], ['Break-even revenue', '₹' + money(u * N(v, 'price'))], ['Margin per unit', '₹' + money(m)]]); },
  },
  {
    id: 'random-number', name: 'Random numbers', cat: 'calc', glyph: '🎲', blurb: 'Random whole numbers in a range, with or without repeats.',
    fields: [num('min', 'Min', { default: 1 }), num('max', 'Max', { default: 100 }), num('n', 'How many', { default: 5, min: 1, max: 1000 }), tog('uniq', 'No repeats', true)], example: { min: 1, max: 10, n: 5, uniq: true }, manual: true,
    run: (v) => {
      const lo = Math.ceil(Math.min(N(v, 'min'), N(v, 'max'))), hi = Math.floor(Math.max(N(v, 'min'), N(v, 'max'))), n = Math.max(1, Math.min(1000, N(v, 'n', 5))); const span = hi - lo + 1;
      if (B(v, 'uniq') && n > span) return err(`Only ${span} different numbers fit in that range.`);
      const g = globalThis.crypto; const r = () => (g ? g.getRandomValues(new Uint32Array(1))[0]! / 4294967296 : Math.random()); const out: number[] = []; const seen = new Set<number>();
      while (out.length < n) { const x = lo + Math.floor(r() * span); if (B(v, 'uniq') && seen.has(x)) continue; seen.add(x); out.push(x); }
      return text(out.join(', '));
    },
  },
  {
    id: 'rounding', name: 'Rounding', cat: 'calc', glyph: '≈', blurb: 'Round to decimals, tens, hundreds, or significant figures.',
    fields: [num('x', 'Number', { default: 1234.5678 }), num('d', 'Decimals', { default: 2, min: 0, max: 10 })], example: { x: 1234.5678, d: 2 },
    run: (v) => { const x = N(v, 'x'), d = N(v, 'd', 2); return table(['Method', 'Result'], [[`To ${d} decimals`, fmt(round(x, d), 10)], ['Floor', Math.floor(x)], ['Ceiling', Math.ceil(x)], ['Truncate', Math.trunc(x)], ['Nearest 10', Math.round(x / 10) * 10], ['Nearest 100', Math.round(x / 100) * 100], ['3 significant figures', Number(x.toPrecision(3))]]); },
  },
];

function rng0(id: string, label: string, def: number) { return { id, label, kind: 'range' as const, min: 0, max: 40, step: 1, default: def, unit: '%' }; }
