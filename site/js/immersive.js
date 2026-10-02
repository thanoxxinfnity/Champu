/**
 * Immersion: the page reacts to you. Embers rise in the hero and lean away from your finger, the
 * hero tilts with your phone, headings rise word by word, the Horizon photos move at their own
 * speed as you scroll, and the screenshot row turns like a cover-flow deck.
 * Cheap on purpose (one small canvas, transform-only updates, paused off-screen) and silent for
 * anyone who asked for reduced motion.
 */
import { reduced } from './type.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---------- embers ---------- */
function embers() {
  const canvas = $('#embers');
  if (!canvas || reduced) return;
  const ctx = canvas.getContext('2d');
  let w = 0, h = 0, visible = true;
  const N = matchMedia('(max-width: 600px)').matches ? 34 : 64;
  const pts = Array.from({ length: N }, () => ({ x: Math.random(), y: Math.random(), r: 1 + Math.random() * 2.6, v: 0.04 + Math.random() * 0.1, d: Math.random() * 6.28, a: 0.25 + Math.random() * 0.5 }));
  const pointer = { x: -999, y: -999 };
  const size = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  new ResizeObserver(size).observe(canvas); size();
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; }, { threshold: 0 }).observe(canvas);
  const hero = canvas.parentElement;
  const move = (e) => { const r = hero.getBoundingClientRect(); pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top; };
  hero.addEventListener('pointermove', move, { passive: true });
  hero.addEventListener('pointerleave', () => { pointer.x = pointer.y = -999; });
  let last = performance.now();
  const frame = (now) => {
    requestAnimationFrame(frame);
    if (!visible || document.hidden) { last = now; return; }
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    ctx.clearRect(0, 0, w, h);
    for (const p of pts) {
      p.y -= p.v * dt; p.d += dt * 0.8;
      if (p.y < -0.05) { p.y = 1.05; p.x = Math.random(); }
      let x = p.x * w + Math.sin(p.d) * 14, y = p.y * h;
      const dx = x - pointer.x, dy = y - pointer.y, dist = Math.hypot(dx, dy);
      if (dist < 90) { const k = (90 - dist) / 90; x += (dx / (dist || 1)) * k * 40; y += (dy / (dist || 1)) * k * 40; }
      const g = ctx.createRadialGradient(x, y, 0, x, y, p.r * 5);
      g.addColorStop(0, `rgba(${dark ? '255,170,90' : '234,88,12'},${p.a})`);
      g.addColorStop(1, 'rgba(255,140,50,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, p.r * 5, 0, 6.283); ctx.fill();
    }
  };
  requestAnimationFrame(frame);
}

/* ---------- tilt the hero with the phone (Android gives this freely; iOS asks, and is left alone) ---------- */
function tilt() {
  const hero = $('.hero');
  if (!hero || reduced || !('DeviceOrientationEvent' in window) || typeof DeviceOrientationEvent.requestPermission === 'function') return;
  let tick = false, gx = 0, gy = 0;
  addEventListener('deviceorientation', (e) => {
    if (e.gamma == null) return;
    gx = Math.max(-1, Math.min(1, e.gamma / 30)); gy = Math.max(-1, Math.min(1, ((e.beta ?? 45) - 45) / 30));
    if (tick) return;
    tick = true;
    requestAnimationFrame(() => { hero.style.setProperty('--tx', `${gx * 14}px`); hero.style.setProperty('--ty', `${gy * 14}px`); tick = false; });
  }, { passive: true });
}

/* ---------- headings rise word by word ---------- */
function splitHeadings() {
  if (reduced) return;
  for (const h of $$('.head h2')) {
    let i = 0;
    const walk = (node) => {
      for (const child of [...node.childNodes]) {
        if (child.nodeType === 3) {
          const frag = document.createDocumentFragment();
          for (const part of child.textContent.split(/(\s+)/)) {
            if (!part) continue;
            if (/^\s+$/.test(part)) { frag.append(part); continue; }
            const w = document.createElement('span');
            w.className = 'w'; w.textContent = part; w.style.setProperty('--i', String(i++));
            frag.append(w);
          }
          child.replaceWith(frag);
        } else if (child.nodeType === 1) walk(child);
      }
    };
    h.setAttribute('aria-label', h.textContent.trim());
    walk(h);
  }
}

/* ---------- horizon: photos drift at their own speed; the screenshot rows turn like a deck ---------- */
function scrollScenes() {
  if (reduced) return;
  const hz = $('#hz-hero');
  const decks = $$('.gallery');
  let tick = false;
  const run = () => {
    tick = false;
    if (hz) {
      const r = hz.getBoundingClientRect();
      if (r.bottom > 0 && r.top < innerHeight) {
        const k = (r.top + r.height / 2 - innerHeight / 2) / innerHeight; // -1..1 around centre
        hz.style.setProperty('--hz', `${k * -34}px`);
      }
    }
  };
  addEventListener('scroll', () => { if (!tick) { tick = true; requestAnimationFrame(run); } }, { passive: true });
  run();

  for (const deck of decks) {
    const figs = $$('figure', deck);
    let t2 = false;
    const turn = () => {
      t2 = false;
      const r = deck.getBoundingClientRect();
      const mid = r.left + r.width / 2;
      for (const f of figs) {
        const fr = f.getBoundingClientRect();
        const d = (fr.left + fr.width / 2 - mid) / (r.width / 2); // -1..1
        const c = Math.max(-1.4, Math.min(1.4, d));
        const img = f.firstElementChild;
        img.style.transform = `perspective(800px) rotateY(${c * -22}deg) scale(${1 - Math.abs(c) * 0.08})`;
        img.style.opacity = String(1 - Math.min(0.5, Math.abs(c) * 0.3));
      }
    };
    deck.addEventListener('scroll', () => { if (!t2) { t2 = true; requestAnimationFrame(turn); } }, { passive: true });
    addEventListener('resize', turn);
    turn();
    setTimeout(turn, 800);
  }
}

/* ---------- chapter dots (wide screens) ---------- */
function dots() {
  const list = $('#dots');
  const secs = $$('main section[id]');
  if (!list || !secs.length) return;
  const names = { chomugiri: 'Chomugiri', research: 'Research', horizon: 'Chomu Horizon', godot: 'Voices', space: 'Solar system' };
  for (const s of secs) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `#${s.id}`; a.setAttribute('aria-label', names[s.id] ?? s.id); a.dataset.tip = names[s.id] ?? s.id;
    li.append(a); list.append(li);
  }
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting) $$('a', list).forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#${e.target.id}`));
  }), { rootMargin: '-45% 0px -50% 0px' });
  secs.forEach((s) => io.observe(s));
}

export function start() {
  splitHeadings();
  embers();
  tilt();
  scrollScenes();
  dots();
}
