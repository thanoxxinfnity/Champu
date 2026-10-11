// Deep bug tracing. From a symptom (an error message, a stack trace, a symbol, a file:line) it walks the whole chain and keeps the track:
//   surface  : where the failure shows (the top stack frames, the best matches for the words of the report)
//   upward   : the callers, so you know how execution got there, up to an entry point
//   downward : what that code relies on that could be the real culprit
//   values   : where a named value comes from and where it goes (through call arguments into the callee's parameters, and on)
// It ranks root-cause candidates by evidence and says what each rests on. It does not guess past the evidence.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { safeJoin } from './privacy.mjs';
import { tokenize } from './embed.mjs';
import { searchChunks } from './search.mjs';
import { pickSymbol, symbolById, callerTree, calleesOf, callPath } from './graph.mjs';

const SYM = 'id, file, name, qname, kind, line, end_line AS endLine, signature, params, doc, exported';

/** Frames from Node, Python, Godot and "file:line" stack traces, mapped to project files. */
export function parseStack(db, root, text) {
  const frames = [];
  const push = (file, line, fn) => {
    let f = file.replace(/^file:\/\//, '').replace(/^res:\/\//, '').replace(/\\/g, '/');
    if (f.startsWith(root)) f = f.slice(root.length).replace(/^\//, '');
    const row = db.prepare('SELECT path FROM files WHERE path = ? OR path LIKE ? ORDER BY length(path) LIMIT 1').get(f, `%/${f.replace(/^\.\//, '')}`);
    if (row) frames.push({ file: row.path, line: Number(line), fn: fn || null });
  };
  for (const l of text.split('\n')) {
    let m;
    if ((m = l.match(/at\s+(?:async\s+)?(?:(\S+)\s+\()?(.+?):(\d+):\d+\)?\s*$/))) push(m[2], m[3], m[1]);
    else if ((m = l.match(/File "(.+?)", line (\d+)(?:, in (\S+))?/))) push(m[1], m[2], m[3]);
    else if ((m = l.match(/(?:at:\s*(\S+)\s*\()?((?:res:\/\/)?[\w./-]+\.(?:gd|ts|tsx|js|mjs|py|go|rs|java|cs|kt|cpp|c|rb|php)):(\d+)/))) push(m[2], m[3], m[1]);
  }
  const seen = new Set();
  return frames.filter((f) => { const k = `${f.file}:${f.line}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

export function symbolAt(db, file, line) {
  return db.prepare(`SELECT ${SYM} FROM symbols WHERE file = ? AND line <= ? AND end_line >= ? AND kind IN ('function','method','class') ORDER BY (end_line - line) LIMIT 1`).get(file, line, line);
}

export function snippet(root, file, line, around = 4) {
  try {
    const lines = readFileSync(safeJoin(root, file), 'utf8').split('\n');
    const s = Math.max(1, line - around), e = Math.min(lines.length, line + around);
    return lines.slice(s - 1, e).map((t, i) => `${String(s + i).padStart(5)}${s + i === line ? ' ▶' : '  '} ${t}`).join('\n');
  } catch { return ''; }
}

function gitInfo(root, file, line) {
  try {
    const log = execFileSync('git', ['log', '-3', '--format=%h|%ct|%an|%s', '--', file], { cwd: root, encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').filter(Boolean).map((l) => { const [h, ct, an, ...s] = l.split('|'); return { hash: h, ts: Number(ct) * 1000, author: an, subject: s.join('|') }; });
    let blame = null;
    if (line) {
      const b = execFileSync('git', ['blame', '-L', `${line},${line}`, '--porcelain', '--', file], { cwd: root, encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] });
      blame = { hash: b.split(' ')[0].slice(0, 8), author: (b.match(/^author (.+)$/m) ?? [])[1], summary: (b.match(/^summary (.+)$/m) ?? [])[1] };
    }
    return { log, blame };
  } catch { return null; }
}

const NOISE_Q = new Set('or and the null none type key base of in on at for to is it as an by if'.split(' '));
const quotedIdentifiers = (text) => [...text.matchAll(/['"`‘“]([A-Za-z_][\w.$]{1,40})['"`’”]|\(reading '([^']+)'\)|property (\w+)|attribute '(\w+)'|identifier "(\w+)"|function "(\w+)\(/g)].flatMap((m) => m.slice(1).filter((x) => x && x.length > 2 && !NOISE_Q.has(x.toLowerCase())));

export async function traceBug(ctx, { symptom = '', stack = '', symbol, file, line, maxDepth = 4, candidates = 5 }) {
  const { db, root } = ctx;
  const anchors = new Map();
  const addAnchor = (sym, why, weight, hotLine) => {
    if (!sym) return;
    const a = anchors.get(sym.id) ?? { sym, why: [], score: 0, hotLine: hotLine ?? sym.line };
    a.why.push(why); a.score += weight;
    if (hotLine && !anchors.get(sym.id)?.hotLine) a.hotLine = hotLine;
    anchors.set(sym.id, a);
  };
  const frames = stack ? parseStack(db, root, stack) : [];
  frames.forEach((f, i) => addAnchor(symbolAt(db, f.file, f.line), `stack frame #${i + 1} (${f.file}:${f.line})`, Math.max(1, 4 - i * 0.5), f.line));
  if (symbol) { const p = pickSymbol(db, symbol); addAnchor(p.symbol, 'named by you', 4, p.symbol?.line); }
  if (file && line) addAnchor(symbolAt(db, file, Number(line)), `${file}:${line} named by you`, 4, Number(line));
  const words = [...new Set([...tokenize(symptom), ...quotedIdentifiers(`${symptom}\n${stack}`).flatMap((q) => tokenize(q))])];
  const quoted = new Set(quotedIdentifiers(`${symptom}\n${stack}`).map((q) => q.toLowerCase()));
  if (symptom.trim()) {
    const hits = await searchChunks(ctx, `${symptom} ${[...quoted].join(' ')}`.slice(0, 600), { limit: 8, kind: undefined });
    hits.filter((h) => h.symbol_id).slice(0, 5).forEach((h, i) => addAnchor(symbolById(db, h.symbol_id), `matches the report in meaning (rank ${i + 1})`, 2.5 - i * 0.3, h.line));
  }
  if (!anchors.size) return { anchors: [], note: 'nothing in the index matches. Index the project first, or give a stack trace, a symbol, or file and line.' };

  const now = Date.now();
  const chain = [];
  for (const a of [...anchors.values()].sort((x, y) => y.score - x.score).slice(0, 6)) {
    const s = a.sym;
    const card = db.prepare('SELECT text FROM chunks WHERE symbol_id = ?').get(s.id)?.text ?? '';
    const cardTokens = new Set(tokenize(card));
    const overlap = words.filter((w) => cardTokens.has(w)).length;
    const reasons = [...a.why];
    let score = a.score;
    if (words.length) { const o = overlap / Math.min(words.length, 8); score += o * 2; if (o > 0.3) reasons.push(`its code shares ${overlap} words with the report`); }
    let body = '';
    try { body = readFileSync(safeJoin(root, s.file), 'utf8').split('\n').slice(s.line - 1, s.endLine).join('\n'); } catch { /* file gone */ }
    const hit = [...quoted].filter((q) => body.toLowerCase().includes(q));
    if (hit.length) { score += 1.5 * Math.min(2, hit.length); reasons.push(`mentions ${hit.slice(0, 3).map((h) => `"${h}"`).join(', ')} from the error`); }
    if (/\b(throw|raise|assert|panic|push_error|catch|except|null|None|undefined|\?\.|is_instance_valid|if\s+not)\b/.test(body)) { score += 0.6; reasons.push('contains error handling or null checks'); }
    const git = gitInfo(root, s.file, a.hotLine);
    if (git?.log?.[0] && now - git.log[0].ts < 14 * 86400000) { score += 1; reasons.push(`file changed recently (${git.log[0].hash}: ${git.log[0].subject.slice(0, 60)})`); }
    const up = callerTree(db, s, maxDepth, 30);
    const callees = calleesOf(db, s).filter((e) => e.to_id).map((e) => ({ name: e.to_qname, file: e.to_file, line: e.line, hot: quoted.has(String(e.to_name).toLowerCase()) || words.includes(String(e.to_name).toLowerCase()) }));
    chain.push({ symbol: s, hotLine: a.hotLine, score: Math.round(score * 10) / 10, reasons, snippet: snippet(root, s.file, a.hotLine, 4), upward: up.map((n) => ({ depth: n.depth, name: n.symbol.qname, file: n.symbol.file, line: n.line, confidence: n.confidence })), downward: callees.slice(0, 12), git });
  }
  chain.sort((x, y) => y.score - x.score);
  // the frames in the order they ran, as a path, so the surface-to-root story stays intact
  const route = frames.map((f) => symbolAt(db, f.file, f.line)).filter(Boolean);
  const story = [];
  for (let i = 0; i + 1 < route.length; i++) {
    const p = callPath(db, route[i + 1], route[i], 3);
    if (p) story.push(p.map((x) => x.symbol.qname).join(' → '));
  }
  const probes = [];
  const top = chain[0];
  if (top) {
    probes.push(`Read ${top.symbol.file}:${top.hotLine} (${top.symbol.qname}) first: ${top.reasons[0]}.`);
    if (top.downward.some((d) => d.hot)) probes.push(`It calls ${top.downward.filter((d) => d.hot).map((d) => d.name).join(', ')}: check what that returns on the failing input.`);
    if (top.upward[0]) probes.push(`Check the caller ${top.upward[0].name} (${top.upward[0].file}:${top.upward[0].line}): what does it pass in?`);
    probes.push('To follow a value through the calls, use trace_value with the symbol and the variable name.');
  }
  return { frames, candidates: chain.slice(0, candidates), story, probes };
}

const splitArgs = (s) => { const out = []; let d = 0, cur = ''; for (const ch of s) { if ('([{'.includes(ch)) d++; if (')]}'.includes(ch)) d--; if (ch === ',' && d === 0) { out.push(cur.trim()); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; };

/** Follow a variable: where it appears in the symbol, and into which parameter of which callee each call hands it, onward to `depth`. */
export function traceValue(ctx, ref, variable, depth = 4) {
  const { db, root } = ctx;
  const p = pickSymbol(db, ref);
  if (!p.symbol) return { error: `no symbol "${ref}"`, candidates: p.candidates };
  const re = new RegExp(`(?<![\\w$])${variable.replace(/[$.*+?^{}()|[\]\\]/g, '\\$&')}(?![\\w$])`);
  const seen = new Set();
  function walk(sym, v, d) {
    const node = { symbol: sym.qname, file: sym.file, variable: v, uses: [], flows: [] };
    if (seen.has(`${sym.id}:${v}`) || d < 0) return node;
    seen.add(`${sym.id}:${v}`);
    let lines = [];
    try { lines = readFileSync(safeJoin(root, sym.file), 'utf8').split('\n'); } catch { return node; }
    for (let i = sym.line - 1; i < Math.min(sym.endLine, lines.length); i++) {
      if (!re.test(lines[i]) && v === variable) continue;
      if (v !== variable && !new RegExp(`(?<![\\w$])${v}(?![\\w$])`).test(lines[i])) continue;
      const t = lines[i].trim();
      const kind = new RegExp(`(^|[\\s,(])${v}\\s*(=|:=|\\+=|-=)(?!=)`).test(t) || new RegExp(`^(const|let|var)\\s+${v}\\b`).test(t) ? 'assigned' : /\b(return|yield)\b/.test(t) ? 'returned' : 'used';
      node.uses.push({ line: i + 1, kind, text: t.slice(0, 140) });
    }
    for (const e of calleesOf(db, sym)) {
      if (!e.args) continue;
      const args = splitArgs(e.args);
      const idx = args.findIndex((a) => new RegExp(`(?<![\\w$])${v}(?![\\w$])`).test(a));
      if (idx < 0) continue;
      const callee = e.to_id ? symbolById(db, e.to_id) : null;
      const pname = callee ? JSON.parse(callee.params || '[]')[idx] : null;
      const flow = { line: e.line, call: e.to_name, argIndex: idx, into: callee ? `${callee.qname} (${callee.file}:${callee.line})` : '(not defined in the project)', parameter: pname ?? null, next: null };
      if (callee && pname && d > 0) flow.next = walk(callee, pname, d - 1);
      node.flows.push(flow);
    }
    return node;
  }
  return { start: walk(p.symbol, variable, depth) };
}
