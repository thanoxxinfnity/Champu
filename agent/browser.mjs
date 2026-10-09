/**
 * Browser for the bridge: Microsoft's Playwright MCP server (github.com/microsoft/playwright-mcp) driven over stdio.
 *
 * The bridge starts it on first use (`npx @playwright/mcp`, pinned), keeps ONE browser alive between calls so a page, a login
 * and open tabs persist across steps, and stops it after ten idle minutes. The model never speaks MCP: it runs
 * `node "$CHOMUGIRI_AGENT" browse <verb> …` in an ordinary terminal block, which posts to the bridge's /v1/browser, and the page
 * snapshot comes back as the command's output like any other command.
 *
 * Zero dependencies, like the rest of the agent.
 */
import { spawn } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';

export const PLAYWRIGHT_MCP = '@playwright/mcp@0.0.83';
const IDLE_MS = 10 * 60_000;
const START_MS = 180_000;
const CALL_MS = 90_000;
const SNAPSHOT_CAP = 14_000;

// ── MCP over stdio (newline-delimited JSON-RPC) ─────────────────────────────

export class McpStdio {
  constructor({ command, args, cwd, env }) {
    Object.assign(this, { command, args, cwd, env });
    this.child = null;
    this.nextId = 0;
    this.pending = new Map();
    this.buf = '';
    this.err = '';
    this.ready = null;
  }

  start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const win = process.platform === 'win32';
      const child = spawn(this.command, this.args, { cwd: this.cwd, env: { ...process.env, ...this.env }, stdio: ['pipe', 'pipe', 'pipe'], shell: win, windowsHide: true });
      this.child = child;
      child.on('error', (e) => { this.fail(new Error(`could not start ${this.command}: ${e.message}`)); reject(e); });
      child.on('close', (code) => {
        this.fail(new Error(`the browser server stopped (exit ${code}). ${this.err.trim().split('\n').slice(-3).join(' ')}`.trim()));
        this.child = null;
        this.ready = null;
      });
      child.stderr.on('data', (d) => { this.err = (this.err + d).slice(-4000); });
      child.stdout.on('data', (d) => {
        this.buf += d;
        let i;
        while ((i = this.buf.indexOf('\n')) >= 0) {
          const line = this.buf.slice(0, i).trim();
          this.buf = this.buf.slice(i + 1);
          if (!line) continue;
          let m;
          try { m = JSON.parse(line); } catch { continue; }
          const p = m.id != null ? this.pending.get(m.id) : null;
          if (p) { this.pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(new Error(m.error.message ?? 'MCP error')) : p.resolve(m.result); }
        }
      });
      this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'chomugiri-bridge', version: '1' } }, START_MS)
        .then(() => { this.notify('notifications/initialized'); resolve(); })
        .catch((e) => { this.stop(); reject(e); });
    });
    return this.ready;
  }

  fail(err) { for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(err); } this.pending.clear(); }
  notify(method, params) { this.child?.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`); }

  request(method, params, timeoutMs = CALL_MS) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out after ${Math.round(timeoutMs / 1000)}s`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); } catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }

  stop() { try { this.child?.kill(); } catch { /* gone */ } this.child = null; this.ready = null; }
}

// ── The bridge's one browser ────────────────────────────────────────────────

/** Where Playwright MCP puts screenshots and page snapshots: the bridge's artifacts folder, so a screenshot is downloadable. */
export function createBrowser({ outDir, env = process.env, spawnSpec = null }) {
  let mcp = null;
  let idle = null;
  let queue = Promise.resolve();
  const headed = env.CHOMUGIRI_BROWSER_HEADED === '1';

  const args = () => [
    '-y', PLAYWRIGHT_MCP,
    ...(headed ? [] : ['--headless']),
    '--isolated',
    '--output-dir', outDir,
    ...(env.CHOMUGIRI_BROWSER_CHROMIUM ? ['--executable-path', env.CHOMUGIRI_BROWSER_CHROMIUM] : []),
    ...(env.CHOMUGIRI_BROWSER_ARGS ? env.CHOMUGIRI_BROWSER_ARGS.split(/\s+/).filter(Boolean) : []),
  ];

  const touch = () => { clearTimeout(idle); idle = setTimeout(() => close(), IDLE_MS); idle.unref?.(); };
  const close = () => { clearTimeout(idle); mcp?.stop(); mcp = null; };

  async function run(tool, toolArgs) {
    if (!mcp) mcp = new McpStdio({ command: spawnSpec?.command ?? 'npx', args: spawnSpec?.args ?? args(), cwd: outDir, env: {} });
    touch();
    try { await mcp.start(); } catch (e) { mcp = null; throw e; }
    const result = await mcp.request('tools/call', { name: tool, arguments: toolArgs ?? {} });
    touch();
    return shape(result, outDir);
  }

  return {
    /** One call at a time: a click must finish before the next step reads the page. */
    call(tool, toolArgs) {
      const job = queue.then(() => run(tool, toolArgs));
      queue = job.catch(() => undefined);
      return job;
    },
    async tools() {
      if (!mcp) mcp = new McpStdio({ command: spawnSpec?.command ?? 'npx', args: spawnSpec?.args ?? args(), cwd: outDir, env: {} });
      await mcp.start();
      return (await mcp.request('tools/list', {})).tools;
    },
    close,
  };
}

