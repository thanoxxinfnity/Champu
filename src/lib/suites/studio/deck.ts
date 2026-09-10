/**
 * Presentation & document studio.
 *
 * Decks are emitted as a single self-contained HTML file: no build step, no CDN,
 * opens offline, and prints to PDF through the browser's own engine — which
 * renders type and vector graphics better than any JS PDF library while adding
 * zero bytes of dependency.
 */

export type SlideLayout = 'title' | 'bullets' | 'split' | 'quote' | 'code' | 'image' | 'stats' | 'section' | 'end';

export interface Slide {
  layout: SlideLayout;
  title?: string;
  subtitle?: string;
  bullets?: string[];
  body?: string;
  code?: { language: string; source: string };
  image?: { src: string; alt: string; caption?: string };
  stats?: Array<{ value: string; label: string }>;
  notes?: string;
  /** Overrides the deck accent for this slide. */
  accent?: string;
}

export interface DeckTheme {
  background: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  accentAlt: string;
  border: string;
  fontHeading: string;
  fontBody: string;
  fontMono: string;
}

export const TERMINAL_THEME: DeckTheme = {
  background: '#09090b',
  surface: '#131316',
  text: '#fafafa',
  muted: '#a1a1aa',
  accent: '#10b981',
  accentAlt: '#6366f1',
  border: 'rgba(255, 255, 255, 0.08)',
  fontHeading: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
  fontBody: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
  fontMono: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
};

export const LIGHT_THEME: DeckTheme = {
  background: '#ffffff',
  surface: '#f4f4f5',
  text: '#09090b',
  muted: '#52525b',
  accent: '#059669',
  accentAlt: '#4f46e5',
  border: 'rgba(0, 0, 0, 0.1)',
  fontHeading: TERMINAL_THEME.fontHeading,
  fontBody: TERMINAL_THEME.fontBody,
  fontMono: TERMINAL_THEME.fontMono,
};

