/**
 * Running a generated website without a server.
 *
 * A build produces loose files — index.html, styles.css, app.js — and until now
 * nothing rendered them: the user got a file list and had to take it on trust
 * that the site worked. An iframe cannot resolve `./app.js` against a set of
 * files held in memory, so the document is assembled first: local references are
 * replaced by their contents, and everything else (a CDN import, an image URL)
 * is left exactly as written.
 *
 * Pure on purpose — no DOM, no fetch — so the assembly is testable on its own.
 */

export interface SiteFile {
  path: string;
  content: string;
}

/** The entry document, if these files are a website at all. */
export function siteEntry(files: SiteFile[]): SiteFile | null {
  const html = files.filter((f) => /\.html?$/i.test(f.path));
  if (!html.length) return null;

  // A root index.html wins; then the shallowest index; then any HTML file.
  const byDepth = (a: SiteFile, b: SiteFile) => a.path.split('/').length - b.path.split('/').length;
  const indexes = html.filter((f) => /(^|\/)index\.html?$/i.test(f.path)).sort(byDepth);
  return indexes[0] ?? html.sort(byDepth)[0];
}

/** True when the files use three.js, which decides what the preview warns about. */
export function usesThree(files: SiteFile[]): boolean {
  return files.some((f) => /\bthree(\.module)?(\.min)?\.js\b|from\s+['"]three['"]|THREE\./.test(f.content));
}

/**
 * Resolve a reference the way a browser would, relative to the document.
 *
 * Returns null for anything that is not a local file: absolute URLs, protocol-
 * relative URLs, data: and blob:, and fragment-only links.
 */
export function resolveLocal(from: string, ref: string): string | null {
  const href = ref.trim();
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('#')) return null;

  const base = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
  const stripped = href.replace(/[?#].*$/, '');
  const parts = (stripped.startsWith('/') ? stripped.slice(1) : `${base}/${stripped}`).split('/');

  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function find(files: SiteFile[], path: string): SiteFile | undefined {
  return files.find((f) => f.path === path || f.path === `./${path}` || f.path.replace(/^\.\//, '') === path);
}

/** Escapes a closing script tag so inlined JS cannot end its own block early. */
function safeScript(code: string): string {
  return code.replace(/<\/script/gi, '<\\/script');
}

/**
 * One self-contained document.
 *
 * Local `<link rel=stylesheet>` and `<script src>` are replaced by their
 * contents; a module script keeps `type="module"` so imports still work, and a
 * bare `import './x.js'` inside it is left alone — rewriting arbitrary module
 * graphs is a bundler's job, and guessing wrong would break a site that was
 * fine. Those sites still preview correctly when written as one module, which
 * is what the prompt asks for.
 */
export function bundleSite(files: SiteFile[], entry?: SiteFile): string | null {
  const doc = entry ?? siteEntry(files);
  if (!doc) return null;

  let html = doc.content;

  html = html.replace(
    /<link\b[^>]*\brel=["']?stylesheet["']?[^>]*>/gi,
    (tag) => {
      const href = /\bhref=["']([^"']+)["']/i.exec(tag)?.[1];
      if (!href) return tag;
      const target = resolveLocal(doc.path, href);
      const file = target ? find(files, target) : undefined;
      return file ? `<style data-from="${target}">\n${file.content}\n</style>` : tag;
    },
  );

  html = html.replace(
    /<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)><\/script>/gi,
    (tag, before: string, src: string, after: string) => {
      const target = resolveLocal(doc.path, src);
      const file = target ? find(files, target) : undefined;
      if (!file) return tag;
      const attrs = `${before} ${after}`;
      const isModule = /\btype=["']module["']/i.test(attrs);
      return `<script${isModule ? ' type="module"' : ''} data-from="${target}">\n${safeScript(file.content)}\n</script>`;
    },
  );

  return html;
}

/**
 * What the preview cannot do, in words worth showing.
 *
 * Said up front rather than left to be discovered: a site that loads a library
 * from a CDN needs the network, and a multi-module build needs a real server.
 */
export function previewCaveats(files: SiteFile[], html: string): string[] {
  const out: string[] = [];

  if (/<script[^>]*\bsrc=["'](https?:)?\/\//i.test(html) || /from\s+["']https?:\/\//.test(html)) {
    out.push('Loads a library from a CDN — the preview needs an internet connection for it.');
  }
  const unresolved = /<script\b[^>]*\bsrc=["'](?!https?:|\/\/|data:)[^"']+["']/i.exec(html);
  if (unresolved) {
    out.push(`Could not find ${/src=["']([^"']+)["']/i.exec(unresolved[0])?.[1]} among the generated files.`);
  }
  if (files.some((f) => /\.(png|jpe?g|gif|webp|svg|glb|gltf|mp4|woff2?)$/i.test(f.path))) {
    out.push('Binary assets are not inlined; anything referencing them shows a broken link here but works once deployed.');
  }
  return out;
}
