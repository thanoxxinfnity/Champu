#!/usr/bin/env node
/**
 * chomugiri — a coding agent for the terminal.
 *
 *   chomugiri                      start in this folder and talk
 *   chomugiri "fix the failing test"   start with a first message
 *   chomugiri -p "explain src/app.js"  answer once and exit (for scripts and pipes)
 *   chomugiri --continue           pick up the last conversation of this folder
 *   chomugiri config               show or set the provider, model and key
 *
 * It reads, searches, edits and runs things in the folder it was started in, asking before every change or command unless told
 * otherwise (--yes, or "a" at a prompt). Works with any OpenAI-compatible endpoint; with no setup it uses Pollinations (free, no key).
 * No dependencies: one `node` is all it needs, so it also runs in Termux.
 */
import { createInterface } from 'node:readline';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  PROVIDERS, VERSION, compact, jail, listSessions, loadConfig, newSessionId, proseOf, resolveProvider, runShell, runTurn,
  saveConfig, saveSession, systemPrompt,
} from './core.mjs';

// ── arguments ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flags = { yes: false, print: false, cont: false };
const rest = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const val = () => argv[++i];
  if (a === '-p' || a === '--print') flags.print = true;
  else if (a === '-y' || a === '--yes') flags.yes = true;
  else if (a === '-c' || a === '--continue') flags.cont = true;
  else if (a === '--provider') flags.provider = val();
  else if (a === '--model' || a === '-m') flags.model = val();
  else if (a === '--base-url') flags.baseUrl = val();
  else if (a === '--cwd' || a === '-C') flags.cwd = val();
  else if (a === '--max-steps') flags.maxSteps = Number(val());
  else if (a === '--no-color') process.env.NO_COLOR = '1';
  else if (a === '-v' || a === '--version') { console.log(`chomugiri ${VERSION}`); process.exit(0); }
  else if (a === '-h' || a === '--help') { help(); process.exit(0); }
  else rest.push(a);
}

// ── looks ────────────────────────────────────────────────────────────────────

const TTY = process.stdout.isTTY && process.stdin.isTTY;
const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const sgr = (code) => (s) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const c = { dim: sgr('2'), bold: sgr('1'), red: sgr('31'), green: sgr('32'), yellow: sgr('33'), blue: sgr('34'), magenta: sgr('35'), cyan: sgr('36'), orange: sgr('38;5;209'), grey: sgr('90') };
const out = (s = '') => process.stdout.write(`${s}\n`);
const width = () => Math.max(40, Math.min(process.stdout.columns || 80, 110));

function help() {
  out(`${c.bold('chomugiri')} ${VERSION} — a coding agent for the terminal

${c.bold('Use')}
  chomugiri [message]            talk in this folder
  chomugiri -p "question"        answer once and exit (reads stdin too: cat log.txt | chomugiri -p "what failed?")
  chomugiri -c                   continue the last conversation of this folder
  chomugiri config [key value]   show or set: provider, model, base-url, key
  chomugiri providers            list the built-in providers

${c.bold('Options')}
  --provider <id>   ${Object.keys(PROVIDERS).join(', ')}, custom
  --model, -m <name>    --base-url <https://host/v1>    --cwd, -C <folder>
  --yes, -y         allow file changes and commands without asking (risky commands still ask)
  --max-steps <n>   how many act-and-read rounds one message may take (default 25)

${c.bold('While talking')}
  /help /model /provider /key /status /clear /compact /yes /init /sessions /resume /cd /exit
  !command          run a shell command yourself        @path     put a file into your message
  end a line with \\  to keep typing on the next line     Ctrl+C    stop the current work (twice to quit)

${c.bold('Keys')}  set the provider's variable (OPENROUTER_API_KEY, GROQ_API_KEY, GEMINI_API_KEY, ...) or run: chomugiri config key <value>`);
}