export interface DeckSpec {
  title: string;
  author?: string;
  date?: string;
  theme: DeckTheme;
  slides: Slide[];
  /** 16:9 by default; 4:3 for legacy projectors. */
  aspect?: '16:9' | '4:3';
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Minimal inline markdown: **bold**, *italic*, `code`, [text](url). */
function inline(s: string): string {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

function renderSlide(slide: Slide, index: number, total: number): string {
  const accentStyle = slide.accent ? ` style="--accent: ${escapeHtml(slide.accent)}"` : '';
  let body = '';

  switch (slide.layout) {
    case 'title':
      body = `
      <div class="stack center">
        <div class="eyebrow">${escapeHtml(slide.subtitle ?? '')}</div>
        <h1 class="display">${inline(slide.title ?? '')}</h1>
        ${slide.body ? `<p class="lede">${inline(slide.body)}</p>` : ''}
      </div>`;
      break;

    case 'section':
      body = `
      <div class="stack center">
        <div class="section-index">${String(index).padStart(2, '0')}</div>
        <h2 class="display">${inline(slide.title ?? '')}</h2>
        ${slide.subtitle ? `<p class="lede">${inline(slide.subtitle)}</p>` : ''}
      </div>`;
      break;

    case 'bullets':
      body = `
      <h2>${inline(slide.title ?? '')}</h2>
      ${slide.subtitle ? `<p class="subtitle">${inline(slide.subtitle)}</p>` : ''}
      <ul class="bullets">
${(slide.bullets ?? []).map((b, i) => `        <li style="--i: ${i}">${inline(b)}</li>`).join('\n')}
      </ul>`;
      break;

    case 'split':
      body = `
      <h2>${inline(slide.title ?? '')}</h2>
      <div class="split">
        <div class="split-pane">
          <ul class="bullets">
${(slide.bullets ?? []).map((b, i) => `            <li style="--i: ${i}">${inline(b)}</li>`).join('\n')}
          </ul>
        </div>
        <div class="split-pane">
          ${slide.image ? `<figure><img src="${escapeHtml(slide.image.src)}" alt="${escapeHtml(slide.image.alt)}">${slide.image.caption ? `<figcaption>${inline(slide.image.caption)}</figcaption>` : ''}</figure>` : `<div class="panel">${inline(slide.body ?? '')}</div>`}
        </div>
      </div>`;
      break;

    case 'quote':
      body = `
      <blockquote class="quote">
        <p>${inline(slide.body ?? '')}</p>
        ${slide.subtitle ? `<cite>${inline(slide.subtitle)}</cite>` : ''}
      </blockquote>`;
      break;

    case 'code':
      body = `
      <h2>${inline(slide.title ?? '')}</h2>
      ${slide.subtitle ? `<p class="subtitle">${inline(slide.subtitle)}</p>` : ''}
      <pre class="code"><code data-lang="${escapeHtml(slide.code?.language ?? 'text')}">${escapeHtml(slide.code?.source ?? '')}</code></pre>`;
      break;

    case 'image':
      body = `
      ${slide.title ? `<h2>${inline(slide.title)}</h2>` : ''}
      <figure class="full">
        <img src="${escapeHtml(slide.image?.src ?? '')}" alt="${escapeHtml(slide.image?.alt ?? '')}">
        ${slide.image?.caption ? `<figcaption>${inline(slide.image.caption)}</figcaption>` : ''}
      </figure>`;
      break;

    case 'stats':
      body = `
      <h2>${inline(slide.title ?? '')}</h2>
      ${slide.subtitle ? `<p class="subtitle">${inline(slide.subtitle)}</p>` : ''}
      <div class="stats">
${(slide.stats ?? [])
        .map(
          (s, i) => `        <div class="stat" style="--i: ${i}">
          <div class="stat-value">${inline(s.value)}</div>
          <div class="stat-label">${inline(s.label)}</div>
        </div>`,
        )
        .join('\n')}
      </div>`;
      break;

    case 'end':
      body = `
      <div class="stack center">
        <h2 class="display">${inline(slide.title ?? 'Thank you')}</h2>
        ${slide.body ? `<p class="lede">${inline(slide.body)}</p>` : ''}
      </div>`;
      break;
  }

  return `  <section class="slide layout-${slide.layout}" data-index="${index}"${accentStyle}>
    <div class="slide-inner">${body}
    </div>
    <footer class="slide-footer">
      <span class="footer-title"></span>
      <span class="footer-page">${index} / ${total}</span>
    </footer>
${slide.notes ? `    <aside class="notes">${escapeHtml(slide.notes)}</aside>` : ''}
  </section>`;
}

export function renderDeck(spec: DeckSpec): string {
  const { theme } = spec;
  const aspect = spec.aspect === '4:3' ? '4 / 3' : '16 / 9';
  const total = spec.slides.length;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(spec.title)}</title>
<style>
  :root {
    --bg: ${theme.background};
    --surface: ${theme.surface};
    --text: ${theme.text};
    --muted: ${theme.muted};
    --accent: ${theme.accent};
    --accent-alt: ${theme.accentAlt};
    --border: ${theme.border};
    --font-heading: ${theme.fontHeading};
    --font-body: ${theme.fontBody};
    --font-mono: ${theme.fontMono};
    --slide-w: 1280px;
  }

  * { box-sizing: border-box; }

  html, body {
    margin: 0;
    padding: 0;
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-body);
    -webkit-font-smoothing: antialiased;
    overflow: hidden;
  }

  .deck {
    position: relative;
    width: 100vw;
    height: 100vh;
    display: grid;
    place-items: center;
  }

  .slide {
    position: absolute;
    inset: 0;
    margin: auto;
    width: min(100vw, calc(100vh * ${aspect.replace(' / ', ' / ')}));
    aspect-ratio: ${aspect};
    max-height: 100vh;
    padding: clamp(32px, 5vh, 72px) clamp(40px, 6vw, 96px);
    display: flex;
    flex-direction: column;
    background: var(--bg);
    opacity: 0;
    visibility: hidden;
    transform: translateY(16px) scale(0.99);
    transition: opacity 380ms cubic-bezier(0.22, 1, 0.36, 1),
                transform 380ms cubic-bezier(0.22, 1, 0.36, 1),
                visibility 0s linear 380ms;
    container-type: inline-size;
  }

