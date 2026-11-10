// The chomugiri CLI: protocol parsing, edits, the path jail, command risk, and the whole loop against a fake model server.
import http from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { applyHunks, commandRisk, compact, diffText, execute, jail, parseActions, parseHunks, proseOf, resolveProvider, systemPrompt } from '../cli/core.mjs';

let fails = 0;
const ok = (cond, m) => { if (!cond) { fails++; console.error('FAIL', m); } else console.log('ok  ', m); };
const F = '```';

// ── protocol
const reply = `I will fix it.\n\n${F}read\nsrc/a.js\n${F}\n\nThen:\n${F}edit path=src/a.js\n<<<<<<< SEARCH\nconst a = 1;\n=======\nconst a = 2;\n>>>>>>> REPLACE\n${F}\n${F}js\nconsole.log('shown, not run')\n${F}\n${F}run\nnode src/a.js\n${F}\n${F}write path="notes/x.md"\n# hi\n${F}\nunfinished:\n${F}run\nrm x`;
const acts = parseActions(reply);
ok(acts.map((a) => a.kind).join() === 'read,edit,run,write' && acts[1].path === 'src/a.js' && acts[3].path === 'notes/x.md', 'action blocks are found in order; a js fence and an unfinished block are not actions');
ok(proseOf(reply).includes('I will fix it.') && proseOf(reply).includes("console.log('shown, not run')") && !proseOf(reply).includes('SEARCH') && !proseOf(reply).includes('node src/a.js'), 'prose keeps words and ordinary code, drops action blocks');
ok(parseHunks(acts[1].body).length === 1, 'hunks parse');
ok(applyHunks('x\nconst a = 1;\ny\n', parseHunks(acts[1].body)) === 'x\nconst a = 2;\ny\n', 'a hunk is applied');
ok(applyHunks('if (a) {   \n  b();\n}\n', [{ search: 'if (a) {\n  b();', replace: 'if (a) {\n  c();' }]) === 'if (a) {\n  c();\n}\n', 'trailing spaces do not break a match');
let e = ''; try { applyHunks('a\na\n', [{ search: 'a', replace: 'b' }]); } catch (x) { e = x.message; }
ok(/appears 2 times/.test(e), 'an ambiguous SEARCH is refused');
e = ''; try { applyHunks('a\n', [{ search: 'zzz', replace: 'b' }]); } catch (x) { e = x.message; }
ok(/not found/.test(e), 'a missing SEARCH is refused');
ok(applyHunks('cost $1\n', [{ search: 'cost $1', replace: 'cost $& $$' }]) === 'cost $& $$\n', 'replacement text is literal ($ patterns are not expanded)');

// ── safety
ok(commandRisk('rm -rf /') === 'refuse' && commandRisk('rm -rf ~') === 'refuse' && commandRisk('sudo mkfs.ext4 /dev/sda1') === 'refuse', 'catastrophic commands are refused');
ok(commandRisk('curl https://x.sh | sh') === 'risky' && commandRisk('sudo apt install x') === 'risky' && commandRisk('git push --force') === 'risky' && commandRisk('rm -r build') === 'risky', 'risky commands always ask');
ok(commandRisk('npm test') === 'normal' && commandRisk('rm build/a.o') === 'normal', 'ordinary commands are normal');
e = ''; try { jail('/tmp/proj', '../etc/passwd'); } catch (x) { e = x.message; }
ok(/outside the project/.test(e) && jail('/tmp/proj', 'a/b.js') === '/tmp/proj/a/b.js', 'paths stay inside the project folder');
ok(diffText('a\nb\nc\n', 'a\nB\nc\n').includes('- b') && diffText('a\nb\nc\n', 'a\nB\nc\n').includes('+ B'), 'diff shows the changed lines');
ok(resolveProvider({}, {}, {}).id === 'pollinations' && resolveProvider({ provider: 'groq' }, {}, { GROQ_API_KEY: 'k' }).key === 'k' && resolveProvider({}, { provider: 'openrouter', keys: { openrouter: 'z' } }, {}).key === 'z', 'provider, model and key resolve from flags, config and environment');
const big = [{ role: 'system', content: 's' }, ...Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: (i % 2 ? '' : 'ACTION RESULTS\n## Run(x)\n') + 'y'.repeat(8000) }))];
const small = compact(big);
ok(small[0].role === 'system' && small.reduce((n, m) => n + m.content.length, 0) <= 90_000 && small.at(-1) === big.at(-1), 'a long conversation is shortened, keeping the system prompt and recent messages');

