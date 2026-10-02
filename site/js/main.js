import { loopPhrases, typeInto, sleep, reduced, whenVisible } from './type.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---------- theme ---------- */
const root = document.documentElement;
const themeBtn = $('#theme');
const dark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
const paintTheme = () => { themeBtn.textContent = dark() ? '☾' : '☀'; };
themeBtn.addEventListener('click', () => {
  const next = dark() ? 'light' : 'dark';
  root.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch { /* private mode */ }
  paintTheme();
});
paintTheme();

/* ---------- drawer ---------- */
const drawer = $('#drawer'), scrim = $('#scrim'), menu = $('#menu');
const setDrawer = (open) => { drawer.classList.toggle('open', open); scrim.classList.toggle('open', open); menu.setAttribute('aria-expanded', String(open)); };
menu.addEventListener('click', () => setDrawer(!drawer.classList.contains('open')));
scrim.addEventListener('click', () => setDrawer(false));
$$('a', drawer).forEach((a) => a.addEventListener('click', () => setDrawer(false)));
addEventListener('keydown', (e) => { if (e.key === 'Escape') setDrawer(false); });

/* ---------- scroll progress + active link ---------- */
const bar = $('#progress');
let ticking = false;
addEventListener('scroll', () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    const h = document.documentElement;
    bar.style.transform = `scaleX(${Math.min(1, h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight))})`;
    ticking = false;
  });
}, { passive: true });
const links = $$('#links a');
const spy = new IntersectionObserver((es) => {
  for (const e of es) if (e.isIntersecting) links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#${e.target.id}`));
}, { rootMargin: '-45% 0px -50% 0px' });
$$('main section[id]').forEach((s) => spy.observe(s));

/* ---------- reveal on scroll ---------- */
const rv = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); rv.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
$$('.rv').forEach((el) => rv.observe(el));

/* ---------- hero typing ---------- */
loopPhrases($('#hero-type'), ['make me an app', 'build me a racing game', 'read the web first, then build', 'put it on my phone'], { hold: 1700, speed: 62 });

/* ---------- website names get their logo ---------- */
const SITES = ['claude.com', 'github.com', 'nvidia.com', 'godotengine.org', 'vercel.com', 'minecraft.com', 'youtube.com', 'google.com', 'wikipedia.org', 'microsoft.com', 'nasa.gov', 'v0.dev'];
function chip(domain) {
  const c = document.createElement('span');
  c.className = 'chip';
  c.innerHTML = `<img src="/img/logos/${domain}.png" alt="" width="22" height="22" decoding="async"><span></span>`;
  c.lastChild.textContent = domain;
  return c;
}
{
  const typed = $('#logo-type'), cloud = $('#logo-cloud');
  const run = async () => {
    for (;;) {
      cloud.replaceChildren();
      for (const d of SITES) {
        await typeInto(typed, d, { speed: 70 });
        await sleep(reduced ? 0 : 220);
        cloud.append(chip(d));
        typed.textContent = '';
        await sleep(reduced ? 0 : 140);
      }
      if (reduced) return;
      await sleep(3200);
    }
  };
  whenVisible($('#research'), run, { once: true, margin: '0px 0px -20% 0px' });
}

/* ---------- horizon hero ---------- */
{
  const imgs = $$('#hz-hero img');
  const words = ['drive anywhere', 'drift everything', 'hills · city · canyon', 'nine ways to ride'];
  let i = 0;
  const label = $('#hz-type');
  const rot = () => {
    imgs.forEach((im, k) => im.classList.toggle('on', k === i % imgs.length));
    typeInto(label, words[i % words.length], { speed: 50 });
    i += 1;
  };
  whenVisible($('#hz-hero'), () => { rot(); setInterval(rot, 4800); }, { once: true });
}