  .slide.active {
    opacity: 1;
    visibility: visible;
    transform: none;
    transition-delay: 0s;
    z-index: 2;
  }

  .slide.leaving {
    opacity: 0;
    transform: translateY(-12px) scale(0.99);
    z-index: 1;
  }

  .slide-inner {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: clamp(12px, 2vh, 24px);
    min-height: 0;
  }

  .stack { display: flex; flex-direction: column; gap: 16px; }
  .center { align-items: flex-start; justify-content: center; }

  h1, h2 {
    font-family: var(--font-heading);
    font-weight: 680;
    letter-spacing: -0.028em;
    line-height: 1.06;
    margin: 0;
  }

  h1 { font-size: clamp(40px, 7cqi, 84px); }
  h2 { font-size: clamp(30px, 5cqi, 58px); }

  .display {
    background: linear-gradient(100deg, var(--text) 20%, var(--accent) 130%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }

  .eyebrow {
    font-family: var(--font-mono);
    font-size: clamp(11px, 1.2cqi, 14px);
    text-transform: uppercase;
    letter-spacing: 0.22em;
    color: var(--accent);
  }

  .section-index {
    font-family: var(--font-mono);
    font-size: clamp(48px, 9cqi, 120px);
    font-weight: 700;
    line-height: 1;
    color: var(--accent);
    opacity: 0.22;
  }

  .lede {
    font-size: clamp(16px, 2cqi, 24px);
    line-height: 1.5;
    color: var(--muted);
    max-width: 46ch;
    margin: 0;
  }

  .subtitle {
    font-size: clamp(14px, 1.5cqi, 19px);
    color: var(--muted);
    margin: 0;
  }

  .bullets {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: clamp(8px, 1.4vh, 18px);
  }

  .bullets li {
    position: relative;
    padding-left: 32px;
    font-size: clamp(15px, 1.85cqi, 23px);
    line-height: 1.45;
    opacity: 0;
    transform: translateX(-10px);
  }

  .slide.active .bullets li {
    animation: reveal 460ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
    animation-delay: calc(120ms + var(--i) * 70ms);
  }

  .bullets li::before {
    content: '';
    position: absolute;
    left: 4px;
    top: 0.62em;
    width: 12px;
    height: 2px;
    background: var(--accent);
    border-radius: 2px;
  }

  @keyframes reveal {
    to { opacity: 1; transform: none; }
  }

  .split {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: clamp(20px, 3cqi, 48px);
    align-items: center;
    min-height: 0;
  }

  .split-pane { min-width: 0; }

  .panel {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: clamp(16px, 2cqi, 28px);
    font-size: clamp(14px, 1.6cqi, 19px);
    line-height: 1.5;
    color: var(--muted);
  }

  figure { margin: 0; }
  figure.full { flex: 1; display: flex; flex-direction: column; min-height: 0; }

  figure img {
    width: 100%;
    height: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: 12px;
    border: 1px solid var(--border);
  }

  figcaption {
    margin-top: 10px;
    font-size: clamp(11px, 1.2cqi, 14px);
    color: var(--muted);
    font-family: var(--font-mono);
  }

  .quote {
    margin: 0;
    border-left: 3px solid var(--accent);
    padding-left: clamp(20px, 3cqi, 40px);
  }

  .quote p {
    font-size: clamp(22px, 3.4cqi, 44px);
    line-height: 1.24;
    font-weight: 560;
    letter-spacing: -0.02em;
    margin: 0 0 20px;
  }

  .quote cite {
    font-style: normal;
    font-family: var(--font-mono);
    font-size: clamp(12px, 1.3cqi, 16px);
    color: var(--accent);
  }

  .code {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: clamp(16px, 2cqi, 26px);
    overflow: auto;
    margin: 0;
    min-height: 0;
    flex: 1;
  }

  .code code {
    font-family: var(--font-mono);
    font-size: clamp(11px, 1.35cqi, 17px);
    line-height: 1.6;
    white-space: pre;
    color: var(--text);
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: clamp(14px, 2cqi, 28px);
  }

  .stat {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: clamp(16px, 2.2cqi, 30px);
    opacity: 0;
    transform: translateY(12px);
  }

  .slide.active .stat {
    animation: reveal 500ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
    animation-delay: calc(140ms + var(--i) * 90ms);
  }

  .stat-value {
    font-family: var(--font-heading);
    font-size: clamp(30px, 4.6cqi, 58px);
    font-weight: 700;
    letter-spacing: -0.03em;
    color: var(--accent);
    line-height: 1;
  }

  .stat-label {
    margin-top: 8px;
    font-size: clamp(12px, 1.3cqi, 16px);
    color: var(--muted);
  }

  .slide-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: 16px;
    border-top: 1px solid var(--border);
    font-family: var(--font-mono);
    font-size: clamp(10px, 1.05cqi, 13px);
    color: var(--muted);
  }

