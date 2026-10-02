/**
 * "Ask Chomu agent": the helper panel. It talks to our own /api/ask, which holds the instructions
 * and the facts; this file is only the conversation — sending, streaming the answer in with a
 * typing feel, and keeping the panel tidy on a phone.
 *
 * Nothing is stored: the conversation lives in this page and goes when the page does.
 */
import { loopPhrases, reduced } from './type.js';
import { answer } from './agent-llm.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (t) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const LINKS = {
  'https://github.com/thanoxxinfnity/Champu/releases/download/chomugiri-latest/Chomugiri.apk': '⬇ Download Chomugiri (APK)',
  'https://github.com/thanoxxinfnity/Champu/releases/download/latest-apk/ChomuHorizon.apk': '⬇ Download Chomu Horizon (APK)',
  'https://github.com/thanoxxinfnity/Champu': 'Chomugiri on GitHub',
};

/** A small, safe subset of markdown: **bold**, `code`, - lists, https links, line breaks. */
function render(text) {
  const lines = esc(text).split('\n');
  const out = [];
  let list = false;
  for (const raw of lines) {
    let l = raw
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/(https:\/\/[^\s<)]+[^\s<).,;:!?])/g, (url) => `<a href="${url}" target="_blank" rel="noopener">${LINKS[url] ?? url}</a>`);
    const item = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(l);
    if (item) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${item[1]}</li>`); continue; }
    if (list) { out.push('</ul>'); list = false; }
    out.push(l.trim() ? `<p>${l}</p>` : '');
  }
  if (list) out.push('</ul>');
  return out.join('');
}

const GREETING = "Hi! I'm Chomu agent. Ask me anything — Chomugiri and Chomu Horizon, school or code help, ideas, or just a chat. Hinglish me bhi puch sakte ho. Turn on “near me” and I can help with things around you too.";
const SUGGESTIONS = ['How do I install Chomugiri?', 'What can it build?', 'Chomu Horizon kya hai?', 'Explain black holes simply', 'Mere aas-paas kya dekhne layak hai?', 'Is my data safe?'];

export function start() {
  const panel = document.createElement('aside');
  panel.className = 'agent';
  panel.id = 'agent';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Ask Chomu agent');
  panel.setAttribute('aria-hidden', 'true');
  panel.setAttribute('aria-modal', 'true');
  panel.inert = true; // closed means unreachable: no tabbing into an invisible panel
  panel.innerHTML = `
    <header class="ag-head">
      <span class="mark" aria-hidden="true">&gt;_</span>
      <div><h2 class="ag-title">Chomu agent</h2><p class="ag-sub">ask me anything</p></div>
      <button class="ag-x" type="button" aria-label="Close">✕</button>
      <svg class="ag-squiggle" viewBox="0 0 300 10" preserveAspectRatio="none" aria-hidden="true"><path d="M2 6 C 20 0, 30 10, 50 5 S 80 1, 100 6 S 130 10, 150 5 S 190 0, 210 6 S 250 10, 298 4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>
    </header>
    <div class="ag-log" id="ag-log" role="log" aria-live="polite"></div>
    <div class="ag-chips" id="ag-chips"></div>
    <div class="ag-opts"><button class="ag-near" id="ag-near" type="button" aria-pressed="false" title="Lets me use your rough area (city) for “near me” questions. Off by default.">📍 near me: off</button></div>
    <form class="ag-form" id="ag-form">
      <textarea id="ag-input" rows="1" maxlength="600" placeholder="Ask me anything…" aria-label="Your question"></textarea>
      <button class="ag-send" type="submit" aria-label="Send"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 21 3l-7 18-3-7.5z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/></svg></button>
    </form>`;
  const scrim = document.createElement('div');
  scrim.className = 'ag-scrim';
  document.body.append(scrim, panel);

  const log = $('#ag-log'), input = $('#ag-input'), form = $('#ag-form'), chips = $('#ag-chips');
  const convo = [];
  let busy = false, opener = null, near = false;
  const nearBtn = $('#ag-near');
  nearBtn.addEventListener('click', () => {
    near = !near;
    nearBtn.setAttribute('aria-pressed', String(near));
    nearBtn.textContent = near ? '📍 near me: on (rough city)' : '📍 near me: off';
    nearBtn.classList.toggle('on', near);
  });

  const bubble = (who, html) => {
    const el = document.createElement('div');
    el.className = `ag-msg ${who}`;
    el.innerHTML = html;
    log.append(el);
    log.scrollTop = log.scrollHeight;
    return el;
  };
  bubble('bot', render(GREETING));
  for (const q of SUGGESTIONS) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = q;
    b.addEventListener('click', () => ask(q));
    chips.append(b);
  }

  const open = (from) => {
    opener = from ?? document.activeElement;
    panel.classList.add('open'); scrim.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    panel.inert = false;
    document.body.classList.add('agent-open');
    setTimeout(() => input.focus({ preventScroll: true }), 250);
    window.history.replaceState(null, '', '#ask');
  };
  const close = () => {
    panel.classList.remove('open'); scrim.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    panel.inert = true;
    document.body.classList.remove('agent-open');
    if (location.hash === '#ask') window.history.replaceState(null, '', location.pathname);
    opener?.focus?.({ preventScroll: true });
  };
  for (const id of ['askbar', 'ask-nav', 'fab']) $(`#${id}`)?.addEventListener('click', (e) => open(e.currentTarget));
  $('.ag-x', panel).addEventListener('click', close);
  scrim.addEventListener('click', close);
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel.classList.contains('open')) close(); });
  if (location.hash === '#ask') open(null);

  // the floating button shrinks to its icon once you are reading
  const fab = $('#fab');
  addEventListener('scroll', () => fab.classList.toggle('small', scrollY > 320), { passive: true });

  loopPhrases($('#ask-hint'), ['how do I install it?', 'what can Chomu Horizon do?', 'Hinglish me bhi puch lo…', 'what does it build?'], { hold: 1500, speed: 55 });

  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 120)}px`; });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  form.addEventListener('submit', (e) => { e.preventDefault(); ask(input.value); });

  async function ask(text) {
    const q = text.trim();
    if (!q || busy) return;
    busy = true;
    chips.hidden = true;
    input.value = ''; input.style.height = 'auto';
    bubble('me', `<p>${esc(q)}</p>`);
    convo.push({ role: 'user', content: q });
    const el = bubble('bot', '<span class="ag-dots" aria-label="Thinking"><i></i><i></i><i></i></span>');

    let shown = '', queue = '', finished = false;
    // Chunks arrive in bursts; this lets the words come out at a steady, writing-like pace.
    const drain = () => {
      if (queue) {
        const n = reduced ? queue.length : Math.max(1, Math.ceil(queue.length / 14));
        shown += queue.slice(0, n); queue = queue.slice(n);
        el.innerHTML = render(shown);
        log.scrollTop = log.scrollHeight;
      }
      if (queue || !finished) requestAnimationFrame(drain);
    };
    requestAnimationFrame(drain);

    try {
      for await (const t of answer({ messages: convo.slice(-8), near, tz: Intl.DateTimeFormat().resolvedOptions().timeZone })) queue += t;
      convo.push({ role: 'assistant', content: shown + queue });
    } catch (err) {
      queue += `${shown || queue ? '\n\n' : ''}${err.message}`;
      convo.pop(); // the unanswered question is not part of the conversation
    } finally {
      finished = true;
      busy = false;
      setTimeout(() => { el.innerHTML = render(shown + queue); log.scrollTop = log.scrollHeight; }, 400);
      input.focus({ preventScroll: true });
    }
  }
}
