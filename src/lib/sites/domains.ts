/**
 * Website names that carry their logo.
 *
 * When a message mentions `claude.com` or `https://github.com/x/y`, the name is
 * shown as a small chip with that site's own icon in front of it — the same
 * everywhere a name appears (the box you type in, your message, the reply, the
 * links the research cites), so a site never looks different from one place to
 * the next.
 *
 * Pure text in, text out: no DOM, so it runs in Node tests and is the single
 * definition of "what counts as a website name".
 */

/**
 * Top-level domains a mention may end in. A short allow-list on purpose: most
 * two-letter endings are also file extensions (`main.py`, `README.md`, `app.rs`,
 * `index.js`), and a file name wearing a website's logo is worse than a website
 * name that misses one.
 */
const TLDS = [
  'com', 'org', 'net', 'edu', 'gov', 'info', 'biz', 'dev', 'app', 'tech', 'site', 'online', 'store', 'cloud', 'page',
  'blog', 'wiki', 'news', 'pro', 'xyz', 'ai', 'io', 'co', 'in', 'me', 'tv', 'gg', 'fm', 'ly', 'to', 'cc', 'ws', 'us',
  'uk', 'de', 'fr', 'jp', 'cn', 'ru', 'br', 'ca', 'au', 'nl', 'es', 'it', 'id', 'pk', 'bd', 'lk', 'np',
].sort((a, b) => b.length - a.length);

const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';

/**
 * `https://host/path`, `www.host/path`, or a bare `host.tld`. Not preceded by a
 * word character, `@`, `.`, `/` or `-` — that keeps `user@gmail.com` and the
 * tail of a longer token from being read as a site.
 */
const SITE = new RegExp(
  `(?<![\\w@./:-])(?:https?:\\/\\/)?(?:${LABEL}\\.)+(?:${TLDS.join('|')})(?![a-z0-9-])(?::\\d{1,5})?(?:[/?#][^\\s<>"'\`)\\]]*)?`,
  'gi',
);

export interface SiteMention {
  start: number;
  end: number;
  /** The text as written, without a scheme — what the chip shows. */
  label: string;
  /** Lower-case host without `www.` — what the logo is looked up by. */
  domain: string;
}

/** `https://www.Claude.com:443/x` → `claude.com`. */
export function hostOf(text: string): string {
  return text
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^www\./i, '')
    .toLowerCase();
}

/** Trailing sentence punctuation is not part of the address. */
function trimTail(match: string): string {
  return match.replace(/[.,;:!?]+$/, '');
}

export function findSites(text: string): SiteMention[] {
  const found: SiteMention[] = [];
  for (const m of text.matchAll(SITE)) {
    const raw = trimTail(m[0]);
    if (!raw) continue;
    const start = m.index ?? 0;
    found.push({
      start,
      end: start + raw.length,
      label: raw.replace(/^https?:\/\//i, '').replace(/\/$/, ''),
      domain: hostOf(raw),
    });
  }
  return found;
}

/** Distinct sites in order of first mention. */
export function uniqueDomains(text: string, max = 8): string[] {
  const seen: string[] = [];
  for (const s of findSites(text)) {
    if (!seen.includes(s.domain)) seen.push(s.domain);
    if (seen.length >= max) break;
  }
  return seen;
}

/**
 * Where the logo comes from. Google's favicon service answers for any domain
 * (a plain globe for one it does not know) and is the one lookup that returns a
 * usable image for nearly every site; the privacy page says so.
 */
export function faviconUrl(domain: string, size = 64): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The logo itself, as HTML. */
function logoHtml(domain: string): string {
  return `<span class="site-chip-logo"><img src="${esc(faviconUrl(domain))}" alt="" width="18" height="18" loading="lazy" decoding="async" referrerpolicy="no-referrer"></span>`;
}

/** A whole chip, as HTML, for a name that was plain text. */
export function chipHtml(site: Pick<SiteMention, 'label' | 'domain'>, labelAlreadyEscaped = false): string {
  const label = labelAlreadyEscaped ? site.label : esc(site.label);
  return `<a class="site-chip" href="https://${esc(site.domain)}" target="_blank" rel="noopener noreferrer nofollow">${logoHtml(site.domain)}<span class="site-chip-name">${label}</span></a>`;
}

/** Elements whose text is never rewritten: code reads as code, and a link is already a link. */
const OPAQUE = /^<(a|code|pre|script|style|button|textarea)\b/i;
const OPAQUE_CLOSE = /^<\/(a|code|pre|script|style|button|textarea)\s*>/i;

/**
 * Gives every website name in rendered chat HTML its logo.
 *
 * - A link to a site gets the logo put in front of its text (the host comes
 *   from the href, so `[the docs](https://godotengine.org)` shows Godot's icon).
 * - A bare name in running text becomes a chip.
 * - Code blocks and inline code are left exactly as they are.
 *
 * Works on the HTML `marked` already produced and escaped, so it never touches
 * untrusted text: it only wraps matches in markup of its own.
 */
export function chipifyHtml(html: string): string {
  // 1. Existing links: logo before the text.
  const withLogos = html.replace(
    /<a ([^>]*?)href="(https?:\/\/[^"]+)"([^>]*)>([\s\S]*?)<\/a>/gi,
    (whole, before: string, href: string, after: string, inner: string) => {
      if (/site-chip/.test(whole)) return whole;
      const domain = hostOf(href.replace(/&amp;/g, '&'));
      if (!domain) return whole;
      // The terminal bridge (a tunnel, a LAN address, localhost) has no logo to look up: its links are file downloads, not websites.
      if (/^(\d{1,3}\.){3}\d{1,3}$/.test(domain) || /^localhost$|\.local$|\.internal$|^\[/.test(domain)) return whole;
      return `<a ${before}href="${href}"${after} class="site-chip">${logoHtml(domain)}<span class="site-chip-name">${inner}</span></a>`;
    },
  );

  // 2. Plain-text names, outside anything opaque.
  let depth = 0;
  return withLogos
    .split(/(<[^>]+>)/)
    .map((part) => {
      if (part.startsWith('<')) {
        if (OPAQUE.test(part) && !part.endsWith('/>')) depth += 1;
        else if (OPAQUE_CLOSE.test(part)) depth = Math.max(0, depth - 1);
        return part;
      }
      if (depth > 0 || !part.includes('.')) return part;
      const sites = findSites(part);
      if (!sites.length) return part;
      let out = '';
      let at = 0;
      for (const s of sites) {
        out += part.slice(at, s.start) + chipHtml(s, true);
        at = s.end;
      }
      return out + part.slice(at);
    })
    .join('');
}
