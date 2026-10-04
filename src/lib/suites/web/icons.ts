/**
 * Icons for generated websites: drawn, never typed.
 *
 * An emoji or a symbol character (→ ✓ ★ ☰) used as an icon looks different on every phone, can turn into an empty box on an
 * old one, and cannot be coloured with the page. So the model writes `<svg class="icon"><use href="#i-menu"></use></svg>` and this
 * file supplies the drawing: it adds the matching <symbol> definitions and a base style to the page, and swaps any emoji
 * that slipped into the text for the nearest icon. Nothing here costs the model a token for the paths.
 *
 * Every icon is on a 24×24 grid, stroked with currentColor, so it takes the colour and size of the text around it.
 */

const c = (cx: number, cy: number, r: number) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
const r = (x: number, y: number, w: number, h: number, rx = 2) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>`;

export const ICONS: Record<string, string> = {
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  search: `${c(11, 11, 6.5)}<path d="M16 16l4.5 4.5"/>`,
  'arrow-right': '<path d="M5 12h14M13 6l6 6-6 6"/>',
  'arrow-left': '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  'arrow-up': '<path d="M12 19V5M6 11l6-6 6 6"/>',
  'arrow-down': '<path d="M12 5v14M6 13l6 6 6-6"/>',
  'chevron-right': '<path d="M9 6l6 6-6 6"/>',
  'chevron-left': '<path d="M15 6l-6 6 6 6"/>',
  'chevron-down': '<path d="M6 9l6 6 6-6"/>',
  'chevron-up': '<path d="M6 15l6-6 6 6"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 17l-5.2 2.7 1-5.9L3.5 9.7l5.9-.8z"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20z"/>',
  home: '<path d="M4 11l8-7 8 7M6 10v10h12V10M10 20v-6h4v6"/>',
  user: `${c(12, 8, 4)}<path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>`,
  users: `${c(9, 8, 3.5)}<path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.8a3.5 3.5 0 0 1 0 6.4M17.5 14.3c2.4.6 4 2.5 4 5.7"/>`,
  mail: `${r(3, 5, 18, 14)}<path d="M3.5 7l8.5 6 8.5-6"/>`,
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  'map-pin': `<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/>${c(12, 10, 2.4)}`,
  clock: `${c(12, 12, 8.5)}<path d="M12 7v5l3 2"/>`,
  calendar: `${r(4, 5, 16, 15)}<path d="M4 10h16M8 3v4M16 3v4"/>`,
  play: '<path d="M8 5l11 7-11 7z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 16V5M7 9l5-5 5 5M5 20h14"/>',
  'external-link': '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>',
  globe: `${c(12, 12, 8.5)}<path d="M3.5 12h17M12 3.5c3 3.2 3 13.8 0 17M12 3.5c-3 3.2-3 13.8 0 17"/>`,
  sun: `${c(12, 12, 4)}<path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>`,
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z"/>',
  rocket: `<path d="M12 3c3.5 2 5.5 5.5 5.5 9.5L15 15H9l-2.5-2.5C6.5 8.5 8.5 5 12 3z"/>${c(12, 10, 1.6)}<path d="M9 15l-2 4 3-1M15 15l2 4-3-1"/>`,
  zap: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
  shield: '<path d="M12 3l7 3v5.5c0 4.3-3 8-7 9.5-4-1.5-7-5.2-7-9.5V6z"/>',
  lock: `${r(5, 11, 14, 9)}<path d="M8 11V8a4 4 0 0 1 8 0v3"/>`,
  settings: `${c(12, 12, 3)}<path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>`,
  code: '<path d="M8 8l-5 4 5 4M16 8l5 4-5 4M14 5l-4 14"/>',
  cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  image: `${r(3.5, 4.5, 17, 15)}${c(9, 10, 1.6)}<path d="M4 18l5-5 4 4 3-3 4 4"/>`,
  camera: `<path d="M4 8h3l1.5-2.5h7L17 8h3v11H4z"/>${c(12, 13, 3.5)}`,
  video: `${r(3, 6, 13, 12)}<path d="M16 10l5-3v10l-5-3z"/>`,
  music: `<path d="M9 18V6l10-2v12"/>${c(7, 18, 2.5)}${c(17, 16, 2.5)}`,
  mic: `${r(9, 3, 6, 11, 3)}<path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>`,
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  bell: '<path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15zM10 21h4"/>',
  cart: `${c(9, 20, 1.5)}${c(17, 20, 1.5)}<path d="M3 4h2.5l2.2 11h10l2-8H6.5"/>`,
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  edit: '<path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19z"/>',
  copy: `${r(8, 8, 12, 12)}<path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>`,
  eye: `<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/>${c(12, 12, 3)}`,
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
  flame: '<path d="M12 21c-3.9 0-6.5-2.7-6.5-6.2 0-3 2-4.8 3.2-6.8.8 1 1 2 1 2.6C11.200 8 11.500 5.500 12.500 3c3 2.500 6 6 6 11.500C18.500 18.500 16 21 12 21z"/>',
  leaf: '<path d="M5 19c0-8 5-14 15-14 0 9-5 14-13 14M5 19c2-4 5-7 9-9"/>',
  trophy: '<path d="M8 4h8v6a4 4 0 0 1-8 0zM8 6H4.5c0 3 1.500 4.500 3.500 4.500M16 6h3.500c0 3-1.500 4.500-3.500 4.500M12 14v4M8.500 20h7"/>',
  target: `${c(12, 12, 8.5)}${c(12, 12, 4.5)}${c(12, 12, 1)}`,
  compass: `${c(12, 12, 8.5)}<path d="M15.500 8.500l-2 5-5 2 2-5z"/>`,
  gift: `${r(4, 9, 16, 11)}<path d="M3 9h18v3H3zM12 9v11M12 9c-1.500-4-5.500-4-5.500-1.500S10 9 12 9zM12 9c1.500-4 5.500-4 5.500-1.500S14 9 12 9z"/>`,
  coffee: '<path d="M5 9h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4zM16 10h1.500a2.500 2.500 0 0 1 0 5H16M8 3v3M12 3v3"/>',
  lightbulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.500 10.900c.7.5 1 1.200 1 2.100h5c0-.9.300-1.600 1-2.100A6 6 0 0 0 12 3z"/>',
  cloud: '<path d="M7 18a4.500 4.500 0 0 1-.5-9A6 6 0 0 1 18 10a4 4 0 0 1-.5 8z"/>',
  database: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.700 3.100 3 7 3s7-1.300 7-3V6M5 12c0 1.700 3.100 3 7 3s7-1.300 7-3"/>',
  cpu: `${r(6, 6, 12, 12)}${r(9.500, 9.500, 5, 5, 1)}<path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>`,
  wifi: '<path d="M3 9a14 14 0 0 1 18 0M6 12.500a9.500 9.500 0 0 1 12 0M9 16a5 5 0 0 1 6 0"/><circle cx="12" cy="19" r=".6"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  info: `${c(12, 12, 8.5)}<path d="M12 11v5M12 8v.1"/>`,
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.1"/>',
  x: '<path d="M4 4l16 16M20 4L4 20"/>',
  instagram: `${r(4, 4, 16, 16, 5)}${c(12, 12, 3.8)}<circle cx="17" cy="7" r=".6"/>`,
  youtube: `${r(3, 6, 18, 12, 4)}<path d="M10.500 9.500l4 2.500-4 2.500z"/>`,
  linkedin: `${r(4, 4, 16, 16, 2)}<path d="M8 10.500V16M8 7.800v.1M11.500 16v-5.500M11.500 13c0-1.500 1-2.500 2.500-2.500s2 1 2 2.500V16"/>`,
  facebook: '<path d="M14.500 21v-8h2.500l.5-3h-3V8.500c0-1 .5-1.500 1.500-1.500H17.500V4.300C17 4.200 16 4 15 4c-2.200 0-3.500 1.300-3.500 3.600V10H9v3h2.500v8"/>',
  github: '<path d="M9 19c-4 1.200-4-2-6-2.500M15 21v-3.200c0-1 .1-1.500-.5-2.200 2.800-.3 5.500-1.400 5.500-6 0-1.300-.5-2.400-1.300-3.300.1-.3.600-1.600-.1-3.300 0 0-1.100-.3-3.400 1.300a11.600 11.600 0 0 0-6.200 0C6.600 3.700 5.500 4 5.500 4c-.7 1.700-.2 3-.1 3.300A4.800 4.800 0 0 0 4 10.600c0 4.600 2.700 5.700 5.500 6-.6.600-.6 1.200-.5 2.200V21"/>',
  dot: `${c(12, 12, 3)}`,
};

