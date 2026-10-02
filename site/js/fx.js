/**
 * The extra motion: numbers that count up, a glow that follows the pointer, parallax on the hero,
 * paper bits when a download is tapped, and the real build version on the download buttons.
 * Everything here is decoration over a page that already works without it, and all of it stands
 * still for people who asked their phone for reduced motion.
 */
import { reduced } from './type.js';

const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/** "5" → counts 0…5; "3 s" → 0…3 then " s"; text it cannot read is left alone. */
function countUp(el) {
  const m = /^(\d+(?:\.\d+)?)(.*)$/.exec(el.textContent.trim());
  if (!m || reduced) return;
  const end = Number(m[1]), tail = m[2], dec = m[1].includes('.') ? 1 : 0;
  const t0 = performance.now(), dur = 1100;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    const eased = 1 - (1 - k) ** 3;
    el.textContent = `${(end * eased).toFixed(dec)}${tail}`;
    if (k < 1) requestAnimationFrame(step);
  };
  el.textContent = `0${tail}`;
  requestAnimationFrame(step);
}

function confetti(x, y) {
  if (reduced) return;
  const colors = ['#ea580c', '#fb923c', '#fde0c6', '#c2410c', '#2c2018'];
  for (let i = 0; i < 20; i += 1) {
    const b = document.createElement('i');
    const a = (Math.PI * 2 * i) / 20 + Math.random() * 0.4, d = 50 + Math.random() * 70;
    b.className = 'bit';
    b.style.cssText = `left:${x}px;top:${y}px;background:${colors[i % colors.length]};--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 30}px;--r:${Math.random() * 540 - 270}deg`;
    document.body.append(b);
    setTimeout(() => b.remove(), 900);
  }
}

const fmtDate = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '');

/** The download buttons say which build they hand out, from data/release.json written at deploy time. */
async function releaseInfo() {
  try {
    const info = await (await fetch('/data/release.json')).json();
    const c = info.chomugiri, h = info.horizon;
    const set = (key, text) => $$(`[data-release="${key}"]`).forEach((el) => { el.textContent = text; });
    if (c?.version) set('chomugiri', `Android · v${c.version} · ${c.mb} MB${c.date ? ` · ${fmtDate(c.date)}` : ''}`);
    if (h?.mb) set('horizon', `Android · ${h.mb} MB · landscape`);
  } catch { /* the buttons keep their plain text */ }
}

export function start() {
  releaseInfo();

  // counters, when their card scrolls in
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); countUp(e.target); } }), { threshold: 0.6 });
  $$('.fact b').forEach((b) => io.observe(b));

  // glow that follows the pointer on cards (mouse only; phones have no pointer to follow)
  if (matchMedia('(hover: hover)').matches && !reduced) {
    for (const el of $$('.fact, .maps div, .dl-card, .voice, .ncard')) {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', `${e.clientX - r.left}px`);
        el.style.setProperty('--my', `${e.clientY - r.top}px`);
      });
      el.classList.add('glow');
    }
  }

  // hero parallax: blobs and icons drift at different speeds as the page scrolls
  const hero = document.querySelector('.hero');
  if (hero && !reduced) {
    let tick = false;
    addEventListener('scroll', () => {
      if (tick) return;
      tick = true;
      requestAnimationFrame(() => {
        const y = Math.min(scrollY, innerHeight);
        hero.style.setProperty('--py', `${y * 0.25}px`);
        hero.style.setProperty('--py2', `${y * -0.12}px`);
        tick = false;
      });
    }, { passive: true });
  }

  // paper bits from the download buttons (the link still goes ahead)
  for (const a of $$('#dl-chomugiri-btn, #dl-horizon-btn')) {
    a.addEventListener('click', (e) => { const r = a.getBoundingClientRect(); confetti(e.clientX || r.left + r.width / 2, e.clientY || r.top + r.height / 2); });
  }
}