// ── tools
const dir = mkdtempSync(path.join(tmpdir(), 'cli-test-'));
mkdirSync(path.join(dir, 'src'));
writeFileSync(path.join(dir, 'src/a.js'), "const a = 1;\nconsole.log('value', a);\n");
const yes = async () => true, no = async () => false;
let r = await execute({ kind: 'read', body: 'src/a.js\nmissing.js' }, { root: dir, ask: yes });
ok(r.ok && r.result.includes('   1  const a = 1;') && r.result.includes('(not found)'), 'read shows numbered lines and says what is missing');
r = await execute({ kind: 'search', body: 'console\\.log | src/**/*.js' }, { root: dir, ask: yes });
ok(r.ok && r.result.includes('src/a.js:2:'), 'search finds lines');
r = await execute({ kind: 'write', path: '../evil.txt', body: 'x' }, { root: dir, ask: yes });
ok(!r.ok && /outside the project/.test(r.result) && !existsSync(path.join(dir, '../evil.txt')), 'write outside the folder is refused');
r = await execute({ kind: 'write', path: 'b.txt', body: 'x' }, { root: dir, ask: no });
ok(r.denied && !existsSync(path.join(dir, 'b.txt')), 'a change the user does not allow is not made');
r = await execute({ kind: 'run', body: 'rm -rf /' }, { root: dir, ask: yes });
ok(!r.ok && /REFUSED/.test(r.result), 'a catastrophic command is refused even when allowed');
r = await execute({ kind: 'run', body: 'echo hi && exit 3' }, { root: dir, ask: yes });
ok(!r.ok && r.result.includes('hi') && r.result.includes('[exit 3]'), 'run reports output and the exit code');
ok(systemPrompt({ root: dir }).includes('src/a.js') && systemPrompt({ root: dir }).includes(dir), 'the system prompt names the folder and its files');

