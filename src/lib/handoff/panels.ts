/**
 * Panels: small personal apps the user describes in a sentence ("a habit tracker", "my gym log") and the model writes as one HTML
 * file. A panel runs in a sandboxed iframe with no access to the app (opaque origin, strict CSP); it keeps its own data through a
 * tiny `panel` object whose changes are posted to the app and stored there. Pure helpers only; the UI and storage live elsewhere.
 */

export interface Panel {
  id: string;
  name: string;
  icon: string;
  html: string;
  state: Record<string, unknown>;
  prompt: string;
  createdAt: number;
  updatedAt: number;
  builtIn?: boolean;
}

export const MAX_STATE_BYTES = 200_000;

export const PANEL_SYSTEM = `You build "panels": small, beautiful personal mini-apps that run inside a phone app.
Reply with ONE complete HTML file in a single \`\`\`html code block and nothing else.

Rules
- Self-contained: inline <style> and <script> only. No external scripts, fonts, frameworks or CDNs (they are blocked). System fonts only.
- Mobile-first for a 360–420 px wide screen: big tap targets (≥44 px), no horizontal scroll, readable 15–17 px text. Works in light and dark (prefers-color-scheme).
- Premium look: generous spacing, rounded cards, one accent colour, subtle shadows, smooth small transitions. No lorem ipsum.
- Saving data: use the global \`panel\` object, never localStorage or cookies (they are blocked):
  panel.get(key, fallback) → value · panel.set(key, value) → saves (JSON-serialisable values, keep it small) · panel.all() → everything.
  Read saved data at start-up and render it, so the panel shows the same thing next time it opens.
- Network: fetch() only to public HTTPS JSON APIs that need no key (e.g. api.open-meteo.com for weather, api.coingecko.com). Show a friendly message if it fails. Never ask for passwords or payment details.
- Everything must work offline except those optional fetches.`;

export function panelPrompt(description: string, current?: string): string {
  return current
    ? `Change this panel as asked, keep its saved-data keys compatible, and return the whole new file.\n\nChange: ${description}\n\nCurrent file:\n\`\`\`html\n${current}\n\`\`\``
    : `Build this panel: ${description}`;
}

/** The HTML file in a model reply. */
export function extractHtml(reply: string): string | null {
  const fenced = /```(?:html)?\s*\n([\s\S]*?)```/i.exec(reply);
  const body = (fenced ? fenced[1]! : reply).trim();
  if (/<(html|body|div|main|section|script|style)\b/i.test(body)) return body;
  return null;
}

