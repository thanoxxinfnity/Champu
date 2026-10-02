'use client';

import type { ReactNode } from 'react';
import { faviconUrl, findSites, uniqueDomains } from '@/lib/sites/domains';

/**
 * A website name with its logo in front of it.
 *
 * Same markup and classes as the chips `chipifyHtml` writes into replies, so a
 * site looks identical in the box you type in, in your own message and in the
 * answer. The styles live in globals.css under `.site-chip`.
 */
export function SiteChip({ domain, label, href = true }: { domain: string; label?: string; href?: boolean }) {
  const inner = (
    <>
      <span className="site-chip-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={faviconUrl(domain)} alt="" width={18} height={18} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
      </span>
      <span className="site-chip-name">{label ?? domain}</span>
    </>
  );
  return href ? (
    <a className="site-chip" href={`https://${domain}`} target="_blank" rel="noopener noreferrer nofollow">
      {inner}
    </a>
  ) : (
    <span className="site-chip">{inner}</span>
  );
}

/** The sites mentioned in what is being typed, shown above the box. */
export function SiteChipRow({ text }: { text: string }) {
  const domains = uniqueDomains(text, 20);
  if (!domains.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 border-b px-3 py-2" style={{ borderColor: 'var(--line)' }} aria-label="Websites mentioned">
      {domains.map((d) => (
        <SiteChip key={d} domain={d} href={false} />
      ))}
    </div>
  );
}

/** Plain text with every website name swapped for its chip — for your own messages. */
export function TextWithSites({ text }: { text: string }): ReactNode {
  const sites = findSites(text);
  if (!sites.length) return text;
  const parts: ReactNode[] = [];
  let at = 0;
  sites.forEach((s, i) => {
    if (s.start > at) parts.push(text.slice(at, s.start));
    parts.push(<SiteChip key={`${s.start}-${i}`} domain={s.domain} label={s.label} />);
    at = s.end;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}