const strip = (s) => s.replace(/\u001b\[[0-9;]*m/g, '');

/**
 * Turns an MCP result into what the terminal shows: the text, with the page snapshot Playwright wrote to a file read back in
 * (the model needs the elements and their refs, not a path), and a screenshot path turned into a download link.
 */
export async function shape(result, outDir) {
  let text = (result?.content ?? []).map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n');
  text = strip(text);
  const snap = /(?:- )?\[Snapshot\]\(([^)]+)\)/.exec(text);
  if (snap) {
    const file = path.resolve(outDir, snap[1]);
    try {
      let body = await readFile(file, 'utf8');
      if (body.length > SNAPSHOT_CAP) body = `${body.slice(0, SNAPSHOT_CAP)}\n… (page continues — use "browse find <text>" or scroll/click to reach the rest)`;
      text = text.replace(snap[0], `\`\`\`yaml\n${body.trimEnd()}\n\`\`\``);
      await rm(file, { force: true });
    } catch { /* the link stays */ }
  }
  text = text.replace(/\[([^\]]*)\]\(([^)]+\.(?:png|jpe?g|pdf))\)/g, (_m, label, p) => `[${label}](${path.basename(p)}) — saved as ${path.basename(p)} in the bridge's artifacts (download: /v1/artifact/${encodeURIComponent(path.basename(p))})`);
  // The "Ran Playwright code" echo is noise to the model; keep only errors and the page state.
  text = text.replace(/### Ran Playwright code\n```js\n[\s\S]*?```\n?/g, '');
  return { ok: !result?.isError, text: text.trim() };
}

// ── The `browse` command ────────────────────────────────────────────────────

export const BROWSE_HELP = `browse — a real browser (Playwright). One browser stays open between commands: the page, login and tabs persist.

  browse open <url>                  go to a page, get its elements (each has a ref like e12)
  browse search <words>              web search (DuckDuckGo) — results come back as a page you can read or click
  browse snapshot                    the current page again
  browse click <ref> [what it is]    click an element
  browse type <ref> <text> [--submit] type into a field (--submit presses Enter)
  browse select <ref> <value>        choose an option
  browse hover <ref>                 hover
  browse press <key>                 Enter, Tab, ArrowDown, Control+a …
  browse find <text>                 find text on the page (use when the page is long)
  browse wait <seconds | text>       wait for time, or for text to appear
  browse back                        go back
  browse shot [--full]               screenshot (saved as an artifact, linked in the answer)
  browse eval <js function>          run JavaScript in the page, e.g. "() => document.title"
  browse tabs [list|new <url>|select <n>|close <n>]
  browse close                       close the browser
  browse tools                       every tool the browser server offers
  browse <tool_name> '<json>'        any raw tool, e.g. browse browser_fill_form '{"fields":[…]}'
`;

const SEARCH_URL = 'https://duckduckgo.com/html/?q=';

