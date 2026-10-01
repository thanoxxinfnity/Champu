/**
 * Mistakes in a generated website that make it look broken on every device.
 *
 * Found by building one: asked for a scroll-driven 3D Minecraft page, Kimi K3
 * wrote a "your browser couldn't start WebGL" card as `<div id="fallback"
 * hidden>` and styled it `#fallback { position: fixed; inset: 0; display: flex;
 * background: … }`. An author rule that sets `display` beats the browser's own
 * `[hidden] { display: none }`, so the card was never hidden — it covered the
 * whole scene, opaque, on a phone with a perfectly good GPU. The page looked
 * like it had failed to load. The model got everything else right, so this is
 * fixed deterministically rather than hoped away.
 *
 * Pure: file lists in, changed file contents out.
 */

export interface SiteFile {
  path: string;
  content: string;
}

export interface SiteFix {
  path: string;
  content: string;
  reason: string;
}

const HIDDEN_RULE = '[hidden] { display: none !important; }';

/** An element carrying the boolean `hidden` attribute. */
const HIDDEN_ATTR = /<[a-z][^>]*\shidden(?=[\s>/=])/i;
/** Script that flips an element's `hidden` property. */
const HIDDEN_PROP = /\.hidden\s*=|toggleAttribute\(\s*['"]hidden['"]|removeAttribute\(\s*['"]hidden['"]|setAttribute\(\s*['"]hidden['"]/;
/** A rule that already wins over an author `display`. */
const HAS_OVERRIDE = /\[hidden\][^{}]*\{[^}]*display\s*:\s*none\s*!important/i;

const isHtml = (p: string) => /\.html?$/i.test(p);
const isCss = (p: string) => /\.css$/i.test(p);
const isJs = (p: string) => /\.(m?js|jsx?)$/i.test(p);

function styleBlocks(html: string): string[] {
  return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
}

/** The stylesheet the page actually links, resolved against the page. */
function linkedStylesheet(html: string, htmlPath: string, files: SiteFile[]): SiteFile | undefined {
  const dir = htmlPath.includes('/') ? htmlPath.replace(/\/[^/]*$/, '/') : '';
  for (const m of html.matchAll(/<link[^>]*rel=["']?stylesheet["']?[^>]*>/gi)) {
    const href = /href=["']?([^"'\s>]+)/i.exec(m[0])?.[1];
    if (!href || /^(https?:)?\/\//i.test(href)) continue;
    const clean = href.replace(/^\.\//, '').replace(/[?#].*$/, '');
    const found = files.find((f) => f.path === clean || f.path === `${dir}${clean}`);
    if (found) return found;
  }
  return undefined;
}

/**
 * Makes the `hidden` attribute work.
 *
 * Applies only when the site uses `hidden` (in markup or in script) and
 * nothing already forces it — so a page that handled it itself is untouched.
 */
export function repairHiddenAttribute(files: SiteFile[]): SiteFix[] {
  const pages = files.filter((f) => isHtml(f.path));
  if (!pages.length) return [];

  const usesHidden =
    pages.some((f) => HIDDEN_ATTR.test(f.content)) || files.some((f) => isJs(f.path) && HIDDEN_PROP.test(f.content));
  if (!usesHidden) return [];

  const sheets = files.filter((f) => isCss(f.path));
  const covered =
    sheets.some((f) => HAS_OVERRIDE.test(f.content)) ||
    pages.some((f) => styleBlocks(f.content).some((b) => HAS_OVERRIDE.test(b)));
  if (covered) return [];

  const reason =
    'The page uses the `hidden` attribute, but a CSS `display` rule overrides it, so "hidden" elements (like a fallback card) stay visible on top of the page. Added `[hidden] { display: none !important; }`.';

  for (const page of pages) {
    const sheet = linkedStylesheet(page.content, page.path, files);
    if (sheet) {
      return [{ path: sheet.path, content: `${sheet.content.trimEnd()}\n\n${HIDDEN_RULE}\n`, reason }];
    }
  }

  // No linked stylesheet: put it in the page's own <style>, or add one.
  const page = pages.find((f) => /<\/head>/i.test(f.content)) ?? pages[0];
  const inline = /<\/style>/i.exec(page.content);
  const content = inline
    ? page.content.slice(0, inline.index) + `${HIDDEN_RULE}\n` + page.content.slice(inline.index)
    : /<\/head>/i.test(page.content)
      ? page.content.replace(/<\/head>/i, `<style>${HIDDEN_RULE}</style>\n</head>`)
      : `<style>${HIDDEN_RULE}</style>\n${page.content}`;
  return [{ path: page.path, content, reason }];
}

/** Every repair a generated site gets. */
export function repairSite(files: SiteFile[]): SiteFix[] {
  return repairHiddenAttribute(files);
}
