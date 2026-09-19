/**
 * One field, not two. The agent's startup banner prints a URL-shaped tunnel
 * plus a token; asking a user to copy both into separate boxes is exactly
 * the kind of friction "just paste the tunnel URL" is supposed to remove.
 * So the single input accepts the token appended after a `#` (what the
 * banner tells people to paste) or as a `?token=` query param, and this
 * splits it back into the two values the client actually needs.
 *
 * Kept in its own file, separate from client.ts, so it can be imported by
 * plain-node test scripts under `--experimental-strip-types`: client.ts's
 * HeartbeatMonitor uses TypeScript parameter properties, which strip-only
 * mode cannot parse, so importing the whole module there fails even though
 * this function itself has nothing to do with that class.
 */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function parseBridgeInput(raw: string): { url: string; token: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { url: '', token: '' };

  const hashIdx = trimmed.indexOf('#');
  if (hashIdx >= 0) {
    return { url: trimmed.slice(0, hashIdx), token: trimmed.slice(hashIdx + 1).trim() };
  }

  try {
    const u = new URL(normalizeUrl(trimmed));
    const qToken = u.searchParams.get('token');
    if (qToken) {
      u.searchParams.delete('token');
      const cleaned = u.toString().replace(/\?$/, '').replace(/\/$/, '');
      return { url: cleaned, token: qToken };
    }
  } catch {
    /* not parseable as a URL yet — still typing, or token-only so far */
  }

  return { url: trimmed, token: '' };
}