  .layout-title .slide-footer,
  .layout-end .slide-footer { opacity: 0; }

  .notes { display: none; }

  .progress {
    position: fixed;
    left: 0;
    bottom: 0;
    height: 2px;
    background: linear-gradient(90deg, var(--accent), var(--accent-alt));
    transition: width 340ms cubic-bezier(0.22, 1, 0.36, 1);
    z-index: 10;
  }

  .hint {
    position: fixed;
    right: 16px;
    bottom: 14px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--muted);
    opacity: 0.5;
    z-index: 10;
    transition: opacity 400ms;
  }

  .hint.hidden { opacity: 0; }

  a { color: var(--accent); }
  code { font-family: var(--font-mono); font-size: 0.92em; }

  /* Print → PDF. One slide per page, animations neutralised. */
  @page {
    size: ${spec.aspect === '4:3' ? '1024px 768px' : '1280px 720px'};
    margin: 0;
  }

  @media print {
    html, body { overflow: visible; height: auto; background: var(--bg); }
    .deck { display: block; width: auto; height: auto; }
    .progress, .hint { display: none !important; }

    .slide {
      position: relative !important;
      inset: auto !important;
      opacity: 1 !important;
      visibility: visible !important;
      transform: none !important;
      transition: none !important;
      width: 100% !important;
      max-height: none !important;
      height: ${spec.aspect === '4:3' ? '768px' : '720px'};
      break-after: page;
      page-break-after: always;
    }

    .slide:last-child { break-after: auto; page-break-after: auto; }

    .bullets li, .stat {
      opacity: 1 !important;
      transform: none !important;
      animation: none !important;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .slide, .bullets li, .stat, .progress { transition: none !important; animation: none !important; }
    .bullets li, .stat { opacity: 1; transform: none; }
  }
</style>
</head>
<body>
<div class="deck" id="deck">
${spec.slides.map((s, i) => renderSlide(s, i + 1, total)).join('\n')}
</div>
<div class="progress" id="progress"></div>
<div class="hint" id="hint">← → navigate · F fullscreen · P print</div>

<script>
(function () {
  'use strict';

  var slides = Array.prototype.slice.call(document.querySelectorAll('.slide'));
  var progress = document.getElementById('progress');
  var hint = document.getElementById('hint');
  var deckTitle = ${JSON.stringify(spec.title)};
  var current = 0;

  Array.prototype.forEach.call(document.querySelectorAll('.footer-title'), function (el) {
    el.textContent = deckTitle;
  });

  function show(next, immediate) {
    next = Math.max(0, Math.min(next, slides.length - 1));
    if (next === current && !immediate) return;

    var previous = slides[current];
    if (previous && previous !== slides[next]) {
      previous.classList.remove('active');
      previous.classList.add('leaving');
      setTimeout(function () { previous.classList.remove('leaving'); }, 400);
    }

    current = next;
    // Force a reflow so the entry animation restarts on re-entry.
    var slide = slides[current];
    slide.classList.remove('active');
    void slide.offsetWidth;
    slide.classList.add('active');

    progress.style.width = ((current + 1) / slides.length * 100) + '%';

    if (location.hash !== '#' + (current + 1)) {
      history.replaceState(null, '', '#' + (current + 1));
    }
  }

  function fromHash() {
    var n = parseInt((location.hash || '').replace('#', ''), 10);
    return isNaN(n) ? 0 : Math.max(0, Math.min(n - 1, slides.length - 1));
  }

  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey) return;
    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown': case ' ': case 'PageDown':
        e.preventDefault(); show(current + 1); break;
      case 'ArrowLeft': case 'ArrowUp': case 'PageUp':
        e.preventDefault(); show(current - 1); break;
      case 'Home': e.preventDefault(); show(0); break;
      case 'End': e.preventDefault(); show(slides.length - 1); break;
      case 'f': case 'F':
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen();
        break;
      case 'p': case 'P': window.print(); break;
    }
  });

  // Tap left/right thirds on touch devices.
  document.addEventListener('click', function (e) {
    if (e.target.closest('a')) return;
    show(e.clientX < window.innerWidth / 3 ? current - 1 : current + 1);
  });

  var touchStartX = 0;
  document.addEventListener('touchstart', function (e) { touchStartX = e.touches[0].clientX; }, { passive: true });
  document.addEventListener('touchend', function (e) {
    var dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 48) show(dx < 0 ? current + 1 : current - 1);
  }, { passive: true });

  window.addEventListener('hashchange', function () { show(fromHash()); });

  show(fromHash(), true);
  setTimeout(function () { hint.classList.add('hidden'); }, 4000);
})();
</script>
</body>
</html>
`;
}

// ── Document / spreadsheet ──────────────────────────────────────────────────

export interface DocumentSpec {
  title: string;
  author?: string;
  theme: DeckTheme;
  date?: string;
  /** Pre-rendered HTML body (markdown is converted before it reaches here). */
  body: string;
  pageSize?: 'a4' | 'letter';
}

/** Print-ready HTML document with page furniture; browser print → PDF. */
export function renderDocument(spec: DocumentSpec): string {
  const size = spec.pageSize === 'letter' ? '8.5in 11in' : 'A4';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(spec.title)}</title>
<style>
  :root {
    --text: #18181b;
    --muted: #52525b;
    --accent: ${spec.theme.accent};
    --border: rgba(0,0,0,0.12);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #e4e4e7;
    font-family: ${spec.theme.fontBody};
    color: var(--text);
    line-height: 1.62;
  }
  .page {
    background: #fff;
    width: ${spec.pageSize === 'letter' ? '8.5in' : '210mm'};
    min-height: ${spec.pageSize === 'letter' ? '11in' : '297mm'};
    margin: 24px auto;
    padding: ${spec.pageSize === 'letter' ? '1in' : '22mm'};
    box-shadow: 0 8px 40px rgba(0,0,0,0.14);
  }
  h1 { font-size: 30px; letter-spacing: -0.024em; margin: 0 0 6px; }
  h2 { font-size: 21px; letter-spacing: -0.016em; margin: 30px 0 10px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
  h3 { font-size: 16px; margin: 22px 0 8px; }
  p { margin: 0 0 12px; }
  ul, ol { margin: 0 0 14px; padding-left: 22px; }
  li { margin-bottom: 5px; }
  code { font-family: ${spec.theme.fontMono}; font-size: 0.9em; background: #f4f4f5; padding: 1px 5px; border-radius: 4px; }
  pre { background: #f4f4f5; border: 1px solid var(--border); border-radius: 8px; padding: 14px; overflow-x: auto; }
  pre code { background: none; padding: 0; font-size: 12.5px; line-height: 1.55; }
  blockquote { margin: 0 0 14px; padding-left: 16px; border-left: 3px solid var(--accent); color: var(--muted); }
  table { width: 100%; border-collapse: collapse; margin: 0 0 16px; font-size: 14px; }
  th, td { border: 1px solid var(--border); padding: 7px 10px; text-align: left; }
  th { background: #f4f4f5; font-weight: 620; }
  .doc-header { border-bottom: 2px solid var(--accent); padding-bottom: 12px; margin-bottom: 26px; }
  .doc-meta { font-family: ${spec.theme.fontMono}; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.1em; }
  a { color: var(--accent); }
  @page { size: ${size}; margin: ${spec.pageSize === 'letter' ? '1in' : '20mm'}; }
  @media print {
    body { background: #fff; }
    .page { margin: 0; padding: 0; width: auto; min-height: 0; box-shadow: none; }
    h2, h3 { break-after: avoid; page-break-after: avoid; }
    pre, blockquote, table { break-inside: avoid; page-break-inside: avoid; }
  }
</style>
</head>
<body>
<article class="page">
  <header class="doc-header">
    <h1>${escapeHtml(spec.title)}</h1>
    <div class="doc-meta">${[spec.author ?? '', spec.date ?? new Date().toISOString().slice(0, 10)].filter((v) => v.length > 0).map((v) => escapeHtml(v)).join(' · ')}</div>
  </header>
${spec.body}
</article>
</body>
</html>
`;
}

