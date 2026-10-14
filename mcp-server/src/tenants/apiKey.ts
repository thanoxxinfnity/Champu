import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** No dependency on env/config — a provisioning CLI can hash or mint a key without a full server boot. */
export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey, 'utf8').digest('hex');
}

/** A fresh, printable API key plus the hash that should be stored for it. Prints once, by design. */
export function generateApiKey(): { key: string; hash: string } {
  const key = `cmk_${randomBytes(24).toString('base64url')}`;
  return { key, hash: hashApiKey(key) };
}

export function safeHashEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