/* ---------- the three voices, with a transcript that types as it plays ---------- */
const TRACKS = [
  ['narration', 'Narration', 'The long-form workspace voice.'],
  ['voice_a', 'Voice A', 'A warmer read, for prompts and confirmations.'],
  ['voice_b', 'Voice B', 'The alternate read, selectable in Settings.'],
];
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const players = [];
fetch('/data/transcripts.json').then((r) => r.json()).then((data) => {
  $('#tx-about').textContent = data.about;
  const host = $('#voices');
  TRACKS.forEach(([id, title, sub], idx) => {
    const tr = data.tracks[id];
    const card = document.createElement('div');
    card.className = 'voice rv';
    card.style.setProperty('--d', `${idx * 0.08}s`);
    card.innerHTML = `
      <div class="top">
        <button class="play" aria-label="Play ${title}">▶</button>
        <div><h4></h4><p class="sub"></p></div>
        <div class="wave" aria-hidden="true">${'<i></i>'.repeat(14)}</div>
      </div>
      <div class="bar" role="slider" aria-label="${title} position" tabindex="0"><i></i></div>
      <div class="time"><span class="now">0:00</span><span class="len">${fmt(tr.duration)}</span></div>
      <div class="tx-box" aria-live="off"></div>
      <p class="wavlink"><a href="/voice/${id}.wav" download>⬇ ${id}.wav</a></p>
      <audio preload="metadata" src="/voice/${id}.wav"></audio>`;
    card.querySelector('h4').textContent = title;
    card.querySelector('.sub').textContent = sub;
    host.append(card);
    rv.observe(card);

    const audio = card.querySelector('audio');
    const btn = card.querySelector('.play');
    const barEl = card.querySelector('.bar');
    const fill = barEl.firstElementChild;
    const box = card.querySelector('.tx-box');
    const paras = tr.lines.map((l) => { const p = document.createElement('p'); p.textContent = l.text; box.append(p); return p; });
    const caret = document.createElement('span'); caret.className = 'caret';
    let live = false;
    const dur = () => (audio.duration && Number.isFinite(audio.duration) ? audio.duration : tr.duration);

    // Stateless: the text on screen is a pure function of the playhead, so seeking just works.
    const render = (t) => {
      const total = dur();
      tr.lines.forEach((l, i) => {
        const end = i + 1 < tr.lines.length ? tr.lines[i + 1].t : total;
        const p = paras[i];
        if (audio.ended || t >= end - 0.05) { p.textContent = l.text; p.className = 'seen'; return; }
        if (t < l.t) { p.textContent = ''; p.className = ''; return; }
        // type across 85% of the line's own time, so the last words land with the voice
        const k = Math.min(1, (t - l.t) / Math.max(0.5, (end - l.t) * 0.85));
        p.textContent = l.text.slice(0, Math.ceil(l.text.length * k));
        p.className = 'now';
        p.append(caret);
        if (live) box.scrollTop = Math.max(0, p.offsetTop - box.clientHeight * 0.6);
      });
      fill.style.transform = `scaleX(${Math.min(1, t / total)})`;
      card.querySelector('.now').textContent = fmt(t);
    };

    btn.addEventListener('click', () => (audio.paused ? audio.play() : audio.pause()));
    audio.addEventListener('play', () => {
      players.forEach((o) => { if (o !== audio) o.pause(); });
      live = true; card.classList.add('playing'); btn.textContent = '❚❚'; render(audio.currentTime);
    });
    audio.addEventListener('pause', () => { card.classList.remove('playing'); btn.textContent = '▶'; });
    audio.addEventListener('ended', () => { card.classList.remove('playing'); btn.textContent = '▶'; caret.remove(); render(total0(audio)); });
    audio.addEventListener('timeupdate', () => render(audio.currentTime));
    audio.addEventListener('seeked', () => render(audio.currentTime));
    barEl.addEventListener('click', (e) => {
      const r = barEl.getBoundingClientRect();
      audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur();
      live = true; render(audio.currentTime);
    });
    barEl.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') audio.currentTime += 5; if (e.key === 'ArrowLeft') audio.currentTime -= 5; });
    players.push(audio);
  });
}).catch(() => { $('#tx-about').textContent = 'The transcript could not be loaded — the recordings still play.'; });
const total0 = (a) => a.duration || 0;

/* ---------- the Chomugiri phone, built from HTML ---------- */
whenVisible($('#phone'), () => import('./demo.js').then((m) => m.start(root)), { once: true, margin: '0px 0px 0px 0px' });

/* ---------- solar system: load three.js only when it is near the screen ---------- */
whenVisible($('#space'), () => import('./space.js').then((m) => m.start()).catch((e) => {
  console.error(e);
  const l = $('#space-loading'); if (l) l.textContent = 'This device could not start 3D — the NASA data below still works.';
}), { once: true, margin: '0px 0px 600px 0px' });
import('./nasa-cards.js').then((m) => m.start());
