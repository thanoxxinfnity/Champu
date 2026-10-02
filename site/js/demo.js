/**
 * The Chomugiri phone on the page. It is not a video: it is HTML and CSS, driven by this
 * script, replaying the real app's screens — the home screen, a build plan ticking off,
 * a research report with logo chips, and a code block with copy and expand.
 * It types, it waits, it loops, and it stops working when it scrolls out of view.
 */
import { reduced, sleep } from './type.js';

const $ = (s) => document.querySelector(s);
const STOP = Symbol('stop');

export function start() {
  const home = $('#s-home'), chat = $('#s-chat'), typed = $('#d-typed'), ph = $('#d-ph'), caret = $('#d-caret');
  const run = $('#d-run'), status = $('#d-status'), statusT = $('#d-status-t');
  const buttons = [...document.querySelectorAll('#demo-steps button')];
  let token = { stop: false };
  let visible = true;
  let current = 0;

  new IntersectionObserver((es) => { visible = es[0].isIntersecting; }, { threshold: 0.1 }).observe($('#phone'));

  /** Sleep that holds while off-screen and aborts when the scene was replaced. */
  const wait = async (ms, t = token) => {
    await sleep(reduced ? Math.min(ms, 30) : ms);
    while (!visible) await sleep(250);
    if (t.stop) throw STOP;
  };
  const type = async (el, text, speed = 34, t = token) => {
    if (reduced) { el.textContent = text; return; }
    el.textContent = '';
    for (const ch of text) {
      el.textContent += ch;
      await wait(speed * (0.6 + Math.random() * 0.8) + (/[,.:—]/.test(ch) ? speed * 3 : 0), t);
    }
  };

  const reset = () => {
    chat.replaceChildren();
    home.classList.add('on'); chat.classList.remove('on');
    typed.textContent = ''; ph.style.display = ''; caret.style.display = 'none';
    run.classList.remove('go'); status.classList.remove('on');
  };
  const dockType = async (text) => {
    ph.style.display = 'none'; caret.style.display = '';
    await type(typed, text, 46);
    run.classList.add('go');
    await wait(500);
  };
  const send = async () => {
    run.classList.remove('go');
    const text = typed.textContent;
    typed.textContent = ''; ph.style.display = ''; caret.style.display = 'none';
    home.classList.remove('on'); chat.classList.add('on');
    const m = msg('YOU', 'You', false);
    m.tx.textContent = text;
    await wait(500);
  };
  const msg = (av, who, cho = true, lane) => {
    const el = document.createElement('div');
    el.className = 'msg';
    el.innerHTML = `<div class="av${cho ? ' cho' : ''}">${av}</div><div><b class="who"></b><div class="tx"></div></div>`;
    el.querySelector('.who').textContent = who;
    if (lane) { const l = document.createElement('span'); l.className = 'lane'; l.textContent = lane; el.querySelector('.who').append(l); }
    chat.append(el);
    return { el, tx: el.querySelector('.tx') };
  };

  /* ---- scene 0: one sentence becomes a plan ---- */
  async function build() {
    reset();
    await wait(1400);
    await dockType('build me a racing game');
    await send();
    const m = msg('CHO', 'Chomugiri', true, 'LANE B');
    await type(m.tx, 'On it. Here is the plan:', 30);
    const ul = document.createElement('ul'); ul.className = 'todo'; m.tx.append(ul);
    const steps = ['Research the current Godot version', 'Plan the scenes and cars', 'Write project.godot', 'Write the car controller', 'Build the garage screen', 'Export the Android build', 'Check that it runs'];
    const rows = steps.map((s) => { const li = document.createElement('li'); li.innerHTML = '<i></i><span></span>'; li.lastChild.textContent = s; ul.append(li); return li; });
    for (const li of rows) { li.classList.add('show'); await wait(260); }
    await wait(500);
    for (const li of rows) {
      li.classList.add('run'); await wait(700);
      li.classList.remove('run'); li.classList.add('done'); li.firstChild.textContent = '✓';
    }
    await wait(500);
    const done = msg('CHO', 'Chomugiri', true);
    await type(done.tx, 'Done — 14 files, signed APK ready.', 28);
    await wait(2600);
  }

  /* ---- scene 1: it reads the web, and shows where ---- */
  async function research() {
    reset();
    await wait(900);
    await dockType('make a game in the newest godot');
    await send();
    status.classList.add('on');
    let sec = 0;
    const timer = setInterval(() => { sec += 1; statusT.textContent = `Researching the live web… ${sec}s`; }, 700);
    try {
      await wait(1800);
      const m = msg('CHO', 'Chomugiri', true);
      const t1 = document.createElement('span'); m.tx.append(t1);
      await type(t1, '🔎 Researched before building — current Godot version; what changed in Godot 4.x. Read 9 live pages (', 22);
      for (const [d, label] of [['github.com', 'github.com'], ['godotengine.org', 'godotengine.org'], ['wikipedia.org', 'en.wikipedia.org']]) {
        const c = document.createElement('span');
        c.className = 'chip';
        c.innerHTML = `<img src="/img/logos/${d}.png" alt="" width="16" height="16"><span></span>`;
        c.lastChild.textContent = label;
        m.tx.append(c);
        await wait(520);
      }
      const t2 = document.createElement('span'); m.tx.append(t2);
      await type(t2, ').', 30);
      await wait(700);
      status.classList.remove('on');
      const a = msg('CHO', 'Chomugiri', true, 'LANE B');
      await type(a.tx, 'Godot is at 4.7.2 — writing the project for that version.', 28);
      await wait(2800);
    } finally { clearInterval(timer); }
  }

  /* ---- scene 2: code with copy + expand ---- */
  async function code() {
    reset();
    await wait(900);
    await dockType('Show me a short python hello world in a code block');
    await send();
    const m = msg('CHO', 'Chomugiri', true, 'LANE A');
    const blk = document.createElement('div');
    blk.className = 'codeblk';
    blk.innerHTML = '<div class="hd">Python<span><button aria-label="Copy" class="cp">⧉</button><button aria-label="Expand">⤢</button></span></div><pre><span class="k">print</span>(<span class="s">"Hello, World!"</span>)</pre>';
    m.el.lastChild.insertBefore(blk, m.tx);
    const pre = blk.querySelector('pre'); const html = pre.innerHTML; pre.textContent = '';
    // type the visible characters, then restore the coloured markup
    const plain = 'print("Hello, World!")';
    await type(pre, plain, 55);
    pre.innerHTML = html;
    await wait(500);
    const cp = blk.querySelector('.cp');
    cp.classList.add('ok'); cp.textContent = '✓';
    await wait(1500);
    cp.classList.remove('ok'); cp.textContent = '⧉';
    await type(m.tx, "That's the whole program — print() writes the string to stdout. Save it as hello.py and run it.", 22);
    await wait(2800);
  }

  const scenes = [build, research, code];
  const setButtons = (i) => buttons.forEach((b, k) => b.classList.toggle('on', k === i));

  let auto = true;
  async function loop(from) {
    token = { stop: false };
    const mine = token;
    current = from;
    for (;;) {
      setButtons(current);
      try { await scenes[current](); } catch (e) { if (e === STOP) return; throw e; }
      if (mine.stop) return;
      if (reduced || !auto) return;
      current = (current + 1) % scenes.length;
    }
  }
  buttons.forEach((b, i) => b.addEventListener('click', () => {
    token.stop = true; auto = false;
    sleep(60).then(() => loop(i));
  }));
  loop(0);
}
