import { date, dtime, err, N, num, S, sel, stats, table, text, tog, txt, B } from '../helpers.ts';
import type { ToolDef } from '../types.ts';

const DAY = 86400000;
const iso = (d: Date): string => d.toISOString().slice(0, 10);
const parse = (s: string): Date | null => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim()); if (!m) return null; const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)); return Number.isNaN(d.getTime()) ? null : d; };
const today = (): Date => parse(iso(new Date()))!;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ZONES = ['Asia/Kolkata', 'UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland', 'America/Sao_Paulo'];
const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export function isoWeek(d: Date): number { const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7)); return Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / DAY + 1) / 7); }
export function diffYMD(a: Date, b: Date): { y: number; m: number; d: number } { if (a > b) [a, b] = [b, a]; let y = b.getUTCFullYear() - a.getUTCFullYear(), m = b.getUTCMonth() - a.getUTCMonth(), d = b.getUTCDate() - a.getUTCDate(); if (d < 0) { m--; d += new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), 0)).getUTCDate(); } if (m < 0) { y--; m += 12; } return { y, m, d }; }
const inZone = (d: Date, tz: string, opts: Intl.DateTimeFormatOptions = {}): string => new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short', ...opts }).format(d);

export const timeTools: ToolDef[] = [
  {
    id: 'unix-timestamp', name: 'Unix timestamp', cat: 'time', glyph: '⏱', blurb: 'Timestamp to date and date to timestamp.',
    fields: [txt('t', 'Timestamp or date', { default: '1893456000', mono: true })], example: { t: '1893456000' },
    run: (v) => { const s = S(v, 't').trim(); let d: Date; if (/^-?\d+(\.\d+)?$/.test(s)) { const n = Number(s); d = new Date(Math.abs(n) < 1e11 ? n * 1000 : n); } else d = new Date(s); if (Number.isNaN(d.getTime())) return err('Try 1893456000 or 2030-01-01 12:00.'); return table(['Format', 'Value'], [['Seconds', Math.floor(d.getTime() / 1000)], ['Milliseconds', d.getTime()], ['UTC (ISO)', d.toISOString()], ['India (IST)', inZone(d, 'Asia/Kolkata', { dateStyle: 'full', timeStyle: 'long' })], ['Relative', (() => { const diff = (d.getTime() - Date.now()) / 1000, a = Math.abs(diff); const u = a < 60 ? [a, 'second'] : a < 3600 ? [a / 60, 'minute'] : a < 86400 ? [a / 3600, 'hour'] : [a / 86400, 'day']; return `${Math.round(u[0] as number)} ${u[1]}${Math.round(u[0] as number) === 1 ? '' : 's'} ${diff < 0 ? 'ago' : 'from now'}`; })()]]); },
  },
  {
    id: 'date-difference', name: 'Date difference', cat: 'time', glyph: '↔📅', blurb: 'Years, months, days, weeks and hours between two dates.',
    fields: [date('a', 'From', '2024-01-26'), date('b', 'To', '2026-08-15')], example: { a: '2024-01-26', b: '2026-08-15' },
    run: (v) => { const a = parse(S(v, 'a')), b = parse(S(v, 'b')); if (!a || !b) return err('Pick both dates.'); const days = Math.round(Math.abs(b.getTime() - a.getTime()) / DAY), r = diffYMD(a, b); return stats([['Difference', `${r.y}y ${r.m}m ${r.d}d`], ['Total days', days], ['Weeks', `${Math.floor(days / 7)} w ${days % 7} d`], ['Hours', days * 24], ['Weekdays only', (() => { let n = 0; const s = a < b ? a : b; for (let i = 0; i < days; i++) { const w = new Date(s.getTime() + i * DAY).getUTCDay(); if (w && w !== 6) n++; } return n; })()]]); },
  },
  {
    id: 'add-days', name: 'Add / subtract days', cat: 'time', glyph: '＋📅', blurb: 'What date is N days, weeks or months from a date?',
    fields: [date('d', 'Start date', '2026-01-31'), num('n', 'Amount', { default: 45 }), sel('u', 'Unit', ['days', 'weeks', 'months', 'years'], 'days')], example: { d: '2026-01-31', n: 45, u: 'days' },
    run: (v) => { const d = parse(S(v, 'd')) ?? today(), n = N(v, 'n'), u = S(v, 'u'); const r = new Date(d); if (u === 'days') r.setUTCDate(r.getUTCDate() + n); else if (u === 'weeks') r.setUTCDate(r.getUTCDate() + n * 7); else if (u === 'months') { const day = r.getUTCDate(); r.setUTCDate(1); r.setUTCMonth(r.getUTCMonth() + n); r.setUTCDate(Math.min(day, new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate())); } else r.setUTCFullYear(r.getUTCFullYear() + n); return stats([['Result', iso(r)], ['Weekday', DAYS[r.getUTCDay()]!], ['Week of year', isoWeek(r)]]); },
  },
  {
    id: 'age-calculator', name: 'Age calculator', cat: 'time', glyph: '🎂', blurb: 'Exact age, next birthday and how long you have lived.',
    fields: [date('b', 'Birth date', '2000-03-15'), date('on', 'Age on (empty = today)')], example: { b: '2000-03-15', on: '2026-08-15' },
    run: (v) => { const b = parse(S(v, 'b')); if (!b) return err('Pick a birth date.'); const on = parse(S(v, 'on')) ?? today(); if (b > on) return err('That is in the future.'); const r = diffYMD(b, on), days = Math.round((on.getTime() - b.getTime()) / DAY); const nb = new Date(Date.UTC(on.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate())); if (nb < on) nb.setUTCFullYear(nb.getUTCFullYear() + 1); return stats([['Age', `${r.y} years, ${r.m} months, ${r.d} days`], ['Days lived', days.toLocaleString('en-IN')], ['Hours lived', (days * 24).toLocaleString('en-IN')], ['Next birthday', `${iso(nb)} (${DAYS[nb.getUTCDay()]}), in ${Math.round((nb.getTime() - on.getTime()) / DAY)} days`], ['Born on a', DAYS[b.getUTCDay()]!]]); },
  },
  {
    id: 'days-until', name: 'Days until', cat: 'time', glyph: '⏳📅', blurb: 'Countdown to a date: days, weeks and weekdays left.',
    fields: [date('d', 'Date', '2026-12-25'), date('from', 'From (empty = today)')], example: { d: '2026-12-25', from: '2026-08-15' },
    run: (v) => { const d = parse(S(v, 'd')); if (!d) return err('Pick a date.'); const f = parse(S(v, 'from')) ?? today(), n = Math.round((d.getTime() - f.getTime()) / DAY); return stats([[n >= 0 ? 'Days left' : 'Days ago', Math.abs(n)], ['Weeks', `${Math.floor(Math.abs(n) / 7)} w ${Math.abs(n) % 7} d`], ['Weekday', DAYS[d.getUTCDay()]!], ['Months (≈)', (Math.abs(n) / 30.44).toFixed(1)]]); },
  },
  {
    id: 'day-of-week', name: 'Day of the week', cat: 'time', glyph: 'Mon', blurb: 'Which weekday a date falls on, plus week and day number.',
    fields: [date('d', 'Date', '2026-08-15')], example: { d: '2026-08-15' },
    run: (v) => { const d = parse(S(v, 'd')); if (!d) return err('Pick a date.'); const y0 = Date.UTC(d.getUTCFullYear(), 0, 0); return stats([['Weekday', DAYS[d.getUTCDay()]!], ['Day of year', Math.round((d.getTime() - y0) / DAY)], ['ISO week', isoWeek(d)], ['Leap year', isLeap(d.getUTCFullYear()) ? 'Yes' : 'No'], ['Days in month', new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()]]); },
  },
  {
    id: 'calendar-view', name: 'Calendar', cat: 'time', glyph: '🗓', blurb: 'Any month as a calendar grid.',
    fields: [num('y', 'Year', { default: 2026, min: 1, max: 9999 }), sel('m', 'Month', ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'], '8'), txt('mark', 'Highlight days (e.g. 15, 26)', { default: '15' })], example: { y: 2026, m: '8', mark: '15, 26' },
    run: (v) => ({ kind: 'calendar', year: N(v, 'y', 2026), month: Number(S(v, 'm') || 1) - 1, marks: (S(v, 'mark').match(/\d+/g) ?? []).map(Number) }),
  },
  {
    id: 'world-clock', name: 'World clock', cat: 'time', glyph: '🌍', blurb: 'The time right now in major cities.',
    fields: [dtime('at', 'At (empty = now)')], example: { at: '2026-08-15T12:00' }, manual: false,
    run: (v) => { const at = S(v, 'at') ? new Date(`${S(v, 'at')}${S(v, 'at').length === 16 ? 'Z' : ''}`) : new Date(); if (Number.isNaN(at.getTime())) return err('Bad date.'); return table(['City / zone', 'Local time'], ZONES.map((z) => [z.replace('_', ' '), inZone(at, z)])); },
  },
  {
    id: 'timezone-converter', name: 'Time zone converter', cat: 'time', glyph: '🕐→🕔', blurb: 'Convert a time from one zone to others.',
    fields: [dtime('t', 'Date & time', '2026-08-15T18:30'), sel('from', 'From', ZONES, 'Asia/Kolkata')], example: { t: '2026-08-15T18:30', from: 'Asia/Kolkata' },
    run: (v) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(S(v, 't')); if (!m) return err('Pick a date and time.');
      const guess = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!); const off = (z: string, t: number) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: z, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(t)).map((x) => [x.type, x.value])); return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!) - t; };
      let utc = guess - off(S(v, 'from'), guess); utc = guess - off(S(v, 'from'), utc);
      return table(['Zone', 'Time'], ZONES.map((z) => [z, inZone(new Date(utc), z)]));
    },
  },
  {
    id: 'working-days', name: 'Working days', cat: 'time', glyph: '💼📅', blurb: 'Business days between two dates, with a weekend choice.',
    fields: [date('a', 'From', '2026-08-01'), date('b', 'To', '2026-08-31'), sel('we', 'Weekend', [{ value: 'sat-sun', label: 'Sat + Sun' }, { value: 'sun', label: 'Sunday only' }, { value: 'fri-sat', label: 'Fri + Sat' }], 'sat-sun')], example: { a: '2026-08-01', b: '2026-08-31', we: 'sat-sun' },
    run: (v) => { const a = parse(S(v, 'a')), b = parse(S(v, 'b')); if (!a || !b) return err('Pick both dates.'); const off = S(v, 'we') === 'sun' ? [0] : S(v, 'we') === 'fri-sat' ? [5, 6] : [0, 6]; let n = 0, t = 0; for (let x = new Date(Math.min(+a, +b)); x <= new Date(Math.max(+a, +b)); x = new Date(+x + DAY)) { t++; if (!off.includes(x.getUTCDay())) n++; } return stats([['Working days', n], ['Weekend days', t - n], ['Calendar days', t]]); },
  },
  {
    id: 'sleep-calculator', name: 'Sleep calculator', cat: 'time', glyph: '😴', blurb: 'When to wake or sleep so you finish a 90-minute sleep cycle.',
    fields: [txt('t', 'Wake-up time (HH:MM)', { default: '06:30' }), sel('mode', 'I want to', [{ value: 'sleep', label: 'Know when to go to bed' }, { value: 'wake', label: 'Know when to wake (I sleep at the time above)' }], 'sleep')], example: { t: '06:30', mode: 'sleep' },
    run: (v) => { const m = /^(\d{1,2}):(\d{2})$/.exec(S(v, 't').trim()); if (!m) return err('Use HH:MM, like 06:30.'); const base = +m[1]! * 60 + +m[2]!; const f = (x: number) => `${String(Math.floor((((x % 1440) + 1440) % 1440) / 60)).padStart(2, '0')}:${String((((x % 1440) + 1440) % 1440) % 60).padStart(2, '0')}`; return S(v, 'mode') === 'sleep' ? table(['Cycles', 'Sleep', 'Go to bed at'], [6, 5, 4, 3].map((c) => [c, `${c * 1.5} h`, f(base - c * 90 - 15)])) : table(['Cycles', 'Sleep', 'Wake at'], [3, 4, 5, 6].map((c) => [c, `${c * 1.5} h`, f(base + c * 90 + 15)])); },
  },
  {
    id: 'time-add', name: 'Add times', cat: 'time', glyph: '＋⏱', blurb: 'Add or subtract hours:minutes (like timesheets).',
    fields: [txt('t', 'Times, one per line (+/−)', { default: '1:45\n2:30\n-0:20' })], example: { t: '1:45\n2:30\n-0:20' },
    run: (v) => { let tot = 0; for (const l of S(v, 't').split('\n')) { const m = /^\s*([+-]?)\s*(\d+):(\d{2})\s*$/.exec(l); if (!m) { if (l.trim()) return err(`"${l}" is not h:mm.`); continue; } tot += (m[1] === '-' ? -1 : 1) * (+m[2]! * 60 + +m[3]!); } const a = Math.abs(tot); return stats([['Total', `${tot < 0 ? '-' : ''}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`], ['Decimal hours', (tot / 60).toFixed(2)], ['Minutes', tot]]); },
  },
  {
    id: 'leap-years', name: 'Leap years', cat: 'time', glyph: '366', blurb: 'Is it a leap year? The next ones too.',
    fields: [num('y', 'Year', { default: 2026 })], example: { y: 2026 },
    run: (v) => { const y = Math.trunc(N(v, 'y')); const next: number[] = []; for (let i = y + 1; next.length < 5; i++) if (isLeap(i)) next.push(i); return stats([[`${y}`, isLeap(y) ? 'Leap year (366 days)' : 'Normal year (365 days)'], ['Next leap years', next.join(', ')]]); },
  },
  {
    id: 'zodiac-sign', name: 'Zodiac sign', cat: 'time', glyph: '♈', blurb: 'Western sun sign, Chinese zodiac animal and birthstone.',
    fields: [date('d', 'Birth date', '2000-03-15')], example: { d: '2000-03-15' },
    run: (v) => { const d = parse(S(v, 'd')); if (!d) return err('Pick a date.'); const m = d.getUTCMonth() + 1, day = d.getUTCDate(); const signs: Array<[number, number, string]> = [[1, 20, 'Aquarius ♒'], [2, 19, 'Pisces ♓'], [3, 21, 'Aries ♈'], [4, 20, 'Taurus ♉'], [5, 21, 'Gemini ♊'], [6, 21, 'Cancer ♋'], [7, 23, 'Leo ♌'], [8, 23, 'Virgo ♍'], [9, 23, 'Libra ♎'], [10, 23, 'Scorpio ♏'], [11, 22, 'Sagittarius ♐'], [12, 22, 'Capricorn ♑']]; let sign = 'Capricorn ♑'; for (const [mm, dd, n] of signs) if (m > mm || (m === mm && day >= dd)) sign = n; const animals = ['Monkey', 'Rooster', 'Dog', 'Pig', 'Rat', 'Ox', 'Tiger', 'Rabbit', 'Dragon', 'Snake', 'Horse', 'Goat']; const stones = ['Garnet', 'Amethyst', 'Aquamarine', 'Diamond', 'Emerald', 'Pearl', 'Ruby', 'Peridot', 'Sapphire', 'Opal', 'Topaz', 'Turquoise']; return stats([['Sun sign', sign], ['Chinese zodiac', animals[d.getUTCFullYear() % 12]!], ['Birthstone', stones[m - 1]!]]); },
  },
];
void tog; void B;
