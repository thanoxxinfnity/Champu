import { area, B, err, fmt, N, num, S, sel, stats, table, text, tog, txt } from '../helpers.ts';
import type { ToolDef } from '../types.ts';

const enc = new TextEncoder();
const hex = (b: ArrayBuffer | Uint8Array): string => [...new Uint8Array(b instanceof Uint8Array ? b : b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const subtle = (): SubtleCrypto => { const s = globalThis.crypto?.subtle; if (!s) throw new Error('This browser has no Web Crypto.'); return s; };

/** MD5 (RFC 1321): not for security, but people still need to compare against old checksums. */
export function md5(bytes: Uint8Array): string {
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
  const S_ = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  const len = bytes.length, padded = new Uint8Array((((len + 8) >> 6) + 1) << 6); padded.set(bytes); padded[len] = 0x80;
  const dv = new DataView(padded.buffer); dv.setUint32(padded.length - 8, (len * 8) >>> 0, true); dv.setUint32(padded.length - 4, Math.floor((len * 8) / 2 ** 32), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let o = 0; o < padded.length; o += 64) {
    const M = Array.from({ length: 16 }, (_, i) => dv.getUint32(o + i * 4, true)); let A = a0, B_ = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number, g: number;
      if (i < 16) { F = (B_ & C) | (~B_ & D); g = i; } else if (i < 32) { F = (D & B_) | (~D & C); g = (5 * i + 1) % 16; } else if (i < 48) { F = B_ ^ C ^ D; g = (3 * i + 5) % 16; } else { F = C ^ (B_ | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i]! + M[g]!) >>> 0; A = D; D = C; C = B_; B_ = (B_ + ((F << S_[i]!) | (F >>> (32 - S_[i]!)))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B_) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new DataView(new ArrayBuffer(16)); [a0, b0, c0, d0].forEach((x, i) => out.setUint32(i * 4, x, true)); return hex(new Uint8Array(out.buffer));
}
export function crc32(bytes: Uint8Array): string { let c, crc = 0xffffffff; for (const b of bytes) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; crc = (crc >>> 8) ^ c; } return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0'); }
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const base32Encode = (b: Uint8Array): string => { let bits = 0, val = 0, o = ''; for (const x of b) { val = (val << 8) | x; bits += 8; while (bits >= 5) { o += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits) o += B32[(val << (5 - bits)) & 31]; return o; };
export const base32Decode = (s: string): Uint8Array => { const out: number[] = []; let bits = 0, val = 0; for (const c of s.toUpperCase().replace(/=+$/, '').replace(/\s/g, '')) { const i = B32.indexOf(c); if (i < 0) throw new Error('Not Base32'); val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return Uint8Array.from(out); };
const b64 = (b: Uint8Array): string => btoa(String.fromCharCode(...b));
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function aesKey(pw: string, salt: Uint8Array): Promise<CryptoKey> { const base = await subtle().importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']); return subtle().deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations: 150000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); }
export function luhn(digits: string): boolean { let s = 0, alt = false; for (let i = digits.length - 1; i >= 0; i--) { let d = +digits[i]!; if (alt) { d *= 2; if (d > 9) d -= 9; } s += d; alt = !alt; } return digits.length > 1 && s % 10 === 0; }

export const securityTools: ToolDef[] = [
  {
    id: 'hash-generator', name: 'Hash generator', cat: 'security', glyph: '#️⃣', blurb: 'MD5, SHA-1, SHA-256, SHA-384, SHA-512 and CRC32 of any text.',
    fields: [area('t', 'Text', { rows: 4, default: 'hello' })], example: { t: 'hello' },
    run: async (v) => { const b = enc.encode(S(v, 't')); const rows: Array<[string, string]> = [['MD5', md5(b)], ['CRC32', crc32(b)]]; for (const a of ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512']) rows.push([a, hex(await subtle().digest(a, b))]); return table(['Algorithm', 'Hash'], rows); },
  },
  {
    id: 'hmac-generator', name: 'HMAC generator', cat: 'security', glyph: 'HMAC', blurb: 'Sign a message with a secret key (SHA-256 / 512).',
    fields: [area('m', 'Message', { rows: 3, default: 'hello' }), txt('k', 'Secret key', { default: 'secret' }), sel('a', 'Hash', ['SHA-256', 'SHA-512', 'SHA-1'], 'SHA-256')], example: { m: 'hello', k: 'secret', a: 'SHA-256' },
    run: async (v) => { const k = await subtle().importKey('raw', enc.encode(S(v, 'k')), { name: 'HMAC', hash: S(v, 'a') }, false, ['sign']); const sig = new Uint8Array(await subtle().sign('HMAC', k, enc.encode(S(v, 'm')))); return table(['Encoding', 'Signature'], [['Hex', hex(sig)], ['Base64', b64(sig)]]); },
  },
  {
    id: 'password-strength', name: 'Password strength', cat: 'security', glyph: 'icon:shield', blurb: 'Entropy and time to crack: checked on your device only.',
    fields: [txt('p', 'Password', { default: 'Chai#Biscuit2026' })], example: { p: 'Chai#Biscuit2026' },
    run: (v) => { const p = S(v, 'p'); if (!p) return err('Type a password to test.'); let pool = 0; if (/[a-z]/.test(p)) pool += 26; if (/[A-Z]/.test(p)) pool += 26; if (/\d/.test(p)) pool += 10; if (/[^A-Za-z0-9]/.test(p)) pool += 32; const bits = p.length * Math.log2(pool || 1); const common = /^(password|123456|qwerty|admin|letmein|iloveyou|welcome)/i.test(p) || /(.)\1{3,}/.test(p) || /(0123|1234|abcd|qwer)/i.test(p); const secs = 2 ** Math.max(0, bits - 1) / 1e10; const fmtT = (s: number) => (s < 1 ? 'instantly' : s < 60 ? `${Math.round(s)} seconds` : s < 3600 ? `${Math.round(s / 60)} minutes` : s < 86400 ? `${Math.round(s / 3600)} hours` : s < 31536000 ? `${Math.round(s / 86400)} days` : s < 3.15e9 ? `${Math.round(s / 31536000)} years` : 'centuries'); return stats([['Rating', common ? 'Weak (common pattern)' : bits < 40 ? 'Weak' : bits < 60 ? 'Fair' : bits < 80 ? 'Strong' : 'Very strong'], ['Entropy', `${Math.round(bits)} bits`], ['Length', p.length], ['Offline cracking (10B guesses/s)', fmtT(secs)]]); },
  },
  {
    id: 'text-encrypt', name: 'Encrypt / decrypt text', cat: 'security', glyph: 'icon:lock', blurb: 'AES-256-GCM with a password (PBKDF2). Only you hold the key.',
    fields: [area('t', 'Text or encrypted blob', { rows: 5, default: 'secret note' }), txt('pw', 'Password', { default: 'chai1234' }), sel('mode', 'Mode', [{ value: 'enc', label: 'Encrypt' }, { value: 'dec', label: 'Decrypt' }], 'enc')], example: { t: 'secret note', pw: 'chai1234', mode: 'enc' }, manual: true,
    run: async (v) => {
      try {
        if (!S(v, 'pw')) return err('Enter a password.');
        if (S(v, 'mode') === 'enc') { const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, await aesKey(S(v, 'pw'), salt), enc.encode(S(v, 't')))); return text('v1.' + b64(salt) + '.' + b64(iv) + '.' + b64(ct)); }
        const [ver, s, i, c] = S(v, 't').trim().split('.'); if (ver !== 'v1' || !s || !i || !c) return err('That is not an encrypted blob from this tool.');
        return text(new TextDecoder().decode(await subtle().decrypt({ name: 'AES-GCM', iv: unb64(i) as BufferSource }, await aesKey(S(v, 'pw'), unb64(s)), unb64(c) as BufferSource)));
      } catch { return err('Could not decrypt: wrong password or damaged text.'); }
    },
  },
  {
    id: 'card-validator', name: 'Card number check', cat: 'security', glyph: 'icon:card', blurb: 'Luhn check and card network (no number leaves your device).',
    fields: [txt('n', 'Card number', { default: '4111 1111 1111 1111', mono: true })], example: { n: '4111 1111 1111 1111' },
    run: (v) => { const d = S(v, 'n').replace(/[\s-]/g, ''); if (!/^\d{12,19}$/.test(d)) return err('Use 12 to 19 digits.'); const net = /^4/.test(d) ? 'Visa' : /^(5[1-5]|2[2-7])/.test(d) ? 'Mastercard' : /^3[47]/.test(d) ? 'American Express' : /^(60|65|81|82|508)/.test(d) ? 'RuPay / Discover' : /^35/.test(d) ? 'JCB' : 'Unknown'; return stats([['Luhn check', luhn(d) ? 'Valid ✓' : 'Invalid ✗'], ['Network', net], ['Digits', d.length]]); },
  },
  {
    id: 'totp-generator', name: 'TOTP code', cat: 'security', glyph: 'icon:hash', blurb: 'The 6-digit code for a 2FA secret (test your authenticator setup).',
    fields: [txt('s', 'Base32 secret', { default: 'JBSWY3DPEHPK3PXP', mono: true }), num('at', 'Unix time (0 = now)', { default: 0 })], example: { s: 'JBSWY3DPEHPK3PXP', at: 59 },
    run: async (v) => { try { const key = base32Decode(S(v, 's')); const t = N(v, 'at') > 0 ? N(v, 'at') : Math.floor(Date.now() / 1000), ctr = Math.floor(t / 30); const msg = new DataView(new ArrayBuffer(8)); msg.setUint32(0, Math.floor(ctr / 2 ** 32)); msg.setUint32(4, ctr >>> 0); const k = await subtle().importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']); const h = new Uint8Array(await subtle().sign('HMAC', k, msg.buffer)); const o = h[19]! & 15; const code = (((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!) % 1e6; return stats([['Code', String(code).padStart(6, '0')], ['Valid for', `${30 - (t % 30)} s`]]); } catch { return err('The secret must be Base32 (A–Z, 2–7).'); } },
  },
  {
    id: 'base32', name: 'Base32', cat: 'security', glyph: 'b32', blurb: 'Encode and decode Base32 (used by 2FA secrets).',
    fields: [area('t', 'Input', { rows: 3, default: 'Hello!' }), sel('mode', 'Mode', [{ value: 'enc', label: 'Encode' }, { value: 'dec', label: 'Decode' }], 'enc')], example: { t: 'Hello!', mode: 'enc' },
    run: (v) => { try { return text(S(v, 'mode') === 'enc' ? base32Encode(enc.encode(S(v, 't'))) : new TextDecoder().decode(base32Decode(S(v, 't')))); } catch { return err('That is not valid Base32.'); } },
  },
  {
    id: 'checksum-compare', name: 'Hash compare', cat: 'security', glyph: '=?', blurb: 'Do two hashes match? Ignores case and spaces.',
    fields: [txt('a', 'Hash 1', { mono: true, default: 'ABCDEF 123456' }), txt('b', 'Hash 2', { mono: true, default: 'abcdef123456' })], example: { a: 'ABCDEF 123456', b: 'abcdef123456' },
    run: (v) => { const n = (s: string) => s.toLowerCase().replace(/[^0-9a-f]/g, ''); return n(S(v, 'a')) && n(S(v, 'a')) === n(S(v, 'b')) ? stats([['Result', 'Match ✓']]) : stats([['Result', 'Different ✗']]); },
  },
  {
    id: 'secret-key-generator', name: 'API key / secret', cat: 'security', glyph: 'icon:key', blurb: 'Random keys in hex, Base64 or with a prefix like sk_live_.',
    fields: [sel('bytes', 'Strength', [{ value: '16', label: '128-bit' }, { value: '24', label: '192-bit' }, { value: '32', label: '256-bit' }, { value: '64', label: '512-bit' }], '32'), sel('fmt', 'Format', ['hex', 'base64url', 'base32'], 'hex'), txt('pre', 'Prefix', { default: 'sk_' })], example: { bytes: '32', fmt: 'hex', pre: 'sk_' }, manual: true,
    run: (v) => { const b = crypto.getRandomValues(new Uint8Array(Number(S(v, 'bytes')))); const f = S(v, 'fmt'); return text(S(v, 'pre') + (f === 'hex' ? hex(b) : f === 'base32' ? base32Encode(b).toLowerCase() : b64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''))); },
  },
  {
    id: 'entropy-calculator', name: 'Entropy of a pool', cat: 'security', glyph: 'bits', blurb: 'How many bits a password or PIN of a given kind has.',
    fields: [sel('pool', 'Made of', [{ value: '10', label: 'Digits (PIN)' }, { value: '26', label: 'Lowercase letters' }, { value: '52', label: 'Upper + lower' }, { value: '62', label: 'Letters + digits' }, { value: '94', label: 'All keyboard characters' }, { value: '7776', label: 'Diceware words' }], '62'), num('len', 'Length', { default: 12, min: 1 })], example: { pool: '62', len: 12 },
    run: (v) => { const bits = N(v, 'len') * Math.log2(Number(S(v, 'pool'))); return stats([['Entropy', `${fmt(bits, 1)} bits`], ['Combinations', Number(S(v, 'pool')) ** N(v, 'len') > 1e21 ? (Number(S(v, 'pool')) ** N(v, 'len')).toExponential(2) : String(Number(S(v, 'pool')) ** N(v, 'len'))], ['Rating', bits < 40 ? 'Weak' : bits < 64 ? 'OK' : bits < 100 ? 'Strong' : 'Excellent']]); },
  },
  {
    id: 'ip-info', name: 'IP address check', cat: 'security', glyph: 'IP', blurb: 'Is it IPv4/IPv6, private, loopback or link-local? (offline check)',
    fields: [txt('ip', 'IP address', { default: '192.168.1.20', mono: true })], example: { ip: '192.168.1.20' },
    run: (v) => { const ip = S(v, 'ip').trim(); const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip); if (m) { const o = m.slice(1).map(Number); if (o.some((x) => x > 255)) return err('Each part must be 0–255.'); const kind = o[0] === 10 || (o[0] === 172 && o[1]! >= 16 && o[1]! <= 31) || (o[0] === 192 && o[1] === 168) ? 'Private (LAN)' : o[0] === 127 ? 'Loopback' : o[0] === 169 && o[1] === 254 ? 'Link-local' : o[0]! >= 224 ? 'Multicast / reserved' : 'Public'; return stats([['Version', 'IPv4'], ['Type', kind], ['Binary', o.map((x) => x.toString(2).padStart(8, '0')).join('.')], ['Integer', ((o[0]! << 24) >>> 0) + (o[1]! << 16) + (o[2]! << 8) + o[3]!]]); } if (/^[0-9a-f:]+$/i.test(ip) && ip.includes(':')) return stats([['Version', 'IPv6'], ['Type', ip === '::1' ? 'Loopback' : /^fe80/i.test(ip) ? 'Link-local' : /^f[cd]/i.test(ip) ? 'Unique local (private)' : 'Global / other']]); return err('That is not an IP address.'); },
  },
];
void B; void tog;
