// Agent jobs on the bridge: the terminal runs a reply's commands itself, hands the results back and goes on, with the app closed.
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { actionsOf, applyEdits, createJobs, neverRun } from '../agent/jobs.mjs';

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error('FAIL', m); } else console.log('ok  ', m); };
const F = '```';

// ── parsing
const reply = `Writing it.\n${F}js path=src/a.js\nconsole.log('value', 6 * 7);\n${F}\n${F}bash path=@terminal cwd=.\nnode src/a.js\n${F}\n${F}bash\necho shown only\n${F}\n${F}bash path=@terminal\nunfinished`;
const acts = actionsOf(reply);
ok(acts.length === 2 && acts[0].kind === 'file' && acts[0].path === 'src/a.js' && acts[1].kind === 'run' && acts[1].command === 'node src/a.js' && acts[1].cwd === '.', 'a reply gives its file and its terminal command; a bare bash block and an unfinished block are not actions');
ok(applyEdits('a\nb\nc\n', '<<<<<<< SEARCH\nb\n=======\nB\n>>>>>>> REPLACE') === 'a\nB\nc\n' && applyEdits('x', 'plain file') === null, 'SEARCH/REPLACE edits apply; a whole file is not an edit');
const un = actionsOf('Fixing.\n<<<<<<< SEARCH path=src/a.js\nold line\n=======\nnew line\n>>>>>>> REPLACE\n<<<<<<< SEARCH path=new.txt\n=======\nhello\n>>>>>>> REPLACE');
ok(un.length === 2 && un[0].kind === 'edit' && un[0].path === 'src/a.js' && un[0].search === 'old line' && un[0].replace === 'new line' && un[1].search === '' && un[1].replace === 'hello', "the app's unfenced edit form is understood, an empty SEARCH included");
ok(neverRun('rm -rf /') && neverRun('sudo mkfs.ext4 /dev/sda') && !neverRun('rm -rf build') && !neverRun('npm test'), 'destructive commands are never run unattended');

// ── the loop, against a scripted model
const dir = mkdtempSync(path.join(tmpdir(), 'agentjobs-'));
const ws = path.join(dir, 'ws');
const sent = [];
const script = [
  `Step one.\n${F}js path=src/a.js\nconsole.log('value', 6 * 7);\n${F}\n${F}bash path=@terminal cwd=.\nnode src/a.js\n${F}`,
  `It printed 42. Now an edit and a risky command.\n${F}js path=src/a.js\n<<<<<<< SEARCH\n6 * 7\n=======\n6 * 8\n>>>>>>> REPLACE\n${F}\n${F}bash path=@terminal\nnode src/a.js && rm -rf /\n${F}\n${F}js path=../outside.js\nnope\n${F}\n${F}bash path=@terminal\nnode src/a.js; exit 3\n${F}`,
  'All done: the value is 48.',
];
let n = 0;
const fetchImpl = async (_url, init) => {
  const body = JSON.parse(init.body);
  sent.push(body);
  const text = script[Math.min(n++, script.length - 1)];
  return new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 7 } }), { status: 200, headers: { 'content-type': 'application/json' } });
};
const wait = async (jobs, id) => { for (let i = 0; i < 400; i++) { const j = jobs.get(id); if (j.status !== 'running') return j; await new Promise((r) => setTimeout(r, 25)); } throw new Error('the job did not end'); };
const recipe = () => [{ url: 'https://model.example/v1/chat/completions', stream: false, body: { model: 'm', messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'make it' }] } }];
try {
  const jobs = createJobs({ dir: path.join(dir, 'jobs'), fetchImpl, workspace: ws, notify: () => {} });
  jobs.start({ id: 'agent-1', recipes: recipe(), agent: { maxSteps: 6 } });
  const j = await wait(jobs, 'agent-1');
  ok(j.status === 'done' && j.content.includes('Step one.') && j.content.includes('It printed 42.') && j.content.endsWith('All done: the value is 48.'), 'the job ends with the final answer and keeps every step of the transcript');
  ok(j.runs.length === 3 && j.runs[0].exitCode === 0 && j.runs[0].output.includes('value 42'), 'the first command really ran on the terminal');
  ok(j.runs[1].exitCode === null && /REFUSED/.test(j.runs[1].output) && j.runs[2].exitCode === 3 && j.runs[2].output.includes('value 48'), 'a destructive command is refused, a failing one reports its exit code, and the edit was applied before it ran');
  ok(readFileSync(path.join(ws, 'src/a.js'), 'utf8').includes('6 * 8') && !existsSync(path.join(dir, 'outside.js')) && j.files.join() === 'src/a.js', 'files are written inside the workspace only');
  ok(sent.length === 3 && sent[1].messages.length === 4 && sent[1].messages[2].role === 'assistant' && sent[1].messages[3].content.includes('value 42') && sent[1].messages[3].content.includes('[exit 0]'), 'the results go back to the model after its own reply');
  ok(sent[2].messages.at(-1).content.includes('NOT WRITTEN') && sent[2].messages.at(-1).content.includes('[exit 3]') && sent[2].messages.at(-1).content.includes('REFUSED'), 'refusals, a file outside the workspace and a failure are all told to the model');
  ok(jobs.list()[0].commands === 3 && jobs.list()[0].steps === 3, 'the summary counts steps and commands');

  // a plain job (no `agent`) is still one answer and runs nothing
  n = 0; sent.length = 0;
  rmSync(ws, { recursive: true, force: true });
  jobs.start({ id: 'plain-1', recipes: recipe() });
  const p = await wait(jobs, 'plain-1');
  ok(p.status === 'done' && p.runs.length === 0 && sent.length === 1 && !existsSync(path.join(ws, 'src/a.js')), 'a plain job is one answer: no command runs, no file is written');

  // the step limit ends a job that would go on forever
  n = 0; sent.length = 0;
  const loop = createJobs({ dir: path.join(dir, 'jobs2'), workspace: ws, notify: () => {}, fetchImpl: async (_u, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ choices: [{ message: { content: `again\n${F}bash path=@terminal\necho hi\n${F}` } }] }), { status: 200, headers: { 'content-type': 'application/json' } }); } });
  loop.start({ id: 'loop-1', recipes: recipe(), agent: { maxSteps: 3 } });
  const l = await wait(loop, 'loop-1');
  ok(l.status === 'done' && l.runs.length === 3 && sent.length === 3 && /Stopped after 3 rounds/.test(l.content), 'the step limit stops a run that never finishes');

  // the bridge's allow-list applies
  n = 0;
  const strict = createJobs({ dir: path.join(dir, 'jobs3'), workspace: ws, notify: () => {}, fetchImpl, allowed: (c) => c.startsWith('echo') });
  strict.start({ id: 'strict-1', recipes: recipe(), agent: {} });
  const s = await wait(strict, 'strict-1');
  ok(s.runs[0].exitCode === null && /allow-list/.test(s.runs[0].output), "the terminal's own allow-list is respected");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(fails ? `\n${fails} FAILED` : '\nALL OK');
process.exit(fails ? 1 : 0);
