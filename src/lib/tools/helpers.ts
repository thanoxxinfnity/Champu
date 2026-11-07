import type { Field, Out, Values } from './types.ts';

export const txt = (id: string, label: string, o: { placeholder?: string; default?: string; mono?: boolean } = {}): Field => ({ id, label, kind: 'text', ...o });
export const area = (id: string, label: string, o: { placeholder?: string; default?: string; rows?: number; mono?: boolean } = {}): Field => ({ id, label, kind: 'area', ...o });
export const num = (id: string, label: string, o: { default?: number; min?: number; max?: number; step?: number; unit?: string } = {}): Field => ({ id, label, kind: 'number', ...o });
export const sel = (id: string, label: string, options: Array<string | { value: string; label: string }>, def?: string): Field => ({ id, label, kind: 'select', options, default: def });
export const tog = (id: string, label: string, def = false): Field => ({ id, label, kind: 'toggle', default: def });
export const col = (id: string, label: string, def = '#4f7cff'): Field => ({ id, label, kind: 'color', default: def });
export const rng = (id: string, label: string, min: number, max: number, def: number, step = 1, unit?: string): Field => ({ id, label, kind: 'range', min, max, step, default: def, unit });
export const date = (id: string, label: string, def?: string): Field => ({ id, label, kind: 'date', default: def });
export const dtime = (id: string, label: string, def?: string): Field => ({ id, label, kind: 'datetime', default: def });

export const text = (t: string, lang?: string): Out => ({ kind: 'text', text: t, lang });
export const err = (message: string): Out => ({ kind: 'error', message });
export const stats = (items: Array<[string, string | number]>): Out => ({ kind: 'stats', items: items.map(([label, value]) => ({ label, value: String(value) })) });
export const table = (head: string[], rows: Array<Array<string | number>>): Out => ({ kind: 'table', head, rows });
export const list = (items: string[]): Out => ({ kind: 'list', items });

export const S = (v: Values, k: string): string => String(v[k] ?? '');
export const N = (v: Values, k: string, d = 0): number => {
  const x = Number(v[k]);
  return Number.isFinite(x) ? x : d;
};
export const B = (v: Values, k: string): boolean => v[k] === true || v[k] === 'true';

export const round = (x: number, p = 4): number => {
  const k = 10 ** p;
  return Math.round((x + Number.EPSILON) * k) / k;
};
export const fmt = (x: number, p = 4): string => {
  if (!Number.isFinite(x)) return String(x);
  const r = round(x, p);
  return Math.abs(r) >= 1e15 || (Math.abs(r) < 1e-6 && r !== 0) ? r.toExponential(4) : String(r);
};
export const money = (x: number): string => x.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

export const lines = (s: string): string[] => s.replace(/\r/g, '').split('\n');
export const words = (s: string): string[] => s.trim().split(/\s+/).filter(Boolean);

/** Deterministic pseudo-random numbers (mulberry32): random tools take a seed so they can be tested. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function rand(seed?: number): () => number {
  if (seed !== undefined && Number.isFinite(seed) && seed !== 0) return prng(seed);
  const g = (globalThis as { crypto?: { getRandomValues: (a: Uint32Array) => Uint32Array } }).crypto;
  if (g) return () => g.getRandomValues(new Uint32Array(1))[0]! / 4294967296;
  return Math.random;
}
export const pick = <T>(r: () => number, a: T[]): T => a[Math.floor(r() * a.length)]!;

export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function hexToRgb(hex: string): [number, number, number] | null {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
export const rgbToHex = (r: number, g: number, b: number): string => '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l * 100];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
export const hslHex = (h: number, s: number, l: number): string => rgbToHex(...hslToRgb(h, s, Math.max(0, Math.min(100, l))));
export function luminance(hex: string): number {
  const c = hexToRgb(hex) ?? [0, 0, 0];
  const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
export const contrast = (a: string, b: string): number => {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/** A safe arithmetic evaluator (no eval): + - * / ^ % parentheses, functions and constants. */
export function evaluate(src: string, degrees = false): number {
  const tok = src.replace(/\s+/g, '').toLowerCase().replace(/×/g, '*').replace(/÷/g, '/').replace(/π/g, 'pi').replace(/√/g, 'sqrt');
  let i = 0;
  const fn: Record<string, (x: number) => number> = {
    sin: (x) => Math.sin(degrees ? (x * Math.PI) / 180 : x), cos: (x) => Math.cos(degrees ? (x * Math.PI) / 180 : x), tan: (x) => Math.tan(degrees ? (x * Math.PI) / 180 : x),
    asin: (x) => (degrees ? (Math.asin(x) * 180) / Math.PI : Math.asin(x)), acos: (x) => (degrees ? (Math.acos(x) * 180) / Math.PI : Math.acos(x)), atan: (x) => (degrees ? (Math.atan(x) * 180) / Math.PI : Math.atan(x)),
    sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, ln: Math.log, log: Math.log10, log2: Math.log2, exp: Math.exp, floor: Math.floor, ceil: Math.ceil, round: Math.round,
  };
  const consts: Record<string, number> = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };
  const peek = () => tok[i];
  function expr(): number { let v = term(); while (peek() === '+' || peek() === '-') { const o = tok[i++]; const r = term(); v = o === '+' ? v + r : v - r; } return v; }
  function term(): number { let v = pow(); while (peek() === '*' || peek() === '/' || peek() === '%') { const o = tok[i++]; const r = pow(); v = o === '*' ? v * r : o === '/' ? v / r : v % r; } return v; }
  function pow(): number { const b = unary(); if (peek() === '^') { i++; return b ** pow(); } return b; }
  function unary(): number { if (peek() === '-') { i++; return -unary(); } if (peek() === '+') { i++; return unary(); } return post(); }
  function post(): number { let v = atom(); while (peek() === '!') { i++; v = factorial(v); } if (peek() === '%' && tok[i + 1] === undefined) { i++; v /= 100; } return v; }
  function atom(): number {
    if (peek() === '(') { i++; const v = expr(); if (peek() !== ')') throw new Error('Missing )'); i++; return v; }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/.exec(tok.slice(i));
    if (num) { i += num[0].length; return parseFloat(num[0]); }
    const id = /^[a-z][a-z0-9]*/.exec(tok.slice(i));
    if (id) {
      i += id[0].length;
      if (id[0] in consts) return consts[id[0]]!;
      if (id[0] in fn) { if (peek() !== '(') throw new Error(`${id[0]} needs (…)`); i++; const v = expr(); if (peek() !== ')') throw new Error('Missing )'); i++; return fn[id[0]]!(v); }
      throw new Error(`Unknown name "${id[0]}"`);
    }
    throw new Error(i >= tok.length ? 'The expression ends too early' : `Unexpected "${tok[i]}"`);
  }
  const v = expr();
  if (i < tok.length) throw new Error(`Unexpected "${tok[i]}"`);
  return v;
}
export function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0 || n > 170) throw new Error('Factorial needs a whole number from 0 to 170');
  let r = 1;
  for (let k = 2; k <= n; k++) r *= k;
  return r;
}
export const gcd = (a: number, b: number): number => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };
