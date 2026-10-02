/**
 * The NASA cards under the sky: asteroids, Earth photos, picture of the day, and the
 * check against JPL Horizons. Everything goes through our own /api/nasa — the page never
 * holds a key, and never talks to NASA's key-bearing API itself.
 */
import { PLANET_IDS, centuries, planetPosition } from './ephemeris.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** AbortSignal.timeout is missing from older phone browsers; this works everywhere. */
const timeoutSignal = (ms) => {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
};

export async function nasa(kind, params = {}) {
  const res = await fetch(`/api/nasa?${new URLSearchParams({ kind, ...params })}`, { signal: timeoutSignal(25000) });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) throw new Error(json?.error || `HTTP ${res.status}`);
  return json;
}

const failure = (el, what, retry) => {
  el.innerHTML = `<p class="err">NASA’s ${esc(what)} service did not answer just now — it does that sometimes. <button class="chipbtn" type="button">Try again</button></p>`;
  el.querySelector('button').addEventListener('click', retry);
};

/* ---------- near-Earth asteroids ---------- */
async function neo() {
  const el = $('#neo-out');
  try {
    const { data, stale } = await nasa('neo');
    const list = data.objects;
    const near = [...list].sort((a, b) => a.missKm - b.missKm).slice(0, 8);
    const closest = near[0];
    const haz = list.filter((o) => o.hazardous).length;
    el.innerHTML = `
      <p style="font-size:14.5px"><strong>${list.length}</strong> asteroids pass Earth in the next 7 days${haz ? `, <span class="haz">${haz} flagged “potentially hazardous”</span> (that is a size-and-orbit label, not a warning)` : ''}.
      ${closest ? `Closest: <strong>${esc(closest.name)}</strong> at <strong>${closest.missLunar.toFixed(1)}×</strong> the Moon’s distance.` : ''}${stale ? ' <em>(showing the last copy NASA gave us)</em>' : ''}</p>
      <div class="neo-wrap"><table class="neo"><thead><tr><th>Rock</th><th>When (UT)</th><th>Miss</th><th>Speed</th><th>Size</th></tr></thead><tbody>
      ${near.map((o) => `<tr><td>${o.url ? `<a href="${esc(o.url)}" rel="noopener" target="_blank">${esc(o.name)}</a>` : esc(o.name)}${o.hazardous ? ' <span class="haz">!</span>' : ''}</td>
        <td>${esc(o.when.replace(/^\d{4}-/, ''))}</td><td>${o.missLunar.toFixed(1)} LD<br>${(o.missKm / 1e6).toFixed(2)} M km</td><td>${o.speedKms.toFixed(1)} km/s</td><td>${o.diameterM[0]}–${o.diameterM[1]} m</td></tr>`).join('')}
      </tbody></table></div>
      <p style="font-size:12px;color:#6f7f9d;margin:10px 0 0">LD = lunar distance, 384,400 km — the gap from Earth to the Moon. Eight closest of the week shown.</p>`;
  } catch { failure(el, 'asteroid', neo); }
}

/* ---------- EPIC ---------- */
async function epic() {
  const el = $('#epic-out');
  try {
    const { data } = await nasa('epic');
    if (!data.frames.length) throw new Error('none');
    el.innerHTML = `<div class="epic-row">${data.frames.map((f) => `<figure><img src="${esc(f.image)}" alt="Earth seen from the DSCOVR satellite, ${esc(f.date)} UT" loading="lazy" referrerpolicy="no-referrer"><figcaption>${esc(f.date.replace(' ', ' · '))} UT${f.lat != null ? `<br>centre ${Number(f.lat).toFixed(0)}°, ${Number(f.lon).toFixed(0)}°` : ''}</figcaption></figure>`).join('')}</div>
      <p style="font-size:12.5px;color:#8693ae;margin:10px 0 0">The DSCOVR satellite sits about 1.5 million km from Earth, always looking at the sunlit side. These are its newest frames.</p>`;
  } catch { failure(el, 'Earth-photo', epic); }
}

/* ---------- APOD ---------- */
async function apod(tries = 0) {
  const el = $('#apod-out');
  try {
    const { data } = await nasa('apod');
    const src = data.media === 'image' ? data.url : data.thumb;
    const short = data.explanation.length > 520 ? `${data.explanation.slice(0, 520).replace(/\s+\S*$/, '')}…` : data.explanation;
    const open = data.link || data.hdurl || src;
    el.innerHTML = `<div class="apod">
      ${src ? `<a href="${esc(open)}" rel="noopener" target="_blank" class="apod-pic"><img class="apod-img" src="${esc(src)}" alt="${esc(data.title)}" loading="lazy" referrerpolicy="no-referrer"></a>` : ''}
      <div><strong style="color:#fff;font-size:18px">${esc(data.title)}</strong> <span style="color:#6f7f9d;font:12px var(--font-mono)">${esc(data.date)}</span>
      <p style="font-size:14.5px;margin:8px 0 0">${esc(short)}</p>
      ${open ? `<p style="margin:6px 0 0"><a href="${esc(open)}" rel="noopener" target="_blank">${data.media === 'video' ? 'Watch today’s video' : 'Read the full story and zoom in'} on NASA ↗</a></p>` : ''}
      ${data.copyright ? `<p style="font-size:12px;color:#6f7f9d">Image credit: ${esc(data.copyright)} (not public domain — shown with credit as NASA publishes it)</p>` : ''}</div></div>`;
    // A stand-in banner (a logo, say) is much wider than any photograph; never show a thin strip as the picture.
    const img = el.querySelector('img');
    if (img) {
      const check = () => { if (img.naturalHeight && img.naturalWidth / img.naturalHeight > 3) img.closest('.apod-pic').remove(); };
      img.addEventListener('load', check);
      img.addEventListener('error', () => img.closest('.apod-pic')?.remove());
      if (img.complete) check();
    }
  } catch {
    if (tries < 1) { await new Promise((r) => setTimeout(r, 4000)); return apod(tries + 1); }
    failure(el, 'picture-of-the-day', () => apod(0));
  }
}

/* ---------- check our planets against JPL Horizons ---------- */
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y + a.z * b.z) / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z))))) * (180 / Math.PI) * 60;
async function check() {
  const out = $('#check-out'), btn = $('#check-run');
  const date = $('#sp-date').value || new Date().toISOString().slice(0, 10);
  btn.disabled = true; btn.textContent = 'Asking JPL…';
  out.innerHTML = `<div class="ln"><b>${esc(date)}</b><span>00:00 UT, heliocentric, J2000 ecliptic</span></div>`;
  const T = centuries(new Date(`${date}T00:00:00Z`));
  const queue = [...PLANET_IDS];
  const worker = async () => {
    for (let id; (id = queue.shift());) {
      const row = document.createElement('div'); row.className = 'ln'; row.innerHTML = `<b>${esc(id)}</b><span>asking…</span>`; out.append(row);
      try {
        const { data } = await nasa('horizons', { body: id, date });
        if (!data) throw new Error('no data');
        const ours = planetPosition(id, T);
        const arcmin = angle(ours, data);
        const dist = Math.abs(Math.hypot(ours.x, ours.y, ours.z) / Math.hypot(data.x, data.y, data.z) - 1) * 100;
        row.innerHTML = `<b>${esc(id)}</b><span><span class="ok">Δ ${arcmin.toFixed(1)}′</span> in direction · ${dist.toFixed(3)}% in distance</span>`;
      } catch (e) { row.innerHTML = `<b>${esc(id)}</b><span>JPL did not answer (${esc(e.message)})</span>`; }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  const note = document.createElement('div'); note.className = 'ln'; note.innerHTML = '<b>note</b><span>1′ = one sixtieth of a degree — the Moon is about 31′ wide in the sky. JPL says these formulas are good to a few arc-minutes.</span>';
  out.append(note);
  btn.disabled = false; btn.textContent = 'Compare again';
}

export function start() {
  $('#check-run').addEventListener('click', check);
  // Only ask NASA when the cards come near the screen — a visitor who never scrolls this far costs nothing.
  const lazy = (sel, fn) => new IntersectionObserver((es, io) => { if (es[0].isIntersecting) { io.disconnect(); fn(); } }, { rootMargin: '400px' }).observe($(sel));
  lazy('#c-neo', neo); lazy('#c-epic', epic); lazy('#c-apod', apod);
}
