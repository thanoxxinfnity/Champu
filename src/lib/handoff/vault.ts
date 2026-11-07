/**
 * The secure vault for Handoff: logins, cards and personal details, encrypted on this device with a key made from the user's PIN
 * (PBKDF2-SHA-256 → AES-256-GCM, Web Crypto). The agent never sees a value: it is shown names like "login:amazon" and asks for a
 * field; the app fills the value straight into the page, only on the site a login belongs to, and blanks it out of everything the
 * model reads afterwards. Pure apart from Web Crypto, so it is tested in node.
 */

export interface LoginItem { id: string; kind: 'login'; label: string; site: string; username: string; password: string }
export interface CardItem { id: string; kind: 'card'; label: string; name: string; number: string; expiry: string; cvv: string }
export interface IdentityItem { id: string; kind: 'identity'; label: string; fullName: string; email: string; phone: string; address: string; city: string; pincode: string }
export type VaultItem = LoginItem | CardItem | IdentityItem;
export interface VaultData { items: VaultItem[] }
export interface SealedVault { v: 1; kdf: 'PBKDF2-SHA256'; iterations: number; salt: string; iv: string; ct: string }

export const FIELDS: Record<VaultItem['kind'], string[]> = {
  login: ['username', 'password'],
  card: ['name', 'number', 'expiry', 'cvv'],
  identity: ['fullName', 'email', 'phone', 'address', 'city', 'pincode'],
};
export const ITERATIONS = 210_000;
export const MIN_PIN = 6;

const subtle = () => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('This browser has no Web Crypto, so the vault cannot be used here.');
  return s;
};
const b64 = (u: Uint8Array) => { let s = ''; for (const c of u) s += String.fromCharCode(c); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** A non-extractable AES key from the PIN; kept in memory while the vault is open, never stored. */
export async function deriveKey(pin: string, salt: Uint8Array, iterations = ITERATIONS): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function sealWith(key: CryptoKey, salt: Uint8Array, data: VaultData, iterations = ITERATIONS): Promise<SealedVault> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(data))));
  return { v: 1, kdf: 'PBKDF2-SHA256', iterations, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}

/** A new vault (or a PIN change): fresh salt, fresh key. */
export async function createVault(pin: string, data: VaultData = { items: [] }, iterations = ITERATIONS): Promise<{ sealed: SealedVault; key: CryptoKey; salt: Uint8Array }> {
  if (pin.length < MIN_PIN) throw new Error(`Use a PIN of at least ${MIN_PIN} characters.`);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(pin, salt, iterations);
  return { sealed: await sealWith(key, salt, data, iterations), key, salt };
}

/** Opens the vault; a wrong PIN fails the AES-GCM check and says so. */
export async function openVault(sealed: SealedVault, pin: string): Promise<{ data: VaultData; key: CryptoKey; salt: Uint8Array }> {
  const salt = unb64(sealed.salt);
  const key = await deriveKey(pin, salt, sealed.iterations);
  let plain: ArrayBuffer;
  try {
    plain = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(sealed.iv) as BufferSource }, key, unb64(sealed.ct) as BufferSource);
  } catch {
    throw new Error('Wrong PIN.');
  }
  const data = JSON.parse(new TextDecoder().decode(plain)) as VaultData;
  return { data: { items: Array.isArray(data.items) ? data.items : [] }, key, salt };
}

// ── what the agent may know ─────────────────────────────────────────────────

const slug = (s: string) => s.toLowerCase().replace(/^www\./, '').split('.')[0]!.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';

/** The name the agent uses for an item: "login:amazon", "card:hdfc-visa", "identity:home". Unique within the vault. */
export function refOf(item: VaultItem, all: VaultItem[]): string {
  const base = `${item.kind}:${slug(item.kind === 'login' ? item.site : item.label)}`;
  const same = all.filter((x) => `${x.kind}:${slug(x.kind === 'login' ? x.site : x.label)}` === base);
  return same.length > 1 ? `${base}-${same.indexOf(item) + 1}` : base;
}

export function lastFour(n: string): string { return n.replace(/\D/g, '').slice(-4); }

/** The vault as the agent sees it: names, sites and field names — never a value (only a card's last four digits). */
export function describeForAgent(items: VaultItem[], oneTime: string[] = []): string {
  if (!items.length && !oneTime.length) return 'The vault is empty. If the job needs a login, card, address or code, use request_secret.';
  const lines = items.map((it) => {
    const ref = refOf(it, items);
    if (it.kind === 'login') return `- ${ref} — login for ${it.site} (fields: username, password)`;
    if (it.kind === 'card') return `- ${ref} — card “${it.label}” ending ${lastFour(it.number)} (fields: name, number, expiry, cvv)`;
    return `- ${ref} — personal details “${it.label}” (fields: ${FIELDS.identity.join(', ')})`;
  });
  for (const o of oneTime) lines.push(`- once:${o} — given by the user for this job (field: value)`);
  return `Secure vault (values are hidden from you; the app types them for you with fill_secret):\n${lines.join('\n')}`;
}

/** Finds an item by the name the agent used. */
export function findByRef(ref: string, items: VaultItem[]): VaultItem | null {
  return items.find((it) => refOf(it, items) === ref.trim().toLowerCase()) ?? null;
}

export function fieldValue(item: VaultItem, field: string): string | null {
  if (!FIELDS[item.kind].includes(field)) return null;
  const v = (item as unknown as Record<string, unknown>)[field];
  return typeof v === 'string' && v ? v : null;
}

/** A host belongs to a saved site: amazon.in matches www.amazon.in and pay.amazon.in, never amazon.in.evil.com. */
export function hostMatches(host: string, site: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  const s = site.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').replace(/\.$/, '');
  return !!s && (h === s || h.endsWith(`.${s}`));
}

export function hostOf(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}

/** The first http(s) URL in a tool answer (the result of evaluating location.href). */
export function urlIn(text: string): string | null {
  return /https?:\/\/[^\s"'`<>)\]]+/.exec(text)?.[0] ?? null;
}

// ── keeping values out of everything the model reads ─────────────────────────

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replaces every secret (and a card number written with spaces or dashes) with dots. */
export function redact(text: string, secrets: Iterable<string>): string {
  let out = text;
  for (const raw of secrets) {
    const s = raw.trim();
    if (s.length < 3) continue;
    out = out.split(s).join('••••');
    const digits = s.replace(/\D/g, '');
    if (digits.length >= 8 && digits.length === s.replace(/[\s-]/g, '').length) {
      out = out.replace(new RegExp(digits.split('').map(esc).join('[\\s-]?'), 'g'), '••••');
    }
  }
  return out;
}

export const newItemId = (): string => `vlt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Light checks before saving an item, in words a person understands. */
export function validateItem(it: VaultItem): string | null {
  if (it.kind === 'login') {
    if (!it.site.trim() || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(it.site.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''))) return 'Enter the website, e.g. amazon.in';
    if (!it.password) return 'Enter the password.';
  }
  if (it.kind === 'card') {
    const d = it.number.replace(/\D/g, '');
    if (d.length < 12 || d.length > 19) return 'The card number looks wrong.';
    if (!/^(0[1-9]|1[0-2])\/?\d{2}$/.test(it.expiry.trim())) return 'Expiry should look like 08/29.';
  }
  if (!it.label.trim() && it.kind !== 'login') return 'Give it a short name.';
  return null;
}