export interface SheetSpec {
  title: string;
  columns: string[];
  rows: string[][];
  /** Excel-style formulas keyed by "R{row}C{col}", 0-indexed over `rows`. */
  formulas?: Record<string, string>;
}

/** CSV export with correct quoting — the format every spreadsheet app accepts. */
export function toCsv(sheet: SheetSpec): string {
  const escape = (cell: string): string =>
    /[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;

  return [sheet.columns, ...sheet.rows].map((row) => row.map((c) => escape(c ?? '')).join(',')).join('\r\n');
}

/**
 * SpreadsheetML 2003 — a single XML file Excel, LibreOffice and Numbers all open,
 * and unlike CSV it carries live formulas and column types.
 */
export function toSpreadsheetXml(sheet: SheetSpec): string {
  const esc = (s: string) => escapeHtml(String(s ?? ''));
  const isNumeric = (s: string) => s !== '' && !Number.isNaN(Number(s.replace(/[,%$]/g, '')));

  const rowXml = (cells: string[], rowIndex: number, header = false): string =>
    `   <Row>\n${cells
      .map((cell, colIndex) => {
        const formula = sheet.formulas?.[`R${rowIndex}C${colIndex}`];
        const numeric = !header && !formula && isNumeric(cell);
        const type = numeric ? 'Number' : 'String';
        const value = numeric ? cell.replace(/[,%$]/g, '') : esc(cell);
        return `    <Cell${header ? ' ss:StyleID="hdr"' : ''}${formula ? ` ss:Formula="${esc(formula)}"` : ''}><Data ss:Type="${type}">${value}</Data></Cell>`;
      })
      .join('\n')}\n   </Row>`;

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="hdr">
   <Font ss:Bold="1"/>
   <Interior ss:Color="#E4E4E7" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="${esc(sheet.title).slice(0, 31)}">
  <Table>
${rowXml(sheet.columns, -1, true)}
${sheet.rows.map((r, i) => rowXml(r, i)).join('\n')}
  </Table>
 </Worksheet>
</Workbook>
`;
}

/** A working starter deck — an empty builder teaches nothing. */
export function starterDeck(title = 'Untitled Deck'): DeckSpec {
  return {
    title,
    theme: TERMINAL_THEME,
    aspect: '16:9',
    slides: [
      { layout: 'title', title, subtitle: 'Chomugiri Studio', body: 'Generated deck. Arrow keys to navigate, P to print to PDF.' },
      { layout: 'bullets', title: 'Agenda', bullets: ['First point', 'Second point', 'Third point'] },
      { layout: 'end', title: 'Thank you' },
    ],
  };
}
