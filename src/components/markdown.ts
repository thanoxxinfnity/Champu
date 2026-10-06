import { Marked } from 'marked';
import hljs from 'highlight.js/lib/common';
import { chipifyHtml } from '../lib/sites/domains.ts';
import { activityOf } from '../lib/agent/activity.ts';
import { describeCommand } from '../lib/agent/narrate.ts';
import { iconHtml, pick, SCENE_HTML, TAIL_HTML, VARIANTS } from '../lib/agent/activity-icons.ts';

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

      // The path= info string is how Lane B tags artifacts; it becomes the label.
      const pathMatch = /(?:path|file|filename)=("[^"]+"|'[^']+'|\S+)/.exec(lang ?? '');
      const path = pathMatch?.[1]?.replace(/^["']|["']$/g, '');
      const label = path ?? (language ? language : 'Code');

      // Every block carries Copy and Expand. They are plain buttons with a data
      // attribute; one delegated click handler (codeActions.ts) does the work, so
      // no script ever travels inside model output.
      const icon = (d: string) =>
        `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
      const copyIcon = icon('<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"/>');
      const doneIcon = icon('<path d="M5 12.5l4.5 4.5L19 7.5"/>');
      const expandIcon = icon('<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>');
      const closeIcon = icon('<path d="M6 6l12 12M18 6L6 18"/>');

      // A block that carries work (a file being written, a command being run) can light up while that is
      // happening: the same icon, scene and words the thinking bubble uses, so the two read as one thing.
      const isCommand = path === '@terminal' || path === '@shell' || (!path && /^(bash|sh|shell|zsh|console)$/.test(language));
      const work = isCommand || Boolean(path);
      const phrase = isCommand ? describeCommand(text.trim()) : `Writing ${path}…`;
      const kind = isCommand ? activityOf(phrase) : 'write';
      const chip = work
        ? `<span class="live-chip">${iconHtml(kind)}<span class="live-text">${escapeHtml(phrase.length > 60 ? `${phrase.slice(0, 59)}…` : phrase).replace(/\./g, '&#46;')}</span>${TAIL_HTML}</span>`
        : '';
      const attrs = work
        ? ` data-activity="${kind}" data-variant="${pick(path ?? '', VARIANTS)}"${isCommand ? ` data-cmd="${pick(text.trim(), 1_000_000_007).toString(36)}"` : ''}`
        : '';

      const header =
        `<div class="code-head">${work ? SCENE_HTML : ''}<span class="code-label${path ? ' is-path' : ''}">${path ? '<span style="color:var(--accent)">▸</span> ' : ''}${escapeHtml(label)}</span>${chip}` +
        `<span class="code-actions">` +
        `<button type="button" class="code-btn" data-code-action="copy" aria-label="Copy code" title="Copy"><span class="ic-copy">${copyIcon}</span><span class="ic-done">${doneIcon}</span></button>` +
        `<button type="button" class="code-btn" data-code-action="expand" aria-label="Expand code" title="Expand"><span class="ic-expand">${expandIcon}</span><span class="ic-close">${closeIcon}</span></button>` +
        `</span></div>`;

      return `<div class="code-block"${attrs}>${header}<pre><code class="hljs language-${escapeHtml(language)}">${highlighted}</code></pre></div>`;
    },
  },
});

/**
 * Marks the blocks that are working right now. `liveLast` is a block still being streamed (the last one);
 * `runningCmd` is the command the terminal is executing, matched by the hash each command block carries.
 */
export function markLive(html: string, opts: { liveLast?: boolean; runningCmd?: string | null }): string {
  let out = html;
  if (opts.runningCmd) {
    const tag = `data-cmd="${pick(opts.runningCmd.trim(), 1_000_000_007).toString(36)}"`;
    out = out.replace(
      new RegExp(`<div class="code-block"([^>]*${tag}[^>]*)>`, 'g'),
      '<div class="code-block is-live"$1>',
    );
  }
  if (opts.liveLast) {
    const at = out.lastIndexOf('<div class="code-block"');
    if (at >= 0 && !out.startsWith('<div class="code-block is-live"', at) && /data-activity=/.test(out.slice(at, out.indexOf('>', at)))) {
      out = `${out.slice(0, at)}<div class="code-block is-live"${out.slice(at + '<div class="code-block"'.length)}`;
    }
  }
  return out;
}

export function renderMarkdown(source: string): string {
  try {
    // Website names get their logo after rendering, so code blocks are already
    // closed off and nothing untrusted is ever handed to the chip builder raw.
    return chipifyHtml(marked.parse(source, { async: false }));
  } catch {
    return `<p>${escapeHtml(source)}</p>`;
  }
}
