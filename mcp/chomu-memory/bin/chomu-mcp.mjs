#!/usr/bin/env node
// chomu-mcp serve | index | search "words" | stats | doctor | checkpoint <name> | wipe --yes
//   --root <dir>   the project (default: the current folder)
//   --data <dir>   where the archive lives (default: <root>/.chomu-memory)
//   --embed hash|ollama   how meaning is computed (default hash: built in, no model, no network)
//   --no-auto-index       do not index at start-up
import { makeContext } from '../src/context.mjs';
import { serve, VERSION } from '../src/server.mjs';
import { indexProject } from '../src/indexer.mjs';
import { TOOL_MAP } from '../src/tools.mjs';
import { getMeta } from '../src/db.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith('--') ? argv.shift() : 'serve';
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i < 0 ? undefined : argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true; };
const rest = argv.filter((a, i) => !a.startsWith('--') && !(argv[i - 1] || '').startsWith('--') || (argv[i - 1] === '--yes'));

const ctx = makeContext({ root: flag('root'), data: flag('data'), embed: flag('embed') });

async function tool(name, args) { return TOOL_MAP.get(name).run(ctx, args); }

try {
  if (cmd === 'serve') {
    console.error(`[chomu-memory ${VERSION}] project ${ctx.root}  archive ${ctx.dataDir}  embedder ${ctx.embedder.id}`);
    await serve(ctx, { autoIndex: !flag('no-auto-index') });
  } else if (cmd === 'index') {
    const s = await indexProject(ctx, { force: !!flag('force') });
    console.log(`indexed ${s.files} files (${s.changed} changed, ${s.removed} removed, ${s.skipped} skipped), ${s.symbols} symbols, ${s.edges} edges`);
  } else if (cmd === 'search') {
    await indexProject(ctx);
    console.log(await tool('search_code', { query: rest.join(' ') }));
  } else if (cmd === 'stats') {
    await indexProject(ctx);
    console.log(await tool('project_overview', {}));
  } else if (cmd === 'checkpoint') {
    await indexProject(ctx);
    console.log(await tool('checkpoint_create', { name: rest[0], note: rest.slice(1).join(' ') }));
  } else if (cmd === 'doctor') {
    console.log(await tool('archive_info', {}));
    console.log(`last index: ${getMeta(ctx.db, 'last_index') ?? 'never'}`);
    console.log('This program makes no network requests (unless --embed ollama, which only talks to 127.0.0.1) and writes only inside the archive folder.');
  } else if (cmd === 'wipe') {
    console.log(flag('yes') ? await tool('archive_wipe', { confirm: 'DELETE' }) : 'add --yes to delete the archive');
  } else {
    console.error('usage: chomu-mcp serve|index|search|stats|doctor|checkpoint|wipe [--root dir] [--data dir] [--embed hash|ollama]');
    process.exitCode = 2;
  }
} finally {
  if (cmd !== 'wipe' && cmd !== 'serve') { try { ctx.db.close(); } catch { /* closed */ } }
}
