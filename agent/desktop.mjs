/**
 * Desktop control for the bridge ("computer use"): look at the screen and drive the mouse and keyboard of a Linux desktop.
 *
 * It uses what every X11 box has — `xdotool` for input and one screenshot tool (ImageMagick `import`, `scrot` or `maim`) — and
 * can start a PRIVATE virtual display (Xvfb) so the agent works on its own empty screen instead of yours. That is the safe default
 * for a server or a phone-driven session; point it at your real desktop only by setting DISPLAY yourself.
 *
 * Every call is one action → { ok, text, image? } where `image` is the name of a PNG saved in the bridge's artifacts. Coordinates
 * the model sees are those of the screenshot (never wider than SHOT_WIDTH); this module scales them back to the real screen.
 * Nothing goes through a shell: arguments are passed as arrays, text and key names are validated.
 *
 * Zero dependencies, like the rest of the agent.
 */
import { spawn } from 'node:child_process';
import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

export const SHOT_WIDTH = 1280;
const CALL_MS = 30_000;
const KEY_RE = /^[A-Za-z0-9_+\-]+(?: [A-Za-z0-9_+\-]+){0,7}$/;
const SIZE_RE = /^(\d{3,4})x(\d{3,4})$/;

function run(cmd, args, { env, timeoutMs = CALL_MS, input } = {}) {
  return new Promise((resolve) => {
    let out = '', err = '', done = false;
    let child;
    try { child = spawn(cmd, args, { env, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] }); } catch (e) { return resolve({ code: 127, out: '', err: e.message }); }
    const timer = setTimeout(() => { if (!done) { child.kill('SIGKILL'); } }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    child.on('error', (e) => { done = true; clearTimeout(timer); resolve({ code: 127, out, err: e.code === 'ENOENT' ? `${cmd}: not installed` : e.message }); });
    child.on('close', (code) => { done = true; clearTimeout(timer); resolve({ code: code ?? 1, out, err }); });
    if (input) child.stdin.end(input);
  });
}

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v))));
const isNum = (v) => Number.isFinite(Number(v));

