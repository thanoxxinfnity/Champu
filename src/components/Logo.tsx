/**
 * Chomugiri identity.
 *
 * The mark is a terminal prompt read as a cut: a chevron whose strokes taper
 * like a blade, with the cursor bar sitting where a shell would put it. "giri"
 * is a cut, and the product is a CLI — one shape says both.
 *
 * Built from strokes rather than a filled glyph so it stays legible at 16px in a
 * browser tab, which is where most marks fall apart.
 */

export const LOGO_PATHS = {
  /** Chevron, on a 32×32 grid. */
  chevron: 'M11 9.5 L18.5 16 L11 22.5',
  /** Cursor bar. */
  bar: 'M21.5 22.5 L25 22.5',
  /** The cut — a hairline sweeping across the mark. */
  cut: 'M24.5 7 L14 26',
} as const;

export const BRAND = {
  emerald: '#10B981',
  indigo: '#6366F1',
  void: '#09090B',
} as const;

export function LogoMark({
  size = 32,
  rounded = true,
  id = 'chomu',
  className,
}: {
  size?: number;
  /** Draw the dark tile behind the mark. Off for monochrome contexts. */
  rounded?: boolean;
  /** Unique per instance — gradient ids collide across inlined SVGs otherwise. */
  id?: string;
  className?: string;
}) {
  const stroke = Math.max(2.2, size * 0.082);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      role="img"
      aria-label="Chomugiri"
    >
      <defs>
        <linearGradient id={`${id}-tile`} x1="0" y1="0" x2="32" y2="32">
          <stop offset="0%" stopColor="#141418" />
          <stop offset="100%" stopColor="#0B0B0E" />
        </linearGradient>
        <linearGradient id={`${id}-stroke`} x1="8" y1="8" x2="26" y2="24">
          <stop offset="0%" stopColor={BRAND.emerald} />
          <stop offset="100%" stopColor="#34D399" />
        </linearGradient>
        <linearGradient id={`${id}-cut`} x1="24" y1="7" x2="14" y2="26">
          <stop offset="0%" stopColor={BRAND.indigo} stopOpacity="0" />
          <stop offset="45%" stopColor={BRAND.indigo} stopOpacity="0.95" />
          <stop offset="100%" stopColor={BRAND.indigo} stopOpacity="0" />
        </linearGradient>
      </defs>

      {rounded && (
        <>
          <rect width="32" height="32" rx="8.5" fill={`url(#${id}-tile)`} />
          <rect
            x="0.6"
            y="0.6"
            width="30.8"
            height="30.8"
            rx="8"
            fill="none"
            stroke={BRAND.emerald}
            strokeOpacity="0.15"
            strokeWidth="1"
          />
        </>
      )}

      {/* Drawn under the chevron so the cut reads as passing behind it. */}
      <path d={LOGO_PATHS.cut} stroke={`url(#${id}-cut)`} strokeWidth={stroke * 0.5} strokeLinecap="round" />

      <path
        d={LOGO_PATHS.chevron}
        stroke={`url(#${id}-stroke)`}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d={LOGO_PATHS.bar} stroke={BRAND.emerald} strokeWidth={stroke} strokeLinecap="round" />
    </svg>
  );
}

export function LogoWordmark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <span className={`flex items-center gap-2.5 ${className ?? ''}`}>
      <LogoMark size={size * 1.6} id="chomu-word" />
      <span className="flex flex-col leading-none">
        <span
          className="font-semibold tracking-tight"
          style={{ fontSize: size * 0.72, letterSpacing: '-0.02em' }}
        >
          Chomugiri
        </span>
        <span
          className="mono uppercase"
          style={{ fontSize: size * 0.44, letterSpacing: '0.16em', color: 'var(--ink-faint)', marginTop: 2 }}
        >
          autonomous workspace
        </span>
      </span>
    </span>
  );
}

/** Standalone SVG, for the favicon and anywhere outside React. */
export function logoSvgMarkup(size = 32): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none">
  <defs>
    <linearGradient id="t" x1="0" y1="0" x2="32" y2="32"><stop offset="0%" stop-color="#141418"/><stop offset="100%" stop-color="#0B0B0E"/></linearGradient>
    <linearGradient id="s" x1="8" y1="8" x2="26" y2="24"><stop offset="0%" stop-color="${BRAND.emerald}"/><stop offset="100%" stop-color="#34D399"/></linearGradient>
    <linearGradient id="c" x1="24" y1="7" x2="14" y2="26"><stop offset="0%" stop-color="${BRAND.indigo}" stop-opacity="0"/><stop offset="45%" stop-color="${BRAND.indigo}" stop-opacity=".95"/><stop offset="100%" stop-color="${BRAND.indigo}" stop-opacity="0"/></linearGradient>
  </defs>
  <rect width="32" height="32" rx="8.5" fill="url(#t)"/>
  <rect x=".6" y=".6" width="30.8" height="30.8" rx="8" fill="none" stroke="${BRAND.emerald}" stroke-opacity=".15" stroke-width="1"/>
  <path d="${LOGO_PATHS.cut}" stroke="url(#c)" stroke-width="1.3" stroke-linecap="round"/>
  <path d="${LOGO_PATHS.chevron}" stroke="url(#s)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${LOGO_PATHS.bar}" stroke="${BRAND.emerald}" stroke-width="2.6" stroke-linecap="round"/>
</svg>`;
}
