'use client';
export { Icon, ICON_NAMES } from '@/components/Icon';

/** The host a login or key belongs to, from "amazon.in", "https://www.github.com/login" or "GitHub". */
export function hostOf(site: string): string {
  const s = site.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/^www\./, '');
  return /\./.test(s) ? s : `${s.replace(/[^a-z0-9-]/g, '')}.com`;
}

/**
 * The website's own logo for a secure form: its icon from a public favicon service, with a letter tile while it loads or when
 * the site has none. Only the host name leaves the phone, never a field value.
 */
export function SiteLogo({ site, size = 44 }: { site: string; size?: number }) {
  const host = hostOf(site);
  const letter = (host[0] ?? '?').toUpperCase();
  return (
    <span className="relative grid shrink-0 place-items-center overflow-hidden rounded-2xl border" style={{ width: size, height: size, borderColor: 'var(--line)', background: '#fff' }}>
      <span className="absolute inset-0 grid place-items-center text-[17px] font-bold" style={{ color: 'hsl(220 15% 35%)' }}>{letter}</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`} alt={`${host} logo`} width={size * 0.62} height={size * 0.62} className="relative" style={{ background: '#fff' }}
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
    </span>
  );
}