/** A name and icon guessed from the user's words, before the model answers. */
export function nameFrom(description: string): { name: string; icon: string } {
  const d = description.toLowerCase();
  const icons: Array<[RegExp, string]> = [[/habit|streak/, '🔥'], [/gym|workout|exercise|fitness/, '🏋️'], [/expense|money|budget|spend|kharch/, '💰'], [/water|drink/, '💧'], [/weather|mausam/, '⛅'], [/timer|pomodoro|focus/, '⏱'], [/note|journal|diary/, '📓'], [/todo|task|kaam/, '✅'], [/read|book/, '📚'], [/count ?down|exam|birthday/, '⏳'], [/mood/, '🙂'], [/crypto|stock|price/, '📈'], [/recipe|food|diet|calorie/, '🥗'], [/study|flash ?card|learn/, '🧠']];
  const icon = icons.find(([r]) => r.test(d))?.[1] ?? '✦';
  const words = description.replace(/^(make|build|create|banao|bana do|ek)\s+/i, '').replace(/\b(a|an|the|me|for|my|please|mujhe|mere|liye)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  const name = words.split(' ').slice(0, 4).join(' ').replace(/^./, (c) => c.toUpperCase()) || 'My panel';
  return { name: name.slice(0, 32), icon };
}

const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob: https:; media-src data: blob: https:; font-src data:; connect-src https:; form-action 'none'; base-uri 'none'";

/** JSON safe to put inside a <script> element. */
export function scriptJson(v: unknown): string {
  return JSON.stringify(v ?? {}).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** The document an iframe shows: CSP + the `panel` storage shim + the panel's own HTML. */
export function panelDocument(p: Pick<Panel, 'id' | 'html' | 'state'>): string {
  const shim = `<script>window.panel=(function(){var s=${scriptJson(p.state)};var id=${scriptJson(p.id)};var t=null;function save(){clearTimeout(t);t=setTimeout(function(){try{parent.postMessage({panelSave:true,id:id,state:s},'*')}catch(e){}},150)}return{get:function(k,d){return Object.prototype.hasOwnProperty.call(s,k)?s[k]:d},set:function(k,v){s[k]=v;save();return v},remove:function(k){delete s[k];save()},all:function(){return JSON.parse(JSON.stringify(s))}}})();</script>`;
  const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><meta name="viewport" content="width=device-width,initial-scale=1">${shim}`;
  const html = p.html;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${head}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${head}</head>`);
  return `<!doctype html><html><head>${head}</head><body>${html}</body></html>`;
}

/** A state message from a panel iframe, checked: right panel, a plain object, not too big. */
export function acceptState(msg: unknown, id: string): Record<string, unknown> | null {
  if (!msg || typeof msg !== 'object') return null;
  const m = msg as { panelSave?: unknown; id?: unknown; state?: unknown };
  if (m.panelSave !== true || m.id !== id || !m.state || typeof m.state !== 'object' || Array.isArray(m.state)) return null;
  let size = 0;
  try { size = JSON.stringify(m.state).length; } catch { return null; }
  return size <= MAX_STATE_BYTES ? (m.state as Record<string, unknown>) : null;
}

export const newPanelId = (): string => `pnl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ── built-in panels (hand-written, so the gallery is useful before any model call) ──

const BASE_CSS = `:root{--bg:#f7f6f3;--card:#fff;--ink:#1d1b18;--dim:#6f6a62;--line:#e6e2da;--acc:#d9622b}@media (prefers-color-scheme:dark){:root{--bg:#141311;--card:#1e1c19;--ink:#f1ede6;--dim:#a39d92;--line:#2e2b27}}*{box-sizing:border-box}body{margin:0;font:16px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink);padding:16px}h1{font-size:20px;margin:4px 0 14px}.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:14px;margin-bottom:12px;box-shadow:0 6px 20px -14px rgba(0,0,0,.35)}button{font:inherit;border:0;border-radius:12px;min-height:44px;padding:0 14px;background:var(--acc);color:#fff;font-weight:600;cursor:pointer}button.ghost{background:transparent;color:var(--dim);border:1px solid var(--line)}input{font:inherit;width:100%;min-height:44px;border-radius:12px;border:1px solid var(--line);background:transparent;color:var(--ink);padding:0 12px}.row{display:flex;gap:8px;align-items:center}.dim{color:var(--dim);font-size:13px}`;

const HABITS = `<!doctype html><html><head><style>${BASE_CSS}.h{display:flex;align-items:center;gap:10px}.h b{flex:1}.dots{display:flex;gap:4px;margin-top:8px}.d{width:22px;height:22px;border-radius:7px;background:var(--line)}.d.on{background:var(--acc)}.fire{font-size:13px;color:var(--acc);font-weight:700}</style></head><body><h1>🔥 Habits</h1><div class="card row"><input id="n" placeholder="New habit, e.g. Read 10 pages"><button id="a">Add</button></div><div id="l"></div><script>
var habits=panel.get('habits',[{name:'Drink 8 glasses of water',days:{}},{name:'Walk 20 minutes',days:{}}]);
function key(d){return d.toISOString().slice(0,10)}
function streak(h){var n=0,d=new Date();while(h.days[key(d)]){n++;d.setDate(d.getDate()-1)}return n}
function draw(){var l=document.getElementById('l');l.innerHTML='';habits.forEach(function(h,i){var c=document.createElement('div');c.className='card';var today=key(new Date());var dots='';for(var k=6;k>=0;k--){var d=new Date();d.setDate(d.getDate()-k);dots+='<span class="d'+(h.days[key(d)]?' on':'')+'"></span>'}
c.innerHTML='<div class="h"><b></b><span class="fire">'+streak(h)+' 🔥</span><button class="'+(h.days[today]?'':'ghost')+'">'+(h.days[today]?'Done ✓':'Mark')+'</button></div><div class="dots">'+dots+'</div>';c.querySelector('b').textContent=h.name;
c.querySelector('button').onclick=function(){if(h.days[today])delete h.days[today];else h.days[today]=1;panel.set('habits',habits);draw()};
c.querySelector('b').ondblclick=function(){if(confirm('Delete this habit?')){habits.splice(i,1);panel.set('habits',habits);draw()}};l.appendChild(c)})}
document.getElementById('a').onclick=function(){var v=document.getElementById('n').value.trim();if(!v)return;habits.push({name:v,days:{}});document.getElementById('n').value='';panel.set('habits',habits);draw()};draw();
</script><p class="dim">Double-tap a habit's name to delete it.</p></body></html>`;

const FOCUS = `<!doctype html><html><head><style>${BASE_CSS}.t{font-size:64px;font-weight:700;text-align:center;font-variant-numeric:tabular-nums;margin:10px 0}.ring{width:220px;height:220px;margin:8px auto;border-radius:50%;display:grid;place-items:center;background:conic-gradient(var(--acc) var(--p,0%),var(--line) 0)}.in{width:190px;height:190px;border-radius:50%;background:var(--card);display:grid;place-items:center}.seg{display:flex;gap:6px;justify-content:center;margin:10px 0}</style></head><body><h1>⏱ Focus</h1><div class="card"><div class="seg"><button class="ghost" data-m="25">25 min</button><button class="ghost" data-m="50">50 min</button><button class="ghost" data-m="5">Break 5</button></div><div class="ring" id="r"><div class="in"><div class="t" id="t">25:00</div></div></div><div class="row" style="justify-content:center"><button id="go">Start</button><button class="ghost" id="rs">Reset</button></div></div><div class="card"><b>Today</b><div class="dim" id="s"></div></div><script>
var total=25*60,left=total,timer=null;var log=panel.get('log',{});function today(){return new Date().toISOString().slice(0,10)}
function show(){var m=Math.floor(left/60),s=left%60;document.getElementById('t').textContent=(m<10?'0':'')+m+':'+(s<10?'0':'')+s;document.getElementById('r').style.setProperty('--p',(100-left/total*100)+'%');document.getElementById('s').textContent=(log[today()]||0)+' focus sessions finished'}
function tick(){left--;if(left<=0){clearInterval(timer);timer=null;left=0;if(total>=25*60){log[today()]=(log[today()]||0)+1;panel.set('log',log)}document.getElementById('go').textContent='Start';try{navigator.vibrate&&navigator.vibrate(400)}catch(e){}}show()}
document.getElementById('go').onclick=function(){if(timer){clearInterval(timer);timer=null;this.textContent='Start'}else{if(left<=0)left=total;timer=setInterval(tick,1000);this.textContent='Pause'}};
document.getElementById('rs').onclick=function(){clearInterval(timer);timer=null;left=total;document.getElementById('go').textContent='Start';show()};
document.querySelectorAll('[data-m]').forEach(function(b){b.onclick=function(){clearInterval(timer);timer=null;total=left=b.dataset.m*60;document.getElementById('go').textContent='Start';show()}});show();
</script></body></html>`;

const EXPENSES = `<!doctype html><html><head><style>${BASE_CSS}.sum{font-size:30px;font-weight:700}.it{display:flex;justify-content:space-between;padding:10px 0;border-top:1px solid var(--line)}.it:first-child{border-top:0}.cat{font-size:12px;color:var(--dim)}</style></head><body><h1>💰 Expenses</h1><div class="card"><div class="dim">This month</div><div class="sum" id="sum">₹0</div><div class="dim" id="by"></div></div><div class="card"><div class="row"><input id="w" placeholder="What (e.g. Chai)"><input id="m" type="number" inputmode="decimal" placeholder="₹" style="max-width:96px"></div><div class="row" style="margin-top:8px"><input id="c" placeholder="Category (food, travel…)"><button id="add">Add</button></div></div><div class="card" id="list"></div><script>
var items=panel.get('items',[]);function month(){return new Date().toISOString().slice(0,7)}
function draw(){var mine=items.filter(function(i){return i.d.slice(0,7)===month()});var t=0,by={};mine.forEach(function(i){t+=i.m;by[i.c]=(by[i.c]||0)+i.m});
document.getElementById('sum').textContent='₹'+t.toLocaleString('en-IN');document.getElementById('by').textContent=Object.keys(by).map(function(k){return k+' ₹'+by[k].toLocaleString('en-IN')}).join(' · ');
var l=document.getElementById('list');l.innerHTML=mine.length?'':'<div class="dim">Nothing yet this month.</div>';mine.slice().reverse().slice(0,40).forEach(function(i){var r=document.createElement('div');r.className='it';r.innerHTML='<div><div class="w"></div><div class="cat"></div></div><b></b>';r.querySelector('.w').textContent=i.w;r.querySelector('.cat').textContent=i.c+' · '+i.d.slice(5);r.querySelector('b').textContent='₹'+i.m.toLocaleString('en-IN');l.appendChild(r)})}
document.getElementById('add').onclick=function(){var w=document.getElementById('w').value.trim(),m=parseFloat(document.getElementById('m').value),c=document.getElementById('c').value.trim()||'other';if(!w||!(m>0))return;items.push({w:w,m:m,c:c.toLowerCase(),d:new Date().toISOString().slice(0,10)});panel.set('items',items);['w','m'].forEach(function(id){document.getElementById(id).value=''});draw()};draw();
</script></body></html>`;

const COUNTDOWN = `<!doctype html><html><head><style>${BASE_CSS}.big{font-size:44px;font-weight:800;color:var(--acc)}.ev{display:flex;justify-content:space-between;align-items:center}</style></head><body><h1>⏳ Countdowns</h1><div class="card"><input id="n" placeholder="Event (e.g. Board exam)"><div class="row" style="margin-top:8px"><input id="d" type="date"><button id="a">Add</button></div></div><div id="l"></div><script>
var evs=panel.get('events',[]);function days(s){var t=new Date(s+'T00:00:00'),n=new Date();n.setHours(0,0,0,0);return Math.round((t-n)/864e5)}
function draw(){var l=document.getElementById('l');l.innerHTML='';evs.slice().sort(function(a,b){return a.d<b.d?-1:1}).forEach(function(e){var c=document.createElement('div');c.className='card ev';var k=days(e.d);c.innerHTML='<div><b></b><div class="dim"></div></div><div class="big"></div>';c.querySelector('b').textContent=e.n;c.querySelector('.dim').textContent=e.d+(k<0?' · passed':'');c.querySelector('.big').textContent=k<0?'✓':k+'d';c.ondblclick=function(){evs=evs.filter(function(x){return x!==e});panel.set('events',evs);draw()};l.appendChild(c)})}
document.getElementById('a').onclick=function(){var n=document.getElementById('n').value.trim(),d=document.getElementById('d').value;if(!n||!d)return;evs.push({n:n,d:d});panel.set('events',evs);document.getElementById('n').value='';draw()};draw();
</script><p class="dim">Double-tap an event to delete it.</p></body></html>`;

export const BUILT_IN_PANELS: Panel[] = [
  { id: 'builtin-habits', name: 'Habits', icon: '🔥', html: HABITS, state: {}, prompt: 'A habit tracker with streaks', createdAt: 0, updatedAt: 0, builtIn: true },
  { id: 'builtin-focus', name: 'Focus timer', icon: '⏱', html: FOCUS, state: {}, prompt: 'A pomodoro focus timer', createdAt: 0, updatedAt: 0, builtIn: true },
  { id: 'builtin-expenses', name: 'Expenses', icon: '💰', html: EXPENSES, state: {}, prompt: 'A monthly expense log in rupees', createdAt: 0, updatedAt: 0, builtIn: true },
  { id: 'builtin-countdown', name: 'Countdowns', icon: '⏳', html: COUNTDOWN, state: {}, prompt: 'Countdowns to important dates', createdAt: 0, updatedAt: 0, builtIn: true },
];
