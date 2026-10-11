// A Model Context Protocol server over stdio: newline-delimited JSON-RPC 2.0, written by hand so there is nothing to install.
// stdout carries protocol messages only; everything else goes to stderr.
import { createInterface } from 'node:readline';
import { TOOLS, TOOL_MAP, SKIP_REFRESH } from './tools.mjs';
import { indexProject } from './indexer.mjs';
import { invalidate } from './search.mjs';

const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const VERSION = '1.0.0';

const INSTRUCTIONS = `chomu-memory is this project's local memory and code map. It runs on this machine only.
- In a new or compacted chat call resume_context first. Do not ask the user to paste old chats.
- Before reading many files, use search_code (meaning + keywords), find_symbol, find_callers, call_path, impact_analysis.
- For a bug, call trace_bug with the error/stack, then trace_value to follow a variable.
- Record what you learn with remember_fact (it needs evidence: file and lines or a snippet). Only verified facts are ever returned.
- Before a risky change: checkpoint_create. When the chat is long: save_compaction.
- Calls are matched by name; results say "ambiguous" when several places define the same name. Check before deleting "dead" code.`;

export async function serve(ctx, { input = process.stdin, output = process.stdout, autoIndex = true } = {}) {
  const send = (m) => output.write(`${JSON.stringify(m)}\n`);
  const ok = (id, result) => send({ jsonrpc: '2.0', id, result });
  const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
  ctx.refresh = async () => {
    if (Date.now() - (ctx.lastRefresh ?? 0) < 1500) return;
    ctx.lastRefresh = Date.now();
    const s = await indexProject(ctx);
    if (s.changed || s.removed) invalidate(ctx.db);
  };
  ctx.ready = autoIndex ? indexProject(ctx).then((s) => { ctx.lastRefresh = Date.now(); invalidate(ctx.db); console.error(`[chomu-memory] indexed ${s.files} files, ${s.symbols} symbols`); }).catch((e) => console.error('[chomu-memory] index failed:', e.message)) : Promise.resolve();

  async function handle(msg) {
    const { id, method, params } = msg;
    const isNote = id === undefined || id === null;
    try {
      switch (method) {
        case 'initialize': {
          const want = params?.protocolVersion;
          return ok(id, { protocolVersion: SUPPORTED.includes(want) ? want : SUPPORTED[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'chomu-memory', version: VERSION }, instructions: INSTRUCTIONS });
        }
        case 'notifications/initialized': case 'notifications/cancelled': return;
        case 'ping': return ok(id, {});
        case 'tools/list': return ok(id, { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
        case 'resources/list': return ok(id, { resources: [] });
        case 'prompts/list': return ok(id, { prompts: [] });
        case 'tools/call': {
          const tool = TOOL_MAP.get(params?.name);
          if (!tool) return fail(id, -32602, `unknown tool: ${params?.name}`);
          try {
            await ctx.ready;
            if (!SKIP_REFRESH.has(tool.name)) await ctx.refresh();
            const text = await tool.run(ctx, params.arguments ?? {});
            return ok(id, { content: [{ type: 'text', text: String(text) }] });
          } catch (e) {
            return ok(id, { content: [{ type: 'text', text: `error: ${e.message}` }], isError: true });
          }
        }
        default:
          if (isNote) return;
          return fail(id, -32601, `method not found: ${method}`);
      }
    } catch (e) {
      if (!isNote) fail(id, -32603, e.message);
    }
  }

  const rl = createInterface({ input });
  let chain = Promise.resolve();
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return fail(null, -32700, 'parse error'); }
    chain = chain.then(() => (Array.isArray(msg) ? Promise.all(msg.map(handle)) : handle(msg)));
  });
  await new Promise((resolve) => rl.on('close', resolve));
  await chain;
}