/** Words typed on the command line → one MCP tool call. Returns {tool,args}, {local:'help'|'tools'} or {error}. */
export function parseBrowse(argv) {
  const [verb, ...rest] = argv;
  const flag = (n) => rest.includes(`--${n}`);
  const words = rest.filter((w) => !w.startsWith('--'));
  const need = (n, usage) => (words.length >= n ? null : { error: `usage: browse ${usage}` });
  switch ((verb ?? '').toLowerCase()) {
    case '': case 'help': case '-h': case '--help': return { local: 'help' };
    case 'tools': return { local: 'tools' };
    case 'open': case 'go': case 'goto': case 'navigate': {
      const e = need(1, 'open <url>'); if (e) return e;
      let url = words[0];
      if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
      return { tool: 'browser_navigate', args: { url } };
    }
    case 'search': case 'google': {
      const e = need(1, 'search <words>'); if (e) return e;
      return { tool: 'browser_navigate', args: { url: SEARCH_URL + encodeURIComponent(words.join(' ')) } };
    }
    case 'snapshot': case 'look': case 'page': return { tool: 'browser_snapshot', args: {} };
    case 'click': {
      const e = need(1, 'click <ref> [what it is]'); if (e) return e;
      return { tool: 'browser_click', args: { target: words[0], element: words.slice(1).join(' ') || words[0] } };
    }
    case 'type': case 'fill': {
      const e = need(2, 'type <ref> <text> [--submit]'); if (e) return e;
      return { tool: 'browser_type', args: { target: words[0], element: words[0], text: words.slice(1).join(' '), submit: flag('submit') } };
    }
    case 'select': {
      const e = need(2, 'select <ref> <value>'); if (e) return e;
      return { tool: 'browser_select_option', args: { target: words[0], element: words[0], values: words.slice(1) } };
    }
    case 'hover': { const e = need(1, 'hover <ref>'); if (e) return e; return { tool: 'browser_hover', args: { target: words[0], element: words[0] } }; }
    case 'press': case 'key': { const e = need(1, 'press <key>'); if (e) return e; return { tool: 'browser_press_key', args: { key: words[0] } }; }
    case 'find': { const e = need(1, 'find <text>'); if (e) return e; return { tool: 'browser_find', args: { text: words.join(' ') } }; }
    case 'wait': {
      const e = need(1, 'wait <seconds | text>'); if (e) return e;
      return /^\d+(\.\d+)?$/.test(words[0]) ? { tool: 'browser_wait_for', args: { time: Number(words[0]) } } : { tool: 'browser_wait_for', args: { text: words.join(' ') } };
    }
    case 'back': return { tool: 'browser_navigate_back', args: {} };
    case 'shot': case 'screenshot': return { tool: 'browser_take_screenshot', args: flag('full') ? { fullPage: true } : {} };
    case 'eval': case 'js': { const e = need(1, 'eval <js function>'); if (e) return e; return { tool: 'browser_evaluate', args: { function: words.join(' ') } }; }
    case 'tabs': {
      const [action = 'list', a, b] = words;
      if (action === 'new') return { tool: 'browser_tabs', args: { action: 'new', ...(a ? { url: a } : {}) } };
      return { tool: 'browser_tabs', args: { action, ...(a != null && /^\d+$/.test(a) ? { index: Number(a) } : {}) , ...(b ? { url: b } : {}) } };
    }
    case 'close': return { tool: 'browser_close', args: {} };
    default: {
      if (/^browser_[a-z_]+$/.test(verb)) {
        let args = {};
        if (words[0]) { try { args = JSON.parse(words.join(' ')); } catch { return { error: `the arguments of ${verb} must be JSON, e.g. browse ${verb} '{"url":"https://example.com"}'` }; } }
        return { tool: verb, args };
      }
      return { error: `unknown browse command "${verb}". Run: browse help` };
    }
  }
}

/** `node chomugiri-agent.mjs browse …` — run inside a bridge command, talks to the bridge that started it. */
export async function browseCli(argv, env = process.env) {
  const parsed = parseBrowse(argv);
  if (parsed.local === 'help') { process.stdout.write(BROWSE_HELP); return 0; }
  if (parsed.error) { process.stderr.write(`${parsed.error}\n`); return 2; }
  const base = env.CHOMUGIRI_BRIDGE_URL;
  const token = env.CHOMUGIRI_BRIDGE_TOKEN;
  if (!base || !token) { process.stderr.write('browse only works inside a bridge command (CHOMUGIRI_BRIDGE_URL is not set).\n'); return 2; }
  try {
    const res = await fetch(`${base}/v1/browser`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(parsed.local === 'tools' ? { list: true } : { tool: parsed.tool, args: parsed.args }),
      signal: AbortSignal.timeout(CALL_MS + START_MS),
    });
    const data = await res.json();
    if (!res.ok) { process.stderr.write(`${data.error ?? `bridge answered ${res.status}`}\n`); return 1; }
    process.stdout.write(`${data.text ?? ''}\n`);
    return data.ok === false ? 1 : 0;
  } catch (e) {
    process.stderr.write(`browse failed: ${e.message}\n`);
    return 1;
  }
}

/** Failures the model can act on: what to run, not a stack. */
export function explainBrowserError(message) {
  const m = String(message);
  if (/Executable doesn't exist|browserType\.launch|playwright install|Chromium distribution|ms-playwright/i.test(m)) {
    return `The browser is not installed on this machine. Run: npx -y playwright@latest install chromium — then repeat the browse command. (${m.split('\n')[0].slice(0, 160)})`;
  }
  if (/could not start npx|ENOENT/i.test(m)) return 'Node\'s npx was not found on the bridge machine, so the browser server could not start. Install Node 18+ (it includes npx).';
  if (/timed out/i.test(m)) return `The browser did not answer in time (${m}). The page may be slow or blocked: try browse snapshot, or open it again.`;
  return m.slice(0, 600);
}