function banner(provider, root, resumed) {
  const w = width();
  const line = (s = '') => `${c.orange('│')} ${s}${' '.repeat(Math.max(0, w - 4 - strip(s).length))} ${c.orange('│')}`;
  out(c.orange(`╭${'─'.repeat(w - 2)}╮`));
  out(line(`${c.bold(c.orange('chomugiri'))} ${c.dim(VERSION)}   ${c.dim('a coding agent in your terminal')}`));
  out(line());
  out(line(`${c.dim('folder')}    ${short(root, w - 18)}`));
  out(line(`${c.dim('model')}     ${provider.model} ${c.dim(`· ${provider.name}`)}`));
  out(line(`${c.dim('changes')}   ${flags.yes ? c.yellow('allowed without asking (--yes)') : 'ask before every file change and command'}`));
  if (resumed) out(line(`${c.dim('session')}   continued, ${resumed} messages`));
  out(c.orange(`╰${'─'.repeat(w - 2)}╯`));
  if (provider.note) out(c.dim(`  ${provider.note}`));
  out(c.dim('  /help for commands · !cmd runs a command · @file adds a file · Ctrl+C stops'));
  out();
}
const strip = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');
const short = (p, max) => (p.length <= max ? p : `…${p.slice(-(max - 1))}`);

/** A spinner on one line; stop() clears it. */
function spinner(label) {
  if (!TTY) return { stop() {}, set() {} };
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0, text = label;
  const started = Date.now();
  const draw = () => process.stdout.write(`\r\x1b[2K${c.orange(frames[i++ % frames.length])} ${c.dim(`${text} ${Math.round((Date.now() - started) / 1000)}s · Ctrl+C to stop`)}`);
  const t = setInterval(draw, 90);
  draw();
  return { stop() { clearInterval(t); process.stdout.write('\r\x1b[2K'); }, set(s) { text = s; } };
}

