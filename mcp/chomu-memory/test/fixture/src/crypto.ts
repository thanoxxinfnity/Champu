import { createHash } from 'node:crypto';

export function hashPassword(pw: string): string {
  return createHash('sha256').update(pw).digest('hex');
}

// Sessions are tokens that expire after an hour.
export function makeToken(userId: number): string {
  const expires = Date.now() + 3600_000;
  return `${userId}.${expires}.${hashPassword(String(expires))}`;
}