export const ICON_NAMES = Object.keys(ICONS);

/** Emoji and symbols that mean one of the icons above. Anything not listed becomes the sparkle. */
const SYMBOL_TO_ICON: Record<string, string> = {
  '🚀': 'rocket', '⚡': 'zap', '✨': 'sparkle', '💫': 'sparkle', '⭐': 'star', '🌟': 'star', '★': 'star', '☆': 'star',
  '❤': 'heart', '💖': 'heart', '💙': 'heart', '💜': 'heart', '🧡': 'heart', '✅': 'check', '✔': 'check', '☑': 'check', '✓': 'check',
  '❌': 'close', '✖': 'close', '✕': 'close', '✗': 'close', '✘': 'close', '➕': 'plus', '➖': 'minus', '🔍': 'search', '🔎': 'search',
  '🏠': 'home', '👤': 'user', '👥': 'users', '📧': 'mail', '✉': 'mail', '📞': 'phone', '📱': 'phone', '☎': 'phone', '📍': 'map-pin',
  '⏰': 'clock', '🕒': 'clock', '⏱': 'clock', '📅': 'calendar', '🗓': 'calendar', '▶': 'play', '⏸': 'pause', '⬇': 'download', '📥': 'download',
  '⬆': 'upload', '📤': 'upload', '🔗': 'link', '🌐': 'globe', '🌍': 'globe', '🌎': 'globe', '🌏': 'globe', '☀': 'sun', '🌞': 'sun',
  '🌙': 'moon', '🔒': 'lock', '🔐': 'lock', '🛡': 'shield', '⚙': 'settings', '🔧': 'settings', '🛠': 'settings', '💻': 'code', '🖥': 'code',
  '🧊': 'cube', '📦': 'cube', '🖼': 'image', '📷': 'camera', '📸': 'camera', '🎥': 'video', '🎬': 'video', '🎵': 'music', '🎶': 'music',
  '🎤': 'mic', '💬': 'chat', '🗨': 'chat', '🔔': 'bell', '🛒': 'cart', '🗑': 'trash', '✏': 'edit', '📝': 'edit', '📋': 'copy', '👁': 'eye',
  '🔥': 'flame', '🍃': 'leaf', '🌿': 'leaf', '🌱': 'leaf', '🏆': 'trophy', '🥇': 'trophy', '🎯': 'target', '🧭': 'compass', '🎁': 'gift',
  '☕': 'coffee', '💡': 'lightbulb', '☁': 'cloud', '🗄': 'database', '🧠': 'cpu', '📶': 'wifi', '🚩': 'flag', 'ℹ': 'info', '⚠': 'alert',
  '→': 'arrow-right', '➡': 'arrow-right', '➜': 'arrow-right', '⟶': 'arrow-right', '←': 'arrow-left', '⬅': 'arrow-left', '↑': 'arrow-up', '↓': 'arrow-down',
  '▸': 'chevron-right', '›': 'chevron-right', '‹': 'chevron-left', '▾': 'chevron-down', '☰': 'menu', '≡': 'menu',
};