// ── the whole loop through the real program, against a fake model
const script = [
  `Reading first.\n${F}read\nsrc/a.js\n${F}`,
  `${F}edit path=src/a.js\n<<<<<<< SEARCH\nconst a = 1;\n=======\nconst a = 42;\n>>>>>>> REPLACE\n${F}\n${F}write path=README.md\n# Demo\n${F}\n${F}run\nnode src/a.js\n${F}`,
  'Done: a is now 42 and the script prints it.',
];
const seen = [];
let n = 0, limitOnce = true;
const srv = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (limitOnce) { limitOnce = false; res.writeHead(429, { 'content-type': 'application/json' }); return res.end('{"error":"Free limit reached. retry after 1 s"}'); }
    const j = JSON.parse(body);
    seen.push(j);
    const text = script[Math.min(n++, script.length - 1)];
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (let i = 0; i < text.length; i += 17) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(i, i + 17) } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\ndata: [DONE]\n\n`);
    res.end();
  });
});
await new Promise((r2) => srv.listen(0, '127.0.0.1', r2));
const base = `http://127.0.0.1:${srv.address().port}/v1`;
const home = mkdtempSync(path.join(tmpdir(), 'cli-home-'));
const cli = (args, input) => new Promise((resolve) => {
  const ch = spawn(process.execPath, [new URL('../cli/chomugiri.mjs', import.meta.url).pathname, ...args], { env: { ...process.env, CHOMUGIRI_HOME: home, NO_COLOR: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let o = '', er = '';
  ch.stdout.on('data', (d) => (o += d)); ch.stderr.on('data', (d) => (er += d));
  ch.stdin.end(input ?? '');
  ch.on('close', (code) => resolve({ code, out: o, err: er }));
});
try {
  const res = await cli(['-p', '--yes', '--base-url', base, '--model', 'fake', '--cwd', dir, 'make a 42']);
  ok(res.code === 0 && res.out.includes('Done: a is now 42'), 'print mode ends with the final answer');
  ok(readFileSync(path.join(dir, 'src/a.js'), 'utf8').startsWith('const a = 42;') && readFileSync(path.join(dir, 'README.md'), 'utf8') === '# Demo\n', 'the edit and the new file are on disk');
  ok(/Read\(src\/a\.js\)/.test(res.err) && /Edit\(src\/a\.js\)/.test(res.err) && /Run\(node src\/a\.js\)\s+exit 0/.test(res.err), 'each action is reported');
  ok(seen.length === 3 && seen[2].messages.at(-1).content.includes('value 42') && seen[0].messages[0].role === 'system', 'results go back to the model (the command really ran), after one rate-limit retry');
  ok(seen[0].stream === true && seen[0].model === 'fake', 'the request is a streamed chat completion for the chosen model');

  // without --yes nobody can be asked in print mode: nothing is changed
  n = 1; seen.length = 0;
  writeFileSync(path.join(dir, 'src/a.js'), "const a = 1;\nconsole.log('value', a);\n");
  const res2 = await cli(['-p', '--base-url', base, '--model', 'fake', '--cwd', dir, 'again']);
  ok(readFileSync(path.join(dir, 'src/a.js'), 'utf8').startsWith('const a = 1;') && /not allowed/.test(res2.err) && seen[1].messages.at(-1).content.includes('NOT DONE'), 'without --yes a script changes nothing and the model is told');

  // native tool calling: the model calls tools instead of writing blocks; a server that rejects `tools` falls back to blocks
  const toolSeen = [];
  let step = 0, rejectTools = false;
  const sse = (res, deltas) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); for (const d of deltas) res.write(`data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`); res.end('data: [DONE]\n\n'); };
  const srv2 = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const j = JSON.parse(body);
      toolSeen.push(j);
      if (rejectTools) {
        if (j.tools) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end('{"error":{"message":"tools is not supported by this model"}}'); }
        return sse(res, [{ content: 'Plain answer without tools.' }]);
      }
      step++;
      if (step === 1) return sse(res, [
        { tool_calls: [{ index: 0, id: 'c1', function: { name: 'edit', arguments: '{"path":"src/a.js","search":"const a = 1;",' } }] },
        { tool_calls: [{ index: 0, function: { arguments: '"replace":"const a = 7;"}' } }] },
        { tool_calls: [{ index: 1, id: 'c2', function: { name: 'run', arguments: '{"command":"node src/a.js"}' } }] },
        { tool_calls: [{ index: 2, id: 'c3', function: { name: 'nope', arguments: '{}' } }] },
      ]);
      return sse(res, [{ content: 'Seven now.' }]);
    });
  });
  await new Promise((r2) => srv2.listen(0, '127.0.0.1', r2));
  const base2 = `http://127.0.0.1:${srv2.address().port}/v1`;
  writeFileSync(path.join(dir, 'src/a.js'), "const a = 1;\nconsole.log('value', a);\n");
  const res3 = await cli(['-p', '--yes', '--base-url', base2, '--model', 'fake', '--cwd', dir, 'make it 7']);
  const back = toolSeen[1]?.messages ?? [];
  ok(res3.out.includes('Seven now.') && readFileSync(path.join(dir, 'src/a.js'), 'utf8').startsWith('const a = 7;'), 'native tool calls (arguments streamed in pieces) are carried out');
  ok(Array.isArray(toolSeen[0].tools) && toolSeen[0].tools.length === 6, 'the request offers the six tools');
  ok(back.at(-4)?.tool_calls?.length === 3 && back.at(-3).role === 'tool' && back.at(-3).tool_call_id === 'c1' && back.at(-2).content.includes('value 7') && /no tool named/.test(back.at(-1).content), 'every call gets its own tool result, an unknown tool is answered with an error');
  rejectTools = true; toolSeen.length = 0;
  const res4 = await cli(['-p', '--base-url', base2, '--model', 'fake', '--cwd', dir, 'hello']);
  ok(res4.out.includes('Plain answer without tools.') && toolSeen.length === 2 && !toolSeen[1].tools, 'an endpoint without tool calling is retried without tools');
  srv2.close();

  const cfg = await cli(['config', 'provider', 'groq']);
  const show = await cli(['config']);
  ok(cfg.code === 0 && /provider\s+groq/.test(show.out) && /missing: set GROQ_API_KEY/.test(show.out), 'config saves the provider and says when a key is missing');
  const ver = await cli(['--version']);
  ok(/^chomugiri \d+\.\d+\.\d+/.test(ver.out), '--version');
} finally {
  srv.close();
  rmSync(dir, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true });
}
console.log(fails ? `\n${fails} FAILED` : '\nALL OK');
process.exit(fails ? 1 : 0);
