/** Types text into an element one letter at a time, like an AI writing. Cancellable. */
export const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * `el` gets its textContent grown to `text`. Pass `signal.cancelled` style tokens via
 * `token` ({ stop: false }) to abandon a run. Speed is jittered so it feels written,
 * with a short beat after punctuation.
 */
export async function typeInto(el, text, { speed = 55, token = { stop: false } } = {}) {
  if (reduced) { el.textContent = text; return true; }
  el.textContent = '';
  for (let i = 0; i < text.length; i += 1) {
    if (token.stop) return false;
    el.textContent += text[i];
    const c = text[i];
    await sleep(speed * (0.55 + Math.random() * 0.9) + (/[,.;:!?—]/.test(c) ? speed * 4 : c === ' ' ? speed * 0.4 : 0));
  }
  return true;
}

/** Erases letter by letter. */
export async function eraseFrom(el, { speed = 22, token = { stop: false } } = {}) {
  if (reduced) { el.textContent = ''; return true; }
  while (el.textContent.length) {
    if (token.stop) return false;
    el.textContent = el.textContent.slice(0, -1);
    await sleep(speed);
  }
  return true;
}

/** Cycles through phrases forever: type, hold, erase. */
export function loopPhrases(el, phrases, { hold = 1600, speed = 60 } = {}) {
  const token = { stop: false };
  (async () => {
    let i = 0;
    for (;;) {
      if (!(await typeInto(el, phrases[i % phrases.length], { speed, token }))) return;
      await sleep(hold);
      if (reduced) { i += 1; continue; }
      if (!(await eraseFrom(el, { token }))) return;
      await sleep(250);
      i += 1;
    }
  })();
  return token;
}

/** Runs `fn` when the element first scrolls into view (and `onLeave` when it leaves, if given). */
export function whenVisible(el, fn, { once = true, margin = '0px 0px -10% 0px', onLeave } = {}) {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { fn(); if (once) io.disconnect(); } else if (onLeave) onLeave();
    }
  }, { rootMargin: margin });
  io.observe(el);
  return io;
}