/** Prints the reply as it streams, line by line, hiding action blocks (they are shown as actions when they run). */
function streamPrinter() {
  let buf = '', fence = null, printed = false;
  const KIND = /^(run|read|search|list|write|edit)\b/i;
  const line = (l) => {
    const m = /^[ \t]*(`{3,}|~{3,})[ \t]*(.*)$/.exec(l);
    if (fence) {
      if (m && m[1][0] === fence.ch && m[1].length >= fence.len && !m[2].trim()) { const hidden = fence.hidden; fence = null; if (hidden) return; out(c.dim(l)); return; }
      if (!fence.hidden) out(c.cyan(l));
      return;
    }
    if (m) { fence = { ch: m[1][0], len: m[1].length, hidden: KIND.test(m[2].trim()) }; if (!fence.hidden) { lead(); out(c.dim(l)); } return; }
    if (!l.trim() && !printed) return;
    lead();
    out(l.replace(/\*\*(.+?)\*\*/g, (_, t) => c.bold(t)).replace(/`([^`]+)`/g, (_, t) => c.cyan(t)).replace(/^(#{1,4}) (.*)$/, (_, h, t) => c.bold(t)));
  };
  const lead = () => { if (!printed) { printed = true; } };
  return {
    push(piece) { buf += piece; let i; while ((i = buf.indexOf('\n')) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1); } },
    end() { if (buf) { line(buf); buf = ''; } fence = null; const p = printed; printed = false; return p; },
  };
}

// ── asking ───────────────────────────────────────────────────────────────────

let rl = null;
const question = (q) => new Promise((resolve) => { if (!rl) return resolve(''); rl.question(q, resolve); });
const allowed = new Set();

function colorDiff(text) {
  return text.split('\n').map((l) => (l.startsWith('+ ') ? c.green(l) : l.startsWith('- ') ? c.red(l) : c.dim(l))).join('\n');
}

async function ask(kind, title, detail) {
  if (kind !== 'risky' && (flags.yes || allowed.has(kind))) return true;
  if (!TTY || flags.print) return false; // nobody to ask: a script must pass --yes
  out();
  out(`${c.yellow('?')} ${c.bold(title)}${kind === 'risky' ? c.red('  (risky: always asks)') : ''}`);
  if (detail) out((kind === 'run' || kind === 'risky' ? c.cyan(detail) : colorDiff(detail)).split('\n').map((l) => `  ${l}`).join('\n'));
  const a = (await question(`  ${c.dim(kind === 'risky' ? 'allow? [y]es / [n]o ' : `allow? [y]es / [n]o / [a]lways for ${kind === 'run' ? 'commands' : 'file changes'} `)}`)).trim().toLowerCase();
  if (a === 'a' && kind !== 'risky') { allowed.add(kind); if (kind === 'write' || kind === 'edit') { allowed.add('write'); allowed.add('edit'); } return true; }
  return a === 'y' || a === 'yes' || a === 'ha' || a === 'haan';
}

// ── main ─────────────────────────────────────────────────────────────────────

const root = path.resolve(flags.cwd || process.cwd());
if (!existsSync(root) || !statSync(root).isDirectory()) { console.error(`No such folder: ${root}`); process.exit(2); }

if (rest[0] === 'providers') { for (const [id, p] of Object.entries(PROVIDERS)) out(`${id.padEnd(13)} ${p.name.padEnd(28)} ${c.dim(p.key ?? 'no key needed')}  ${c.dim(p.model)}`); process.exit(0); }
if (rest[0] === 'config') { configCommand(rest.slice(1)); process.exit(0); }

function configCommand([key, ...value]) {
  const cfg = loadConfig();
  const v = value.join(' ');
  if (!key) {
    const p = safeProvider();
    out(`provider  ${cfg.provider ?? 'pollinations (default)'}\nmodel     ${p?.model ?? '-'}\nendpoint  ${p?.base ?? '-'}\nkey       ${p?.key ? `set (…${p.key.slice(-4)})` : p?.needsKey ? `missing: set ${p.keyEnv} or run: chomugiri config key <value>` : 'not needed'}`);
    return;
  }
  if (key === 'provider') { if (v !== 'custom' && !PROVIDERS[v]) return void console.error(`Unknown provider "${v}". Run: chomugiri providers`); cfg.provider = v; }
  else if (key === 'model') { cfg.models = { ...(cfg.models ?? {}), [cfg.provider ?? 'pollinations']: v }; }
  else if (key === 'base-url') { cfg.baseUrl = v; cfg.provider = 'custom'; }
  else if (key === 'key') { cfg.keys = { ...(cfg.keys ?? {}), [cfg.provider ?? 'pollinations']: v }; }
  else return void console.error('config takes: provider, model, base-url, key');
  saveConfig(cfg);
  out(`Saved ${key}${key === 'key' ? '' : ` = ${v}`}.`);
}
function safeProvider() { try { return resolveProvider(flags); } catch (e) { return null; } }

let provider;
try { provider = resolveProvider(flags); } catch (e) { console.error(e.message); process.exit(2); }

const session = { id: newSessionId(), root, createdAt: Date.now(), updatedAt: Date.now(), title: '', messages: [] };
if (flags.cont) {
  const last = listSessions(root)[0];
  if (last) Object.assign(session, last);
}
const fresh = () => [{ role: 'system', content: systemPrompt({ root }) }];
let messages = session.messages.length ? session.messages : fresh();
messages[0] = fresh()[0]; // the folder listing and notes are always current

function persist() {
  session.messages = messages; session.updatedAt = Date.now();
  if (!session.title) session.title = (messages.find((m) => m.role === 'user')?.content ?? '').slice(0, 60);
  try { saveSession(session); } catch { /* a read-only home: the conversation still works */ }
}

/** `@path` in a message adds that file's content under the message. */
function expandMentions(text) {
  const added = [];
  for (const m of text.matchAll(/(^|\s)@([\w./\\-]+)/g)) {
    try {
      const f = jail(root, m[2]);
      if (existsSync(f) && statSync(f).isFile() && statSync(f).size < 200_000) added.push(`--- ${m[2]}\n${readFileSync(f, 'utf8')}`);
    } catch { /* outside the folder: left as text */ }
  }
  return added.length ? `${text}\n\nFiles the user attached:\n${added.join('\n\n')}` : text;
}

let abort = null;
async function turn(text) {
  messages.push({ role: 'user', content: expandMentions(text) });
  messages = compact(messages);
  abort = new AbortController();
  const started = Date.now();
  let spin = null, printer = streamPrinter(), live = '';
  const ui = {
    thinking(on) { if (on && !spin) spin = spinner('thinking'); if (!on && spin) { spin.stop(); spin = null; } },
    wait(ms) { spin?.set(`the provider asks to wait ${Math.round(ms / 1000)}s;`); },
    text(piece) { if (!flags.print) printer.push(piece); },
    replyEnd(reply) { if (flags.print) { const p = proseOf(reply); if (p) out(p); } else if (printer.end()) out(); },
    actionStart(a) { live = ''; if (a.kind === 'run' && TTY && !flags.print) spin = spinner(`running ${a.body.trim().split('\n')[0].slice(0, 50)}`); },
    output(s) { live += s; const last = live.trimEnd().split('\n').pop() ?? ''; spin?.set(`running · ${last.slice(0, 60)}`); },
    action(r) {
      if (spin) { spin.stop(); spin = null; }
      const mark = r.ok ? c.green('●') : r.denied ? c.yellow('●') : c.red('●');
      const line = `${mark} ${c.bold(r.title)}`;
      if (flags.print) { process.stderr.write(`${strip(line)}  ${r.summary ?? ''}\n`); return; }
      out(line);
      out(`  ${c.dim('⎿')} ${r.ok ? c.dim(r.summary ?? 'done') : c.red(r.summary ?? 'failed')}`);
      if (!r.ok && !r.denied) out(c.dim(r.result.split('\n').slice(-6).map((l) => `    ${l}`).join('\n')));
    },
    note(t) { out(c.yellow(t)); },
  };
  try {
    const r = await runTurn({ provider, messages, root, ask, ui, signal: abort.signal, maxSteps: flags.maxSteps || 25 });
    if (!flags.print) out(c.dim(`  ${provider.model} · ${r.steps} step${r.steps === 1 ? '' : 's'} · ${Math.round((Date.now() - started) / 1000)}s${r.usage.prompt ? ` · ${r.usage.prompt + r.usage.completion} tokens` : ''}`));
  } catch (e) {
    if (spin) spin.stop();
    printer.end();
    if (abort.signal.aborted) out(c.yellow('Stopped.'));
    else { (flags.print ? console.error : out)(c.red(`Error: ${e.message}`)); if (flags.print) process.exitCode = 1; }
    // A turn that failed before the model answered leaves no half question behind.
    if (messages[messages.length - 1]?.role === 'user' && !messages[messages.length - 1].content.startsWith('ACTION RESULTS')) messages.pop();
  } finally { abort = null; persist(); }
}

async function slash(line) {
  const [cmd, ...args] = line.slice(1).trim().split(/\s+/);
  const arg = args.join(' ');
  const cfg = loadConfig();
  switch (cmd) {
    case 'help': case '?': help(); break;
    case 'exit': case 'quit': case 'q': return 'exit';
    case 'clear': case 'new': messages = fresh(); Object.assign(session, { id: newSessionId(), title: '', createdAt: Date.now() }); out(c.dim('New conversation.')); break;
    case 'compact': { const before = messages.length; messages = compact(messages, 6, 20_000); out(c.dim(`Kept ${messages.length} of ${before} messages.`)); break; }
    case 'status': out(`folder   ${root}\nmodel    ${provider.model} (${provider.name})\nendpoint ${provider.base}\nkey      ${provider.key ? `set (…${provider.key.slice(-4)})` : provider.needsKey ? c.red(`missing: ${provider.keyEnv}`) : 'not needed'}\nchanges  ${flags.yes ? 'allowed without asking' : allowed.size ? `always allowed: ${[...allowed].join(', ')}` : 'ask every time'}\nsession  ${session.id} · ${messages.length - 1} messages`); break;
    case 'yes': flags.yes = !flags.yes; out(flags.yes ? c.yellow('File changes and commands now run without asking (risky commands still ask). /yes again to turn off.') : 'Asking before every change again.'); allowed.clear(); break;
    case 'model':
      if (!arg) { out(`model: ${provider.model}   ${c.dim('change with /model <name>')}`); break; }
      cfg.models = { ...(cfg.models ?? {}), [provider.id]: arg }; saveConfig(cfg); provider = resolveProvider({ ...flags, model: arg }); out(`Model: ${provider.model}`); break;
    case 'provider':
      if (!arg) { for (const [id, p] of Object.entries(PROVIDERS)) out(`${id === provider.id ? c.green('●') : ' '} ${id.padEnd(13)} ${p.name}  ${c.dim(p.key ?? 'no key')}`); out(c.dim('change with /provider <id>')); break; }
      if (!PROVIDERS[arg]) { out(c.red(`Unknown provider "${arg}".`)); break; }
      try { cfg.provider = arg; saveConfig(cfg); flags.provider = arg; flags.model = undefined; provider = resolveProvider(flags); out(`Provider: ${provider.name} · ${provider.model}${provider.needsKey && !provider.key ? c.red(`  (no key yet: /key <value> or set ${provider.keyEnv})`) : ''}`); } catch (e) { out(c.red(e.message)); }
      break;
    case 'key':
      if (!arg) { out(provider.needsKey ? `Give the key for ${provider.name}: /key <value>  (saved in ~/.chomugiri/config.json, readable only by you)` : `${provider.name} needs no key.`); break; }
      cfg.keys = { ...(cfg.keys ?? {}), [provider.id]: arg }; saveConfig(cfg); provider = resolveProvider(flags); out('Key saved.'); break;
    case 'init': {
      const f = path.join(root, 'CHOMUGIRI.md');
      if (existsSync(f)) { out('CHOMUGIRI.md already exists; I read it at the start of every conversation.'); break; }
      await turn('Look at this project (list it, read the main files, the package or build files and the README) and then write CHOMUGIRI.md: what the project is, how to build, run and test it (the exact commands), the folder layout, and the conventions the code follows. Keep it under 60 lines. Only facts you saw.');
      break;
    }
    case 'sessions': { const all = listSessions(root).slice(0, 10); if (!all.length) out(c.dim('No saved conversations for this folder.')); all.forEach((s, i) => out(`${String(i + 1).padStart(2)}  ${new Date(s.updatedAt).toLocaleString()}  ${c.dim(s.title || '(untitled)')}`)); if (all.length) out(c.dim('/resume <number> to open one')); break; }
    case 'resume': { const s = listSessions(root)[Math.max(0, Number(arg || 1) - 1)]; if (!s) { out(c.dim('Nothing to resume.')); break; } Object.assign(session, s); messages = s.messages; messages[0] = fresh()[0]; out(c.dim(`Resumed: ${s.title || s.id} (${messages.length - 1} messages).`)); break; }
    case 'cd': out(c.dim('The folder is fixed for a conversation. Start chomugiri in the other folder, or use --cwd.')); break;
    default: out(c.red(`Unknown command /${cmd}. /help lists them.`));
  }
}

// one-shot: answer and leave
if (flags.print) {
  let piped = '';
  if (!process.stdin.isTTY) { for await (const chunk of process.stdin) piped += chunk; }
  const text = [rest.join(' '), piped.trim() ? `Input:\n${piped.trim()}` : ''].filter(Boolean).join('\n\n');
  if (!text) { console.error('Nothing to answer. Usage: chomugiri -p "question"'); process.exit(2); }
  await turn(text);
  process.exit(process.exitCode ?? 0);
}

if (!TTY) { console.error('chomugiri needs a terminal to talk in. For scripts use: chomugiri -p "question"'); process.exit(2); }

banner(provider, root, session.messages.length ? messages.length - 1 : 0);
if (provider.needsKey && !provider.key) out(c.red(`No key for ${provider.name}. Set ${provider.keyEnv}, or type /key <value>, or /provider pollinations for the free one.\n`));

rl = createInterface({ input: process.stdin, output: process.stdout, historySize: 200 });
let lastSigint = 0;
rl.on('SIGINT', () => {
  if (abort) { abort.abort(); return; }
  if (Date.now() - lastSigint < 1500) { out(); process.exit(0); }
  lastSigint = Date.now();
  out(c.dim('\n(Ctrl+C again to quit)'));
  rl.prompt();
});
rl.on('close', () => { persist(); process.exit(0); });

let first = rest.join(' ').trim();
for (;;) {
  let text = first || (await question(`${c.orange('>')} `));
  first = '';
  while (text.endsWith('\\')) text = `${text.slice(0, -1)}\n${await question(c.dim('… '))}`;
  text = text.trim();
  if (!text) continue;
  if (text.startsWith('/')) { if ((await slash(text)) === 'exit') break; out(); continue; }
  if (text.startsWith('!')) {
    const r = await runShell(text.slice(1), { cwd: root, onData: (s) => process.stdout.write(s) });
    out(c.dim(`[exit ${r.code}${r.why ? `, ${r.why}` : ''}]`));
    // What the user ran is context for the next message.
    messages.push({ role: 'user', content: `I ran this myself:\n$ ${text.slice(1)}\n${r.output.slice(-4000)}\n[exit ${r.code}]` }, { role: 'assistant', content: 'Noted.' });
    out();
    continue;
  }
  out();
  await turn(text);
  out();
}
persist();
rl.close();
