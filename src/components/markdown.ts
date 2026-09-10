import { Marked } from 'marked';
import hljs from 'highlight.js/lib/common';

/**
 * Markdown → HTML for chat bubbles.
 *
 * Model output is untrusted text, so the renderer is locked down: no raw HTML
 * passthrough, and every URL is scheme-checked before it becomes an href. That
 * removes the XSS surface without pulling in a sanitiser dependency.
 */

const marked = new Marked({
  gfm: true,
  breaks: true,
});

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Only these schemes may appear in an href/src. Blocks javascript: and data:. */
const SAFE_SCHEME = /^(?:https?:|mailto:|#|\/(?!\/))/i;

function safeUrl(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed) return null;
  // Relative paths without a scheme are fine.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed.startsWith('//') ? null : trimmed;
  return SAFE_SCHEME.test(trimmed) ? trimmed : null;
}

marked.use({
  renderer: {
    html() {
      // Drop raw HTML entirely rather than trying to sanitise it.
      return '';
    },
    link({ href, title, tokens }) {
      const url = safeUrl(href);
      const text = this.parser.parseInline(tokens);
      if (!url) return text;
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      return `<a href="${escapeHtml(url)}"${titleAttr} target="_blank" rel="noopener noreferrer nofollow">${text}</a>`;
    },
    image({ href, title, text }) {
      const url = safeUrl(href) ?? (href.startsWith('data:image/') ? href : null);
      if (!url) return escapeHtml(text);
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      return `<img src="${escapeHtml(url)}" alt="${escapeHtml(text)}"${titleAttr} loading="lazy" style="max-width:100%;border-radius:8px;border:1px solid var(--line)">`;
    },
    code({ text, lang }) {
      const language = (lang ?? '').split(/\s+/)[0].toLowerCase();
      let highlighted: string;

      if (language && hljs.getLanguage(language)) {
        try {
          highlighted = hljs.highlight(text, { language, ignoreIllegals: true }).value;
        } catch {
          highlighted = escapeHtml(text);
        }
      } else {
        highlighted = escapeHtml(text);
      }

      // The path= info string is how Lane B tags artifacts; surface it as a header.
      const pathMatch = /(?:path|file|filename)=("[^"]+"|'[^']+'|\S+)/.exec(lang ?? '');
      const path = pathMatch?.[1]?.replace(/^["']|["']$/g, '');

      const header = path
        ? `<div style="display:flex;align-items:center;gap:8px;padding:7px 12px;border-bottom:1px solid var(--line);font-family:var(--font-mono);font-size:11px;color:var(--ink-dim)"><span style="color:var(--accent)">▸</span>${escapeHtml(path)}</div>`
        : language
          ? `<div style="padding:6px 12px;border-bottom:1px solid var(--line);font-family:var(--font-mono);font-size:10.5px;text-transform:uppercase;letter-spacing:0.09em;color:var(--ink-faint)">${escapeHtml(language)}</div>`
          : '';

      return `<div style="background:var(--surface);border:1px solid var(--line);border-radius:10px;overflow:hidden">${header}<pre style="border:none;border-radius:0;margin:0"><code class="hljs language-${escapeHtml(language)}">${highlighted}</code></pre></div>`;
    },
  },
});

export function renderMarkdown(source: string): string {
  try {
    return marked.parse(source, { async: false });
  } catch {
    return `<p>${escapeHtml(source)}</p>`;
  }
}