// Plain symbol characters (arrows, ticks, stars) that are not emoji, so they need listing; emoji are matched by their Unicode property.
const PLAIN_SYMBOLS = Object.keys(SYMBOL_TO_ICON).filter((k) => k.length === 1 && !/\p{Extended_Pictographic}/u.test(k)).join('');
const SYMBOLS = new RegExp(
  `(?:(?![\\u00A9\\u00AE\\u2122])\\p{Extended_Pictographic}(?:\\uFE0F|\\u20E3|\\p{Emoji_Modifier}|\\u200D\\p{Extended_Pictographic})*)|[${PLAIN_SYMBOLS}]`,
  'gu',
);

const useTag = (name: string) => `<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`;
const iconFor = (symbol: string) => SYMBOL_TO_ICON[symbol.replace(/[️⃣]/gu, '').replace(/\p{Emoji_Modifier}/gu, '')] ?? SYMBOL_TO_ICON[[...symbol][0] ?? ''] ?? 'sparkle';

/** Text between tags only: attributes, scripts, styles, existing SVG, titles and comments are never touched. */
const SKIP = /(<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>|<title[\s\S]*?<\/title>|<textarea[\s\S]*?<\/textarea>|<!--[\s\S]*?-->|<[^>]+>)/gi;

export function replaceSymbolsWithIcons(html: string): { html: string; count: number } {
  let count = 0;
  const out = html
    .split(SKIP)
    .map((part) => {
      if (!part || part.startsWith('<')) return part;
      return part.replace(SYMBOLS, (m) => { count += 1; return useTag(iconFor(m)); });
    })
    .join('');
  return { html: out, count };
}