export function createDesktop({ outDir, env = process.env }) {
  let display = env.DISPLAY || '';
  let own = null; // our Xvfb child
  let scale = 1;
  let shotN = 0;

  const xenv = () => ({ ...process.env, ...(display ? { DISPLAY: display } : {}) });

  async function geometry() {
    const r = await run('xdotool', ['getdisplaygeometry'], { env: xenv(), timeoutMs: 5000 });
    if (r.code !== 0) return null;
    const m = /^(\d+)\s+(\d+)/.exec(r.out.trim());
    return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
  }

  async function tools() {
    const have = {};
    for (const t of ['xdotool', 'import', 'scrot', 'maim', 'Xvfb']) {
      const r = await run('which', [t], { timeoutMs: 3000 });
      have[t] = r.code === 0;
    }
    return have;
  }

  async function startDisplay(size = '1280x800') {
    if (own) return { ok: true, text: `Private display ${display} is already running.` };
    const m = SIZE_RE.exec(String(size));
    if (!m) return { ok: false, text: 'size must look like 1280x800.' };
    const have = await tools();
    if (!have.Xvfb) return { ok: false, text: 'Xvfb is not installed (Debian/Ubuntu: sudo apt install xvfb xdotool imagemagick).' };
    const num = 90 + Math.floor(Math.random() * 9);
    const d = `:${num}`;
    const child = spawn('Xvfb', [d, '-screen', '0', `${m[1]}x${m[2]}x24`, '-nolisten', 'tcp'], { stdio: 'ignore' });
    child.on('close', () => { if (own === child) { own = null; display = env.DISPLAY || ''; } });
    own = child;
    display = d;
    await new Promise((r) => setTimeout(r, 900));
    const g = await geometry();
    if (!g) { child.kill(); own = null; display = env.DISPLAY || ''; return { ok: false, text: 'The virtual display did not start.' }; }
    return { ok: true, text: `Started a private screen ${d} (${g.w}x${g.h}). Nothing is on it yet: open an app with the launch action.` };
  }

  async function stopDisplay() {
    if (!own) return { ok: true, text: 'No private display was running.' };
    own.kill();
    own = null;
    display = env.DISPLAY || '';
    return { ok: true, text: 'Private display stopped.' };
  }

  async function shot() {
    if (!display) return { ok: false, text: 'There is no screen to look at. Start a private display first (action "start"), or run the bridge on a machine with a desktop (DISPLAY).' };
    const g = await geometry();
    if (!g) return { ok: false, text: `Cannot reach the screen ${display}. Is it running, and is xdotool installed?` };
    await mkdir(outDir, { recursive: true });
    const name = `screen-${Date.now()}-${++shotN}.png`;
    const file = path.join(outDir, name);
    scale = Math.min(1, SHOT_WIDTH / g.w);
    const pct = `${Math.round(scale * 100)}%`;
    const have = await tools();
    let r;
    if (have.import) r = await run('import', ['-window', 'root', ...(scale < 1 ? ['-resize', pct] : []), file], { env: xenv() });
    else if (have.scrot) r = await run('scrot', ['-o', file], { env: xenv() });
    else if (have.maim) r = await run('maim', [file], { env: xenv() });
    else return { ok: false, text: 'No screenshot tool found. Install ImageMagick (sudo apt install imagemagick) or scrot.' };
    if (r.code !== 0) return { ok: false, text: `Screenshot failed: ${r.err.trim().split('\n').slice(-1)[0] || `exit ${r.code}`}` };
    const w = Math.round(g.w * scale), h = Math.round(g.h * scale);
    // keep the folder from filling up: only the 30 newest screen shots stay
    try {
      const old = (await readdir(outDir)).filter((f) => /^screen-\d+-\d+\.png$/.test(f)).sort();
      for (const f of old.slice(0, Math.max(0, old.length - 30))) await rm(path.join(outDir, f), { force: true });
    } catch { /* ignore */ }
    return { ok: true, image: name, width: w, height: h, text: `Screenshot ${w}x${h}. Coordinates you give are pixels in this picture, from the top-left corner.` };
  }

  const real = (v) => Math.round(Number(v) / scale);
  async function xd(args) {
    const r = await run('xdotool', args, { env: xenv() });
    return r.code === 0 ? null : r.err.trim().split('\n').slice(-1)[0] || `xdotool exit ${r.code}`;
  }
  const needXY = (a, ...keys) => (keys.every((k) => isNum(a[k])) ? null : { ok: false, text: `${keys.join(', ')} must be numbers (pixels in the screenshot).` });

  async function call(action, a = {}) {
    const act = String(action ?? '').toLowerCase();
    if (act === 'info') {
      const have = await tools();
      const g = display ? await geometry() : null;
      return { ok: true, text: `display: ${display || '(none)'}${own ? ' (private)' : ''}\nscreen: ${g ? `${g.w}x${g.h}` : 'not reachable'}\ntools: ${Object.entries(have).map(([k, v]) => `${k}=${v ? 'yes' : 'no'}`).join(' ')}` };
    }
    if (act === 'start') return startDisplay(a.size);
    if (act === 'stop') return stopDisplay();
    if (act === 'shot' || act === 'screenshot' || act === 'look') return shot();
    if (!display) return { ok: false, text: 'There is no screen. Run the "start" action first (a private display), or run the bridge on a desktop.' };
    if (!scale || scale === 1) { const g = await geometry(); if (g) scale = Math.min(1, SHOT_WIDTH / g.w); }

    switch (act) {
      case 'move': {
        const bad = needXY(a, 'x', 'y'); if (bad) return bad;
        const e = await xd(['mousemove', String(real(a.x)), String(real(a.y))]);
        return e ? { ok: false, text: e } : { ok: true, text: `Moved the pointer to ${a.x},${a.y}.` };
      }
      case 'click': case 'double_click': case 'right_click': case 'middle_click': {
        const bad = needXY(a, 'x', 'y'); if (bad) return bad;
        const button = act === 'right_click' ? 3 : act === 'middle_click' ? 2 : 1;
        const times = act === 'double_click' ? 2 : 1;
        const e = await xd(['mousemove', String(real(a.x)), String(real(a.y)), 'click', '--repeat', String(times), '--delay', '80', String(button)]);
        return e ? { ok: false, text: e } : { ok: true, text: `${act.replace('_', ' ')} at ${a.x},${a.y}.` };
      }
      case 'drag': {
        const bad = needXY(a, 'x', 'y', 'x2', 'y2'); if (bad) return bad;
        const e = await xd(['mousemove', String(real(a.x)), String(real(a.y)), 'mousedown', '1', 'mousemove', String(real(a.x2)), String(real(a.y2)), 'mouseup', '1']);
        return e ? { ok: false, text: e } : { ok: true, text: `Dragged ${a.x},${a.y} → ${a.x2},${a.y2}.` };
      }
      case 'type': {
        const text = String(a.text ?? '');
        if (!text) return { ok: false, text: 'text is empty.' };
        if (text.length > 2000) return { ok: false, text: 'text is longer than 2000 characters; type it in parts.' };
        const e = await xd(['type', '--delay', '18', '--clearmodifiers', '--', text]);
        return e ? { ok: false, text: e } : { ok: true, text: `Typed ${text.length} characters.` };
      }
      case 'key': {
        const k = String(a.key ?? '').trim();
        if (!KEY_RE.test(k)) return { ok: false, text: 'key must be names like Return, ctrl+l, alt+Tab, or several separated by spaces.' };
        const e = await xd(['key', '--clearmodifiers', ...k.split(' ')]);
        return e ? { ok: false, text: e } : { ok: true, text: `Pressed ${k}.` };
      }
      case 'scroll': {
        const dir = String(a.direction ?? 'down').toLowerCase();
        const btn = { up: 4, down: 5, left: 6, right: 7 }[dir];
        if (!btn) return { ok: false, text: 'direction must be up, down, left or right.' };
        const n = clampInt(isNum(a.amount) ? a.amount : 5, 1, 30);
        if (isNum(a.x) && isNum(a.y)) await xd(['mousemove', String(real(a.x)), String(real(a.y))]);
        const e = await xd(['click', '--repeat', String(n), '--delay', '30', String(btn)]);
        return e ? { ok: false, text: e } : { ok: true, text: `Scrolled ${dir} ${n}.` };
      }
      case 'launch': {
        const argv = Array.isArray(a.argv) ? a.argv.map(String) : String(a.cmd ?? '').trim().split(/\s+/).filter(Boolean);
        if (!argv.length || argv[0].length > 200 || /[;&|`$<>]/.test(argv.join(' '))) return { ok: false, text: 'launch needs a program and plain arguments, e.g. {"argv":["chromium","--no-sandbox","https://example.com"]}.' };
        return await new Promise((resolve) => {
          let c;
          try { c = spawn(argv[0], argv.slice(1), { env: xenv(), stdio: 'ignore', detached: true }); } catch (e) { return resolve({ ok: false, text: e.message }); }
          c.on('error', (e) => resolve({ ok: false, text: e.code === 'ENOENT' ? `${argv[0]} is not installed.` : e.message }));
          c.unref();
          setTimeout(() => resolve({ ok: true, text: `Started ${argv[0]}. Wait a second or two, then take a screenshot.` }), 700);
        });
      }
      case 'wait': {
        const s = clampInt(isNum(a.seconds) ? a.seconds : 1, 1, 30);
        await new Promise((r) => setTimeout(r, s * 1000));
        return { ok: true, text: `Waited ${s}s.` };
      }
      default:
        return { ok: false, text: `unknown desktop action "${act}". Actions: info start stop shot move click double_click right_click drag type key scroll launch wait.` };
    }
  }

  return { call, close: () => stopDisplay(), get display() { return display; } };
}

// ── command line (inside a bridge command) ──────────────────────────────────

export const DESKTOP_HELP = `desktop — look at and drive a Linux screen (computer use)
  desktop start [1280x800]           start a private virtual screen (safe: your own desktop is untouched)
  desktop shot                       screenshot (saved as an artifact; coordinates are pixels in that picture)
  desktop click <x> <y>              also: double <x> <y>, right <x> <y>, move <x> <y>
  desktop drag <x> <y> <x2> <y2>
  desktop type <text…>               type text into the focused window
  desktop key <combo…>               e.g. Return, ctrl+l, alt+Tab
  desktop scroll <up|down|left|right> [amount]
  desktop launch <program> [args…]   start an app on the screen
  desktop wait <seconds>             desktop info | stop
`;

export function parseDesktop(argv) {
  const [verb = 'help', ...w] = argv;
  switch (verb.toLowerCase()) {
    case 'help': case '-h': case '--help': return { local: 'help' };
    case 'start': return { action: 'start', args: { size: w[0] } };
    case 'stop': case 'info': case 'shot': case 'screenshot': case 'look': return { action: verb.toLowerCase(), args: {} };
    case 'click': case 'move': return { action: verb.toLowerCase(), args: { x: w[0], y: w[1] } };
    case 'double': case 'double_click': return { action: 'double_click', args: { x: w[0], y: w[1] } };
    case 'right': case 'right_click': return { action: 'right_click', args: { x: w[0], y: w[1] } };
    case 'drag': return { action: 'drag', args: { x: w[0], y: w[1], x2: w[2], y2: w[3] } };
    case 'type': return { action: 'type', args: { text: w.join(' ') } };
    case 'key': return { action: 'key', args: { key: w.join(' ') } };
    case 'scroll': return { action: 'scroll', args: { direction: w[0], amount: w[1] } };
    case 'launch': return { action: 'launch', args: { argv: w } };
    case 'wait': return { action: 'wait', args: { seconds: w[0] } };
    default: return { error: `unknown desktop command "${verb}". Run: desktop help` };
  }
}

export async function desktopCli(argv, env = process.env) {
  const p = parseDesktop(argv);
  if (p.local === 'help') { process.stdout.write(DESKTOP_HELP); return 0; }
  if (p.error) { process.stderr.write(`${p.error}\n`); return 2; }
  const base = env.CHOMUGIRI_BRIDGE_URL, token = env.CHOMUGIRI_BRIDGE_TOKEN;
  if (!base || !token) { process.stderr.write('desktop only works inside a bridge command (CHOMUGIRI_BRIDGE_URL is not set).\n'); return 2; }
  try {
    const res = await fetch(`${base}/v1/desktop`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: p.action, ...p.args }), signal: AbortSignal.timeout(60_000) });
    const data = await res.json();
    if (!res.ok) { process.stderr.write(`${data.error ?? `bridge answered ${res.status}`}\n`); return 1; }
    process.stdout.write(`${data.text ?? ''}${data.image ? `\n[${data.image}](${data.image}) — download: /v1/artifact/${encodeURIComponent(data.image)}` : ''}\n`);
    return data.ok === false ? 1 : 0;
  } catch (e) { process.stderr.write(`desktop failed: ${e.message}\n`); return 1; }
}
