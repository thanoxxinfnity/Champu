/**
 * Line icons for Handoff and Computer use, drawn as SVG so they look the same on every phone (emoji differ per vendor and read as
 * clutter). 24-unit grid, 1.8 stroke, currentColor. An unknown name (an old panel saved with an emoji) falls back to `panel`.
 */
const P: Record<string, string> = {
  monitor: 'M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M8 21h8 M12 17v4',
  globe: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M3 12h18 M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9s1.2-6.4 3.8-9z',
  lock: 'M6 11h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z M8 11V8a4 4 0 0 1 8 0v3',
  shield: 'M12 3l8 3v6c0 4.8-3.4 8-8 9c-4.6-1-8-4.2-8-9V6z M9 12l2 2 4-4',
  key: 'M7.5 12a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7z M10 13.5L19.5 4 M16 7.5l2.5 2.5 M13.5 10l2 2',
  card: 'M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z M2 10h20 M6 15h4',
  user: 'M12 4a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M4 21c0-4 3.6-6 8-6s8 2 8 6',
  clock: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M12 7v5l3.5 2',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6.5 6.5l11 11 M17.5 6.5l-11 11',
  stop: 'M7 6h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z',
  back: 'M19 12H5 M11 6l-6 6 6 6',
  next: 'M5 12h14 M13 6l6 6-6 6',
  refresh: 'M20 12a8 8 0 1 1-2.4-5.7 M20 4v5h-5',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z',
  pointer: 'M5 3l13 7-5.6 1.6L10 17z M13 13l5 5',
  sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  alert: 'M12 3.5l9.5 16.5h-19z M12 10v4.5 M12 17.2v.3',
  panel: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
  sun: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  sunrise: 'M3 19h18 M7 19a5 5 0 0 1 10 0 M12 4v5 M9.5 6.5L12 4l2.5 2.5 M4.5 12.5l1.4 1.4 M19.5 12.5l-1.4 1.4',
  sunset: 'M3 19h18 M7 19a5 5 0 0 1 10 0 M12 9V4 M9.5 6.5L12 9l2.5-2.5 M4.5 12.5l1.4 1.4 M19.5 12.5l-1.4 1.4',
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14z M20.5 20.5l-4.5-4.5',
  news: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M7 8.5h10 M7 12h10 M7 15.5h6',
  cloud: 'M7 18h10a4 4 0 0 0 .4-8A6 6 0 0 0 6 11a3.5 3.5 0 0 0 1 7z',
  calendar: 'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z M3 10h18 M8 3v4 M16 3v4',
  tag: 'M3 12V4h8l10 10-8 8z M7.5 6.5a1.2 1.2 0 1 0 0 2.4a1.2 1.2 0 1 0 0-2.4z',
  wallet: 'M5 6h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z M3 10h18 M16 15h2',
  food: 'M7 3v8a2 2 0 0 0 4 0V3 M9 11v10 M17 3c-2 2-2.5 6 0 8v10',
  plane: 'M21 4L3 11l7 2.5L12.5 21z M10 13.5L21 4',
  train: 'M9 3h6a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z M6 10h12 M8.5 21l2-4 M15.5 21l-2-4',
  file: 'M6 3h8l4 4v14H6z M14 3v4h4 M9 13h6 M9 17h6',
  briefcase: 'M5 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z M9 7V5h6v2 M3 13h18',
  chart: 'M5 20V11 M11 20V5 M17 20v-6 M3 20h18',
  mail: 'M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z M3 7.5l9 6 9-6',
  package: 'M12 3l8 4.5v9L12 21l-8-4.5v-9z M4 7.5l8 4.5 8-4.5 M12 12v9',
  compass: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M15.5 8.5l-2 5-5 2 2-5z',
  learn: 'M2 9l10-5 10 5-10 5z M6 11v5c3 2.2 9 2.2 12 0v-5',
  play: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M10 8.5v7l6-3.5z',
  edit: 'M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4',
  flame: 'M12 3c1 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-4.5 2-7.5 2 1 3 3 3 5 1-2 1.2-5.5 1-8.5z',
  dumbbell: 'M6.5 7v10 M17.5 7v10 M3.5 9.5v5 M20.5 9.5v5 M6.5 12h11',
  droplet: 'M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z',
  timer: 'M12 5a8 8 0 1 0 0 16a8 8 0 1 0 0-16z M12 9v4l2.5 2 M9 2h6',
  book: 'M5 4h13v16H7a2 2 0 0 1-2-2z M5 18a2 2 0 0 1 2-2h11',
  hourglass: 'M6 3h12 M6 21h12 M7 3v2a5 5 0 0 0 10 0V3 M7 21v-2a5 5 0 0 1 10 0v2',
  smile: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M8.5 14.5a4.5 4.5 0 0 0 7 0 M9 9.5h.01 M15 9.5h.01',
  trending: 'M3 17l6-6 4 4 8-8 M15 7h6v6',
  leaf: 'M5 19C5 10 11 5 20 5c0 9-5 15-15 14z M5 19l8-8',
  bulb: 'M9 18h6 M10 21h4 M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z',
  download: 'M12 3v12 M7 10l5 5 5-5 M4 20h16',
  install: 'M4 4h16v11H4z M12 7v6 M9 10.5l3 2.5 3-2.5 M8 20h8 M12 15v5',
  terminal: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M7 9l3 3-3 3 M12.5 15H17',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z',
  screen: 'M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M8 21h8 M12 17v4 M9 10.5l3-3 3 3 M12 7.5v6',
  plus: 'M12 5v14 M5 12h14',
  chevronLeft: 'M15 5l-7 7 7 7',
  code: 'M8 7l-5 5 5 5 M16 7l5 5-5 5',
  apikey: 'M7.5 9a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7z M11 12.5h10 M17 12.5v3 M20 12.5v2',
};
const FILLED = new Set(['stop']);

export const ICON_NAMES = Object.keys(P);

export function Icon({ name, size = 18, stroke = 1.8, className, style, title }: { name: string; size?: number; stroke?: number; className?: string; style?: React.CSSProperties; title?: string }) {
  const d = P[name] ?? P.panel!;
  const fill = FILLED.has(name);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ flexShrink: 0, ...style }} aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <path d={d} />
    </svg>
  );
}

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
