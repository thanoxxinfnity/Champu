// The tools the server offers, with their input schemas. Each handler returns plain, compact text (the model reads it, so it is short and exact).
import { readFileSync } from 'node:fs';
import { searchChunks } from './search.mjs';
import { indexProject } from './indexer.mjs';
import * as G from './graph.mjs';
import * as F from './facts.mjs';
import * as H from './history.mjs';
import { traceBug, traceValue, snippet } from './trace.mjs';
import { safeJoin, redact } from './privacy.mjs';

const t = (type, description, extra = {}) => ({ type, description, ...extra });
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const loc = (s) => `${s.file}:${s.line}${s.endLine && s.endLine !== s.line ? `-${s.endLine}` : ''}`;
const sym1 = (s) => `${s.kind} ${s.qname}  ${loc(s)}${s.exported ? '  [exported]' : ''}`;
const when = (ts) => new Date(ts).toISOString().replace('T', ' ').slice(0, 16);
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}\n… (cut at ${n} characters)` : s);

function resolveSym(ctx, ref) {
  const p = G.pickSymbol(ctx.db, ref);
  if (!p.symbol) {
    const c = p.candidates.map(sym1).join('\n');
    throw new Error(`no symbol "${ref}".${c ? ` Did you mean:\n${c}` : ' Run index_project, or check the spelling.'}`);
  }
  return p;
}
const ambiguity = (p) => (p.ambiguous ? `\n(note: "${p.symbol.name}" is defined in ${p.candidates.length + 1} places; showing ${loc(p.symbol)}. Use "file:name" to pick another.)` : '');

export const TOOLS = [
  {
    name: 'resume_context',
    description: 'START HERE in a new or compacted chat. Returns the last saved compaction (what was done, decided, still open), the verified facts most relevant to the query, and recent history. Replaces pasting old chats.',
    inputSchema: obj({ query: t('string', 'what you are about to work on (optional)'), budget_chars: t('number', 'default 3000') }),
    async run(ctx, a) {
      const out = [];
      const comp = H.lastCompactions(ctx.db, 1)[0];
      if (comp) out.push(`LAST COMPACTION (${when(comp.ts)}):\n${comp.summary}\n${comp.decisions?.length ? `decisions:\n- ${comp.decisions.join('\n- ')}\n` : ''}${comp.open_questions?.length ? `open questions:\n- ${comp.open_questions.join('\n- ')}\n` : ''}${comp.next_steps?.length ? `next steps:\n- ${comp.next_steps.join('\n- ')}\n` : ''}${comp.files_touched?.length ? `files touched: ${comp.files_touched.join(', ')}` : ''}`);
      else out.push('No compaction saved yet. (Call save_compaction when the chat gets long.)');
      const q = a.query || comp?.summary || 'project';
      const r = await F.recall(ctx, q, { budget: Math.floor((a.budget_chars ?? 3000) * 0.6) });
      out.push(r.facts.length ? `VERIFIED FACTS:\n${r.facts.map((f) => f.line).join('\n')}` : 'No verified facts match.');
      if (r.stale) out.push(`(${r.stale} matching fact(s) are STALE: their code changed. Call verify_facts or re-remember them.)`);
      const h = H.historySearch(ctx, q, 5);
      if (h.length) out.push(`RECENT HISTORY:\n${h.map((e) => `${when(e.ts)} [${e.kind}] ${e.text.slice(0, 160)}`).join('\n')}`);
      return out.join('\n\n');
    },
  },
  {
    name: 'inject_context',
    description: 'Just-in-time context for a task: the best verified facts (each re-checked against the code now), the most relevant symbols, and related history, all within a character budget. Use before starting a change instead of reading many files.',
    inputSchema: obj({ task: t('string', 'what you are about to do'), budget_chars: t('number', 'default 3500') }, ['task']),
    async run(ctx, a) {
      const budget = a.budget_chars ?? 3500;
      const f = await F.recall(ctx, a.task, { budget: Math.floor(budget * 0.4) });
      const hits = await searchChunks(ctx, a.task, { limit: 6 });
      const out = [];
      out.push(f.facts.length ? `VERIFIED FACTS:\n${f.facts.map((x) => x.line).join('\n')}` : 'VERIFIED FACTS: none match.');
      if (f.stale) out.push(`(${f.stale} stale fact(s) omitted)`);
      out.push(`RELEVANT CODE:\n${hits.map((h) => `- ${h.title} (${h.kind}) ${h.file}:${h.line}\n    ${h.text.split('\n').slice(1, 3).join(' | ').slice(0, 200)}`).join('\n')}`);
      const hist = H.historySearch(ctx, a.task, 4);
      if (hist.length) out.push(`HISTORY:\n${hist.map((e) => `${when(e.ts)} [${e.kind}] ${e.text.slice(0, 140)}`).join('\n')}`);
      return clip(out.join('\n\n'), budget + 600);
    },
  },
  {
    name: 'search_code',
    description: 'Search the codebase by MEANING and by words (hybrid). Describe what the code does ("where is the player hurt", "retry logic for uploads"), not only its name. Returns symbols and files with their location.',
    inputSchema: obj({ query: t('string'), limit: t('number', 'default 8'), kind: t('string', 'function | method | class | file ...'), path: t('string', 'only under this path') }, ['query']),
    async run(ctx, a) {
      const hits = await searchChunks(ctx, a.query, { limit: a.limit ?? 8, kind: a.kind, path: a.path });
      if (!hits.length) return 'No matches. Try other words, or run index_project.';
      return hits.map((h, i) => `${i + 1}. ${h.kind === 'file' ? `file ${h.file}` : `${h.kind} ${h.title}`}  ${h.file}:${h.line}${h.end_line > h.line ? `-${h.end_line}` : ''}  (${h.lexRank ? `keyword #${h.lexRank}` : ''}${h.lexRank && h.semRank ? ', ' : ''}${h.semRank ? `meaning #${h.semRank}` : ''})\n   ${h.text.split('\n').slice(1, 3).join(' | ').slice(0, 220)}`).join('\n');
    },
  },
  {
    name: 'project_overview',
    description: 'A cheap map of the project: sizes, languages, top folders, the most-called symbols, and index health.',
    inputSchema: obj({}),
    async run(ctx) {
      const o = G.overview(ctx.db);
      return [`${o.totals.files} files, ${o.totals.symbols} symbols, ${o.totals.edges} call/ref edges (${o.totals.resolved} resolved to a definition).`,
        `languages: ${o.langs.map((l) => `${l.lang} ${l.files} files/${l.lines} lines`).join('; ')}`,
        `folders: ${o.dirs.map((d) => `${d.dir || '.'} (${d.files})`).join(', ')}`,
        `most called: ${o.hot.map((h) => `${h.qname} (${h.callers}) ${h.file}:${h.line}`).join('; ')}`].join('\n');
    },
  },
  {
    name: 'find_symbol',
    description: 'Where is a function, method or class defined? Matches names and Class.method.',
    inputSchema: obj({ name: t('string'), exact: t('boolean'), kind: t('string') }, ['name']),
    async run(ctx, a) {
      const rows = G.findSymbols(ctx.db, a.name, { exact: a.exact, kind: a.kind });
      return rows.length ? rows.map((s) => `${sym1(s)}\n   ${s.signature}`).join('\n') : `no symbol like "${a.name}"`;
    },
  },
  {
    name: 'get_symbol',
    description: 'One symbol in full: signature, doc, source, who calls it and what it calls.',
    inputSchema: obj({ symbol: t('string', 'name, Class.method, or file:name'), max_lines: t('number', 'source lines, default 60') }, ['symbol']),
    async run(ctx, a) {
      const p = resolveSym(ctx, a.symbol);
      const s = p.symbol;
      let src = '';
      try { src = readFileSync(safeJoin(ctx.root, s.file), 'utf8').split('\n').slice(s.line - 1, Math.min(s.endLine, s.line - 1 + (a.max_lines ?? 60))).join('\n'); } catch { /* gone */ }
      const callers = G.callersOf(ctx.db, s).slice(0, 12);
      const callees = G.calleesOf(ctx.db, s).filter((e) => e.to_id).slice(0, 15);
      return `${sym1(s)}${ambiguity(p)}\n${s.doc ? `doc: ${s.doc}\n` : ''}${redact(src)}\n\ncalled by (${callers.length}): ${callers.map((c) => `${c.from_name ?? c.from_file}:${c.line}`).join(', ') || 'nothing found'}\ncalls: ${callees.map((c) => `${c.to_qname}`).join(', ') || 'nothing in the project'}`;
    },
  },
  {
    name: 'find_callers',
    description: 'The REAL callers of a symbol, up the chain (depth 1 = direct). Each says whether the call was resolved to this exact definition or only matched by name (ambiguous).',
    inputSchema: obj({ symbol: t('string'), depth: t('number', 'default 2') }, ['symbol']),
    async run(ctx, a) {
      const p = resolveSym(ctx, a.symbol);
      const tree = G.callerTree(ctx.db, p.symbol, a.depth ?? 2);
      return `${sym1(p.symbol)}${ambiguity(p)}\n` + (tree.length ? tree.map((n) => `${'  '.repeat(n.depth - 1)}← ${n.symbol.qname}  ${n.symbol.file}:${n.line}  [${n.confidence}]`).join('\n') : 'no callers found (it may be an entry point, or dead: try dead_code)');
    },
  },
  {
    name: 'find_callees',
    description: 'What a symbol calls, down the chain (project symbols only).',
    inputSchema: obj({ symbol: t('string'), depth: t('number', 'default 2') }, ['symbol']),
    async run(ctx, a) {
      const p = resolveSym(ctx, a.symbol);
      const tree = G.calleeTree(ctx.db, p.symbol, a.depth ?? 2);
      return `${sym1(p.symbol)}${ambiguity(p)}\n` + (tree.length ? tree.map((n) => `${'  '.repeat(n.depth - 1)}→ ${n.symbol.qname}  ${n.symbol.file}:${n.symbol.line}`).join('\n') : 'calls nothing defined in the project');
    },
  },
  {
    name: 'find_references',
    description: 'Every place a symbol is called or referenced (by name), with the enclosing symbol.',
    inputSchema: obj({ symbol: t('string') }, ['symbol']),
    async run(ctx, a) {
      const p = resolveSym(ctx, a.symbol);
      const refs = G.references(ctx.db, p.symbol);
      return `${sym1(p.symbol)}${ambiguity(p)}\n` + (refs.length ? refs.map((r) => `${r.file}:${r.line}  ${r.kind}  in ${r.inside ?? '(file level)'}`).join('\n') : 'no references');
    },
  },
  {
    name: 'call_path',
    description: 'The shortest chain of calls from one symbol to another ("how does the input handler end up in the damage code?").',
    inputSchema: obj({ from: t('string'), to: t('string') }, ['from', 'to']),
    async run(ctx, a) {
      const A = resolveSym(ctx, a.from).symbol, B = resolveSym(ctx, a.to).symbol;
      const path = G.callPath(ctx.db, A, B);
      return path ? path.map((p, i) => `${i ? '→ ' : ''}${p.symbol.qname}  ${p.symbol.file}:${p.line ?? p.symbol.line}`).join('\n') : `no call path from ${A.qname} to ${B.qname} in the graph (it may go through something dynamic: signals, callbacks, strings)`;
    },
  },
  {
    name: 'impact_analysis',
    description: 'What would be affected if this symbol changed: its transitive callers, grouped by file.',
    inputSchema: obj({ symbol: t('string'), depth: t('number', 'default 5') }, ['symbol']),
    async run(ctx, a) {
      const p = resolveSym(ctx, a.symbol);
      const r = G.impact(ctx.db, p.symbol, a.depth ?? 5);
      return `${sym1(p.symbol)}${ambiguity(p)}\n${r.affected} symbols depend on it, in ${r.files.length} files:\n${r.files.slice(0, 15).map(([f, n]) => `  ${f}  (${n})`).join('\n')}`;
    },
  },
  {
    name: 'file_dependencies',
    description: 'What a file imports and which files import it.',
    inputSchema: obj({ file: t('string') }, ['file']),
    async run(ctx, a) {
      const d = G.fileDependencies(ctx.db, a.file);
      return `imports:\n${d.imports.map((i) => `  ${i.resolved ?? `${i.spec} (package/external)`}${i.names ? `  {${i.names}}` : ''}`).join('\n') || '  none'}\nimported by:\n${d.importedBy.map((i) => `  ${i.file}`).join('\n') || '  nothing'}`;
    },
  },
  {
    name: 'dead_code',
    description: 'Dead code and dead ends. mode "unreferenced": nothing calls it. "unreachable": not reachable from any entry point (finds clusters of dead functions that only call each other). "dead_ends": functions that call nothing in the project (where traces stop). Entry points and framework hooks are excluded; calls through strings/signals are not seen, so check before deleting.',
    inputSchema: obj({ mode: t('string', 'unreferenced | unreachable | dead_ends | all (default all)'), strict: t('boolean', 'treat public exports as dead too if nothing in the project uses them (for apps; leave off for libraries)'), path: t('string') }),
    async run(ctx, a) {
      const mode = a.mode ?? 'all';
      const out = [];
      if (mode === 'all' || mode === 'unreferenced') out.push(`UNREFERENCED:\n${G.deadCode(ctx.db, { strict: a.strict, path: a.path }).map((s) => `  ${sym1(s)}  — ${s.why}`).join('\n') || '  none'}`);
      if (mode === 'all' || mode === 'unreachable') out.push(`UNREACHABLE FROM ANY ENTRY POINT:\n${G.unreachable(ctx.db, { path: a.path, strict: a.strict }).map((s) => `  ${sym1(s)}`).join('\n') || '  none'}`);
      if (mode === 'all' || mode === 'dead_ends') out.push(`DEAD ENDS (called, but call nothing in the project):\n${G.deadEnds(ctx.db, { path: a.path }).map((s) => `  ${sym1(s)}`).join('\n') || '  none'}`);
      return out.join('\n\n');
    },
  },
  {
    name: 'remember_fact',
    description: 'Save a verified fact. REQUIRED: evidence, the exact place that proves it ({file, start_line, end_line} or {file, snippet}). The evidence is checked now; a fact that cannot be proven is refused. Facts are re-verified every time they are recalled; if the code changes they go stale and are not injected.',
    inputSchema: obj({ text: t('string', 'one short, exact statement'), evidence: { type: 'array', items: obj({ file: t('string'), start_line: t('number'), end_line: t('number'), snippet: t('string') }, ['file']) }, tags: { type: 'array', items: t('string') } }, ['text', 'evidence']),
    async run(ctx, a) {
      const r = await F.remember(ctx, a);
      H.logEvent(ctx.db, 'fact', `fact #${r.id}: ${a.text}`, String(r.id));
      return r.duplicate ? `already known as fact #${r.id}` : `saved fact #${r.id}, evidence checked.`;
    },
  },
  {
    name: 'recall_facts',
    description: 'The verified facts that match a query (best first, within a character budget). Each is re-checked against the code before it is returned.',
    inputSchema: obj({ query: t('string'), budget_chars: t('number', 'default 2200') }, ['query']),
    async run(ctx, a) {
      const r = await F.recall(ctx, a.query, { budget: a.budget_chars ?? 2200 });
      return (r.facts.length ? r.facts.map((f) => f.line).join('\n') : 'no verified facts match') + (r.stale ? `\n(${r.stale} stale fact(s) omitted: run verify_facts)` : '');
    },
  },
  {
    name: 'verify_facts',
    description: 'Re-check every fact against the current files. Facts whose code moved are updated; facts whose code changed are marked stale.',
    inputSchema: obj({}),
    async run(ctx) {
      const r = F.verifyAll(ctx);
      return `${r.checked} facts: ${r.verified} verified, ${r.stale.length} stale${r.stale.map((s) => `\n  #${s.id}: ${s.problems.join('; ')}`).join('')}`;
    },
  },
  {
    name: 'list_facts',
    description: 'All facts with their status.',
    inputSchema: obj({ status: t('string', 'verified | stale') }),
    async run(ctx, a) {
      const rows = F.listFacts(ctx.db, a);
      return rows.map((f) => `#${f.id} [${f.status}] ${f.text}`).join('\n') || 'no facts';
    },
  },
  {
    name: 'forget_fact',
    description: 'Retire a fact (it is no longer returned). Optionally say which fact replaces it.',
    inputSchema: obj({ id: t('number'), superseded_by: t('number') }, ['id']),
    async run(ctx, a) { F.forget(ctx, a.id, a.superseded_by ?? null); return `fact #${a.id} retired`; },
  },
  {
    name: 'trace_bug',
    description: 'Trace a bug from the surface to the root. Give any of: symptom (the error text or what you see), stack (a pasted stack trace: Node, Python or Godot), symbol, or file+line. Returns the stack frames mapped to code, ranked root-cause candidates with the evidence for each, the callers (how execution got there), what each relies on, recent git changes, and the next things to check. Follow with trace_value to chase a variable.',
    inputSchema: obj({ symptom: t('string'), stack: t('string'), symbol: t('string'), file: t('string'), line: t('number'), max_depth: t('number') }),
    async run(ctx, a) {
      const r = await traceBug(ctx, { symptom: a.symptom, stack: a.stack, symbol: a.symbol, file: a.file, line: a.line, maxDepth: a.max_depth ?? 4 });
      if (!r.candidates) return r.note;
      const out = [];
      if (r.frames.length) out.push(`STACK (surface first):\n${r.frames.map((f, i) => `  #${i + 1} ${f.file}:${f.line}${f.fn ? `  ${f.fn}` : ''}`).join('\n')}`);
      if (r.story.length) out.push(`HOW EXECUTION GOT THERE:\n${r.story.map((s) => `  ${s}`).join('\n')}`);
      out.push('ROOT-CAUSE CANDIDATES (most likely first):');
      r.candidates.forEach((c, i) => {
        out.push(`${i + 1}. ${c.symbol.qname}  ${c.symbol.file}:${c.hotLine}  score ${c.score}\n   because: ${c.reasons.join('; ')}\n${c.snippet}\n   upward: ${c.upward.slice(0, 6).map((u) => `${'·'.repeat(u.depth)}${u.name}`).join('  ') || 'no callers (entry point?)'}\n   relies on: ${c.downward.slice(0, 8).map((d) => `${d.hot ? '★' : ''}${d.name}:${d.line}`).join(', ') || 'nothing in the project'}${c.git?.log?.[0] ? `\n   last change: ${c.git.log[0].hash} ${c.git.log[0].subject.slice(0, 70)} (${c.git.log[0].author})` : ''}`);
      });
      out.push(`NEXT:\n${r.probes.map((p) => `  - ${p}`).join('\n')}`);
      return out.join('\n');
    },
  },
  {
    name: 'trace_value',
    description: 'Follow a variable through the code: where it is assigned and used in a function, and into which parameter of which callee each call passes it, onward through the chain.',
    inputSchema: obj({ symbol: t('string', 'the function that has the variable'), variable: t('string'), depth: t('number', 'default 4') }, ['symbol', 'variable']),
    async run(ctx, a) {
      const r = traceValue(ctx, a.symbol, a.variable, a.depth ?? 4);
      if (r.error) return r.error;
      const lines = [];
      const show = (n, ind) => {
        lines.push(`${ind}${n.symbol} (${n.file}) — "${n.variable}"`);
        n.uses.slice(0, 10).forEach((u) => lines.push(`${ind}   L${u.line} ${u.kind}: ${u.text}`));
        n.flows.forEach((f) => { lines.push(`${ind}   L${f.line} passes it as argument ${f.argIndex + 1} to ${f.call} → ${f.into}${f.parameter ? `, parameter "${f.parameter}"` : ''}`); if (f.next) show(f.next, `${ind}      `); });
      };
      show(r.start, '');
      return lines.join('\n');
    },
  },
  {
    name: 'checkpoint_create',
    description: 'Take a snapshot of the code and its logic (files, every symbol and its body hash) with a note. Stored locally, compressed, secrets blanked. Use before risky changes and when compacting a long chat.',
    inputSchema: obj({ name: t('string'), note: t('string') }, ['name']),
    async run(ctx, a) { const r = H.checkpointCreate(ctx, a); return `checkpoint "${r.name}" saved. ${r.summary}`; },
  },
  { name: 'checkpoint_list', description: 'All checkpoints, newest first.', inputSchema: obj({}), async run(ctx) { return H.listCheckpoints(ctx.db).map((c) => `${c.name}  ${when(c.ts)}  ${c.files} files/${c.symbols} symbols${c.note ? `  — ${c.note.slice(0, 100)}` : ''}\n   ${c.summary}`).join('\n') || 'no checkpoints'; } },
  {
    name: 'checkpoint_diff',
    description: 'What changed between two checkpoints, or a checkpoint and the working tree ("current"): files, and symbols added/removed/changed. With `path`, a line diff of that file.',
    inputSchema: obj({ a: t('string'), b: t('string', 'default current'), path: t('string') }, ['a']),
    async run(ctx, a) {
      const d = H.checkpointDiff(ctx, a.a, a.b ?? 'current');
      const out = [`files: +${d.files.added.length} -${d.files.removed.length} ~${d.files.modified.length}`];
      for (const [k, v] of Object.entries(d.files)) if (v.length) out.push(`${k}: ${v.slice(0, 25).join(', ')}${v.length > 25 ? ` … (${v.length})` : ''}`);
      const s = d.symbols;
      out.push(`symbols: +${s.added.length} -${s.removed.length} ~${s.changed.length}`);
      if (s.added.length) out.push(`added: ${s.added.slice(0, 20).map((x) => `${x.qname} (${x.file})`).join(', ')}`);
      if (s.removed.length) out.push(`removed: ${s.removed.slice(0, 20).map((x) => `${x.qname} (${x.file})`).join(', ')}`);
      if (s.changed.length) out.push(`changed: ${s.changed.slice(0, 20).map((x) => `${x.qname}${x.signatureChanged ? ' [signature]' : ''}`).join(', ')}`);
      if (a.path) {
        const old = H.checkpointFile(ctx, a.a, a.path);
        let now;
        if ((a.b ?? 'current') === 'current') { try { now = redact(readFileSync(safeJoin(ctx.root, a.path), 'utf8')); } catch { now = ''; } } else now = H.checkpointFile(ctx, a.b, a.path);
        out.push(`\n${a.path}:\n${H.lineDiff(old, now)}`);
      }
      return out.join('\n');
    },
  },
  {
    name: 'checkpoint_file',
    description: 'The contents of a file as it was in a checkpoint (read only; nothing is restored on disk).',
    inputSchema: obj({ checkpoint: t('string'), path: t('string'), max_chars: t('number') }, ['checkpoint', 'path']),
    async run(ctx, a) { return clip(H.checkpointFile(ctx, a.checkpoint, a.path), a.max_chars ?? 12000); },
  },
  {
    name: 'history_search',
    description: 'Search the saved history: events, decisions, facts, checkpoint notes, and (for a symbol name) in which checkpoints it existed.',
    inputSchema: obj({ query: t('string'), limit: t('number') }, ['query']),
    async run(ctx, a) { return H.historySearch(ctx, a.query, a.limit ?? 15).map((e) => `${when(e.ts)} [${e.kind}] ${e.text}`).join('\n') || 'nothing in the history matches'; },
  },
  {
    name: 'log_event',
    description: 'Write a line into the searchable history (a decision, a finding, a bug fixed and why).',
    inputSchema: obj({ kind: t('string', 'decision | finding | bug | note'), text: t('string') }, ['text']),
    async run(ctx, a) { return `logged #${H.logEvent(ctx.db, a.kind ?? 'note', a.text)}`; },
  },
  {
    name: 'save_compaction',
    description: 'Call when the chat is getting long, BEFORE it is compacted: stores what was done, decided, still open, and the next steps, so resume_context can bring it back in the next chat. Optionally takes a checkpoint of the code too.',
    inputSchema: obj({ summary: t('string'), decisions: { type: 'array', items: t('string') }, open_questions: { type: 'array', items: t('string') }, files_touched: { type: 'array', items: t('string') }, next_steps: { type: 'array', items: t('string') }, checkpoint: t('string', 'checkpoint name (optional)') }, ['summary']),
    async run(ctx, a) { const r = H.saveCompaction(ctx, a); return `compaction #${r.id} saved${r.checkpoint ? `; checkpoint "${r.checkpoint.name}": ${r.checkpoint.summary}` : ''}`; },
  },
  { name: 'index_project', description: 'Update the index now (it also updates itself before each query). force=true rebuilds everything.', inputSchema: obj({ force: t('boolean') }), async run(ctx, a) { const s = await indexProject(ctx, { force: !!a.force }); ctx.lastRefresh = Date.now(); return `indexed: ${s.files} files (${s.changed} changed, ${s.removed} removed, ${s.skipped} skipped), ${s.symbols} symbols, ${s.edges} edges`; } },
  {
    name: 'archive_info',
    description: 'Where the private archive lives, how big it is, and the privacy guarantees.',
    inputSchema: obj({}),
    async run(ctx) {
      const i = H.archiveInfo(ctx.dataDir);
      return `archive: ${i.dataDir}\n${i.files} files, ${(i.bytes / 1e6).toFixed(2)} MB (${i.blobs} stored file versions)\nembedder: ${ctx.embedder.id}\nnetwork: none${ctx.embedder.id.startsWith('ollama') ? ' except this machine\'s own loopback (Ollama)' : ''}. Secrets (keys, tokens, .env files, private keys) are never indexed or stored.`;
    },
  },
  { name: 'archive_export', description: 'Copy the whole archive to a folder on this machine (a backup).', inputSchema: obj({ dest: t('string') }, ['dest']), async run(ctx, a) { const i = H.archiveExport(ctx.dataDir, a.dest); return `copied to ${i.dataDir}: ${i.files} files, ${(i.bytes / 1e6).toFixed(2)} MB`; } },
  { name: 'archive_wipe', description: 'Delete the entire archive (index, facts, history, snapshots). Needs confirm "DELETE".', inputSchema: obj({ confirm: t('string') }, ['confirm']), async run(ctx, a) { if (a.confirm !== 'DELETE') throw new Error('confirm must be exactly "DELETE"'); ctx.db.close(); H.archiveWipe(ctx.dataDir); return 'archive deleted. Restart the server to start fresh.'; } },
];

export const TOOL_MAP = new Map(TOOLS.map((x) => [x.name, x]));
export const SKIP_REFRESH = new Set(['archive_info', 'archive_export', 'archive_wipe', 'log_event', 'index_project']);
