/**
 * Skill icons: a fixed set of drawn line icons, never emoji.
 *
 * A skill stores an icon *name*. Skills saved before this stored an emoji, and a model asked for "an icon" still
 * sometimes answers with one, so every value goes through `iconKey`, which turns a known emoji into its drawn
 * equivalent and anything else into the default.
 */
const P: Record<string, string> = {
  spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M18.5 16l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  convert: '<path d="M4 9h13l-3-3M20 15H7l3 3"/>',
  cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
  palette: '<path d="M12 3a9 9 0 100 18c1.4 0 2-1 1.5-2.2-.5-1.2.2-2.3 1.5-2.3H17a4 4 0 004-4c0-5-4-9.5-9-9.5z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="14.5" cy="7" r="1"/>',
  books: '<path d="M5 4v16M9 4v16M13.5 5.5l4 14M20 4.5l-3.2.9"/>',
  blocks: '<rect x="3" y="12" width="8" height="8" rx="1"/><rect x="13" y="12" width="8" height="8" rx="1"/><rect x="8" y="4" width="8" height="8" rx="1"/>',
  coffee: '<path d="M5 9h11v5a5 5 0 01-5 5h-1a5 5 0 01-5-5z"/><path d="M16 10h1.5a2.5 2.5 0 010 5H16M8 3v3M12 3v3"/>',
  gamepad: '<rect x="3" y="7" width="18" height="11" rx="5"/><path d="M8 10.5v4M6 12.5h4M15.5 11.5h.01M18 13.5h.01"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12.5 16V8M17 16v-6"/>',
  trend: '<path d="M3 17l6-6 4 4 8-9"/><path d="M15 6h6v6"/>',
  doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  rocket: '<path d="M12 3c3.5 2 5 5.5 4.3 10h-8.6C7 8.5 8.5 5 12 3z"/><circle cx="12" cy="9" r="1.5"/><path d="M8 13l-2.5 4 3-.5M16 13l2.5 4-3-.5M12 15v4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0012 3z"/>',
  wand: '<path d="M5 19L16 8M14 6l1-3 1 3 3 1-3 1-1 3-1-3-3-1zM5 5l.6 1.4L7 7l-1.4.6L5 9l-.6-1.4L3 7l1.4-.6z"/>',
  scales: '<path d="M12 4v16M7 20h10M5 7h14"/><path d="M5 7l-3 7a3.5 3.5 0 006 0zM19 7l-3 7a3.5 3.5 0 006 0z"/>',
  coins: '<ellipse cx="9" cy="8" rx="5.5" ry="2.5"/><path d="M3.5 8v4c0 1.4 2.5 2.5 5.5 2.5M3.5 12v4c0 1.4 2.5 2.5 5.5 2.5"/><ellipse cx="16" cy="14" rx="5" ry="2.3"/><path d="M11 14v3.5c0 1.3 2.2 2.3 5 2.3s5-1 5-2.3V14"/>',
  brain: '<path d="M9 4a3 3 0 00-3 3 3 3 0 00-2 5 3 3 0 002 5 3 3 0 003 3 2 2 0 002-2V6a2 2 0 00-2-2zM15 4a3 3 0 013 3 3 3 0 012 5 3 3 0 01-2 5 3 3 0 01-3 3 2 2 0 01-2-2V6a2 2 0 012-2z"/>',
  news: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 11l5-3v8l-5-3z"/>',
  wrench: '<path d="M14.5 6.5a4 4 0 005 5L12 19a2.8 2.8 0 01-4-4z"/><path d="M14.5 6.5a4 4 0 00-5-5l2.5 2.5-1 2-2 1z"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.2 7.7-8 9-4.8-1.3-8-4.5-8-9V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  code: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 10l3 2-3 2M12.5 15h4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.7"/><path d="M4 18l5-5 4 4 3-3 4 4"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  bug: '<rect x="8" y="8" width="8" height="11" rx="4"/><path d="M12 8V5M9 5l1.5 2M15 5l-1.5 2M4 12h4M16 12h4M5 18l3-2M19 18l-3-2M5 7l3 2M19 7l-3 2"/>',
  flask: '<path d="M9 3h6M10 3v6l-5.5 9.5A1.5 1.5 0 005.8 21h12.4a1.5 1.5 0 001.3-2.5L14 9V3"/><path d="M7.5 15h9"/>',
  pen: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19z"/><path d="M14.5 6.5l3 3"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  package: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5L12 12l8-4.5M12 12v9M8 5.2l8 4.6"/>',
  plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 01-12 0zM12 17v4"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  leaf: '<path d="M5 19C5 10 10 5 20 4c0 10-5 15-14 15z"/><path d="M5 19L14 10"/>',
  triangle: '<path d="M12 4l9 16H3z"/>',
};

export const SKILL_ICON_NAMES = Object.keys(P);

const FROM_EMOJI: Record<string, string> = {
  '📱': 'phone', '🔄': 'convert', '🧊': 'cube', '🎨': 'palette', '📚': 'books', '🧱': 'blocks', '☕': 'coffee', '🎮': 'gamepad',
  '📊': 'chart', '📈': 'trend', '📄': 'doc', '🚀': 'rocket', '🔍': 'search', '🔎': 'search', '💡': 'bulb', '✨': 'wand', '⚖️': 'scales', '⚖': 'scales',
  '💸': 'coins', '💰': 'coins', '🧠': 'brain', '📰': 'news', '🎬': 'video', '🛠': 'wrench', '🔧': 'wrench', '🔒': 'lock', '🛡': 'shield', '💻': 'code',
  '🌐': 'globe', '🖼': 'image', '🎵': 'music', '🐞': 'bug', '🐛': 'bug', '🧪': 'flask', '🔬': 'flask', '✍️': 'pen', '📦': 'package', '🔌': 'plug', '💬': 'chat',
  '🌿': 'leaf', '▲': 'triangle', '✦': 'spark', '⌘': 'terminal', '⚡': 'spark',
};

/** Any stored value (a name, an old emoji, nothing) → a name that has a drawing. */
export function iconKey(value: string | undefined | null): string {
  const v = (value ?? '').trim();
  if (v in P) return v;
  return FROM_EMOJI[v] ?? FROM_EMOJI[v.replace(/️/g, '')] ?? 'spark';
}

/** The inner SVG markup of a 24×24 line icon. */
export function iconPaths(value: string | undefined | null): string {
  return P[iconKey(value)]!;
}

/** A whole <svg> string, for places that build HTML (chat notes). */
export function iconSvg(value: string | undefined | null, size = 15): string {
  return `<svg class="ico" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths(value)}</svg>`;
}
