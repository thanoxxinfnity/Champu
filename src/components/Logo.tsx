/**
 * Chomugiri identity — inked, not printed.
 *
 * A pen-drawn ring that overshoots where it closes, with a terminal prompt
 * inside it: the chevron read as a cut, and the cursor bar where a shell would
 * put it. "giri" is a cut and the product is a CLI, so one shape says both.
 *
 * Every path is a curve with a slight waver rather than a straight segment — a
 * mathematically straight line is the single thing that gives a "hand-drawn"
 * mark away. Strokes, not fills, so it survives 16px in a browser tab.
 */

export const LOGO_PATHS = {
  /**
   * The pen ring, on a 32×32 grid. Deliberately not closed: it starts at the
   * top-right, comes all the way round and overshoots past its own start, the
   * way a circle drawn in one motion actually does.
   */
  ring:
    'M22.4 4.7 C28.6 8.1 30.7 17.9 26.2 24.2 C21.8 30.4 11.4 30.9 6 25.7 C0.7 20.6 1.6 10.3 8.2 5.7 C12.2 2.9 18.4 2.6 23.6 6.2',
  /** Chevron — two strokes that bow slightly, as a wrist does. */
  chevron: 'M11.2 10.4 C13.6 12.2 16.2 14.1 18.4 16.1 C16.3 18.2 13.7 20 11.4 21.9',
  /** Cursor bar, drawn with a wobble so it does not read as a rule. */
  bar: 'M20.6 21.8 C21.8 22.3 23.4 21.7 24.8 22.2',
} as const;

export const BRAND = {
  /** The one colour the identity carries. Matches --color-orange. */
  orange: '#EA580C',
  orangeBright: '#FB923C',
} as const;

export function LogoMark({
  size = 32,
  /** Kept for callers that used the old tiled mark; the ink mark needs no tile. */
  rounded = true,
  id = 'chomu',
  className,
}: {
  size?: number;
  rounded?: boolean;
  id?: string;
  className?: string;
}) {
  const stroke = Math.max(1.9, size * 0.072);

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
        <linearGradient id={`${id}-ink`} x1="4" y1="4" x2="28" y2="28">
          <stop offset="0%" stopColor={BRAND.orangeBright} />
          <stop offset="100%" stopColor={BRAND.orange} />
        </linearGradient>
      </defs>

      {/* A wash inside the ring, so the mark still reads as a badge at a glance. */}
      {rounded && (
        <path
          d={LOGO_PATHS.ring}
          fill="var(--marker, rgba(234, 88, 12, 0.16))"
          stroke="none"
        />
      )}

      <path
        d={LOGO_PATHS.ring}
        stroke={`url(#${id}-ink)`}
        strokeWidth={stroke * 0.78}
        strokeLinecap="round"
        fill="none"
      />
      <path
        d={LOGO_PATHS.chevron}
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d={LOGO_PATHS.bar}
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export function LogoWordmark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <span className={`flex items-center gap-2.5 ${className ?? ''}`} style={{ color: 'var(--ink)' }}>
      <LogoMark size={size * 1.7} id="chomu-word" />
      <span className="flex flex-col leading-none">
        {/* The product name is the app's own voice, so it is handwritten. */}
        <span className="hand" style={{ fontSize: size * 1.15, lineHeight: 0.95 }}>
          Chomugiri
        </span>
        <span
          className="mono uppercase"
          style={{ fontSize: size * 0.42, letterSpacing: '0.16em', color: 'var(--ink-faint)', marginTop: 3 }}
        >
          autonomous workspace
        </span>
      </span>
    </span>
  );
}

/**
 * Standalone SVG for the favicon and anywhere outside React.
 * Colours are literal here — there is no cascade to inherit from.
 */
export function logoSvgMarkup(size = 32): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none">
  <defs>
    <linearGradient id="i" x1="4" y1="4" x2="28" y2="28"><stop offset="0%" stop-color="${BRAND.orangeBright}"/><stop offset="100%" stop-color="${BRAND.orange}"/></linearGradient>
  </defs>
  <path d="${LOGO_PATHS.ring}" fill="${BRAND.orange}" fill-opacity=".14"/>
  <path d="${LOGO_PATHS.ring}" stroke="url(#i)" stroke-width="1.9" stroke-linecap="round" fill="none"/>
  <path d="${LOGO_PATHS.chevron}" stroke="${BRAND.orange}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <path d="${LOGO_PATHS.bar}" stroke="${BRAND.orange}" stroke-width="2.4" stroke-linecap="round" fill="none"/>
</svg>`;
}