const BASE_STYLE = '<style id="icon-base">.icon{width:1.25em;height:1.25em;flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;vertical-align:-.22em}</style>';

/** Adds the <symbol> drawings for every `#i-name` the page uses, plus the base style, unless the page already has them. */
export function addIconSprite(html: string): { html: string; added: string[]; unknown: string[] } {
  const used = [...new Set([...html.matchAll(/href=["']#i-([a-z0-9-]+)["']/gi)].map((m) => m[1].toLowerCase()))];
  const defined = new Set([...html.matchAll(/\bid=["']i-([a-z0-9-]+)["']/gi)].map((m) => m[1].toLowerCase()));
  const wanted = used.filter((n) => !defined.has(n));
  const added = wanted.filter((n) => ICONS[n]);
  const unknown = wanted.filter((n) => !ICONS[n]);
  if (!used.length) return { html, added: [], unknown: [] };

  let out = html;
  if (added.length) {
    const sprite = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">${added
      .map((n) => `<symbol id="i-${n}" viewBox="0 0 24 24">${ICONS[n]}</symbol>`)
      .join('')}</svg>`;
    out = /<body[^>]*>/i.test(out) ? out.replace(/<body[^>]*>/i, (m) => `${m}\n${sprite}`) : `${sprite}\n${out}`;
  }
  if (!/\.icon\s*\{/.test(out)) {
    out = /<\/head>/i.test(out) ? out.replace(/<\/head>/i, `${BASE_STYLE}\n</head>`) : `${BASE_STYLE}\n${out}`;
  }
  return { html: out, added, unknown };
}

/**
 * Makes a generated site's pages icon-clean: symbols in the text become drawn icons, and every icon the page uses gets its drawing.
 * Only .html files are touched.
 */
export function prepareSiteIcons<T extends { path: string; content: string }>(files: T[]): { files: T[]; replaced: number; added: string[]; unknown: string[] } {
  let replaced = 0;
  const added = new Set<string>();
  const unknown = new Set<string>();
  const out = files.map((f) => {
    if (!/\.html?$/i.test(f.path) || typeof f.content !== 'string') return f;
    const swapped = replaceSymbolsWithIcons(f.content);
    replaced += swapped.count;
    const sprited = addIconSprite(swapped.html);
    sprited.added.forEach((n) => added.add(n));
    sprited.unknown.forEach((n) => unknown.add(n));
    return sprited.html === f.content ? f : { ...f, content: sprited.html };
  });
  return { files: out, replaced, added: [...added], unknown: [...unknown] };
}
