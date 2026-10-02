/**
 * Copy and Expand for the code blocks in a rendered reply.
 *
 * The HTML comes from `renderMarkdown` and carries no script, so the buttons are
 * wired by one delegated handler on the container that holds it. The code is read
 * back out of the block's own <code> element, so what is copied is exactly what is
 * shown, with no second copy of it stored in an attribute.
 */

/** Clipboard API first; a hidden textarea when the WebView refuses it. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

interface Expandable extends HTMLElement {
  __home?: Comment;
}

function collapse(block: Expandable): void {
  block.classList.remove('is-expanded');
  // If the reply was redrawn while the block was open (a streaming delta, a session switch) its
  // place is gone; put nothing back rather than leave a stray copy at the bottom of the page.
  if (block.__home?.isConnected) block.__home.replaceWith(block);
  else block.remove();
  block.__home = undefined;
  block.querySelector('[data-code-action="expand"]')?.setAttribute('aria-label', 'Expand code');
  document.body.classList.remove('code-expanded');
}

function expand(block: Expandable): void {
  // A reply sits inside an animated, transformed container, and a transformed
  // ancestor turns `position: fixed` into "fixed to me" — the expanded block came out
  // as a strip instead of the whole screen. So it moves to <body> while open and
  // goes back to exactly where it was when closed.
  block.__home = document.createComment('code-block');
  block.replaceWith(block.__home);
  document.body.appendChild(block);
  block.classList.add('is-expanded');
  block.querySelector('[data-code-action="expand"]')?.setAttribute('aria-label', 'Close expanded code');
  document.body.classList.add('code-expanded');
}

function onClick(event: Event): void {
  const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('button[data-code-action]');
  if (!button) return;
  const block = button.closest<Expandable>('.code-block');
  if (!block) return;

  if (button.dataset.codeAction === 'copy') {
    const text = block.querySelector('code')?.textContent ?? '';
    void copyText(text).then((ok) => {
      button.classList.toggle('is-done', ok);
      button.classList.toggle('is-failed', !ok);
      button.title = ok ? 'Copied' : 'Could not copy';
      window.setTimeout(() => {
        button.classList.remove('is-done', 'is-failed');
        button.title = 'Copy';
      }, 1600);
    });
    return;
  }

  if (button.dataset.codeAction === 'expand') {
    if (block.classList.contains('is-expanded')) collapse(block);
    else expand(block);
  }
}

function onKey(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  const open = document.querySelector<Expandable>('.code-block.is-expanded');
  if (open) collapse(open);
}

// One listener for the whole page, registered once when this module loads in the
// browser. It has to live on `document` rather than on each reply because an
// expanded block is no longer inside its reply.
if (typeof document !== 'undefined' && !(window as unknown as { __codeActions?: boolean }).__codeActions) {
  (window as unknown as { __codeActions?: boolean }).__codeActions = true;
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
}
