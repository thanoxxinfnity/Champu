/** node --experimental-strip-types --test scripts/test-github-build.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GitHubError, SIDELOAD_KEYSTORE_BASE64, appLabel, buildOnGitHub, canBuildApk, checkGitHubToken, dartPackageName, detectProject,
  flutterWorkflow, gradleWorkflow, pushable, repoNameFor,
} from '../src/lib/deploy/github.ts';

// ── pure helpers ────────────────────────────────────────────────────────────

test('project kinds: only Flutter and Gradle make an APK, a site goes to Vercel', () => {
  assert.equal(detectProject(['pubspec.yaml', 'lib/main.dart']), 'flutter');
  assert.equal(detectProject(['settings.gradle.kts', 'app/build.gradle.kts']), 'gradle');
  assert.equal(detectProject(['index.html', 'style.css']), 'web');
  assert.equal(detectProject(['package.json']), 'web');
  assert.equal(detectProject(['notes.md']), 'unknown');
  assert.equal(canBuildApk('flutter'), true);
  assert.equal(canBuildApk('gradle'), true);
  assert.equal(canBuildApk('web'), false);
  assert.equal(canBuildApk('unknown'), false);
});

test('repository and app names are made safe', () => {
  assert.equal(repoNameFor('My Todo App!'), 'my-todo-app');
  assert.equal(repoNameFor('  ***  '), 'chomugiri-app');
  assert.equal(appLabel('Todo "App"; rm -rf /'), 'Todo App rm -rf');
  assert.equal(appLabel('$(whoami)'), 'whoami');
  assert.equal(appLabel(''), 'Chomugiri App');
  assert.equal(dartPackageName('name: todo_app\nversion: 1', 'x'), 'todo_app');
  assert.equal(dartPackageName(undefined, 'My-App'), 'my_app');
  assert.equal(dartPackageName('name: 9lives', 'x'), 'app_9lives');
});

test('files from a model: workflows, android/ for Flutter and paths that climb out are never pushed', () => {
  const r = pushable([
    { path: 'pubspec.yaml', content: 'x' },
    { path: './lib/main.dart', content: 'x' },
    { path: '.github/workflows/evil.yml', content: 'x' },
    { path: 'android/app/build.gradle', content: 'x' },
    { path: '../up.dart', content: 'x' },
    { path: '/etc/passwd', content: 'x' },
  ], 'flutter');
  assert.deepEqual(r.files.map((f) => f.path), ['pubspec.yaml', 'lib/main.dart']);
  assert.equal(r.dropped.length, 4);
  // a Gradle project owns its android files
  assert.deepEqual(pushable([{ path: 'app/src/main/AndroidManifest.xml', content: 'x' }], 'gradle').files.length, 1);
});

test('the fixed signing key is a real Java keystore, and both workflows install it before building', () => {
  const bytes = Buffer.from(SIDELOAD_KEYSTORE_BASE64, 'base64');
  assert.equal(bytes.readUInt32BE(0), 0xfeedfeed, 'JKS magic number');
  for (const wf of [flutterWorkflow({ pkg: 'todo_app', label: 'Todo', apkName: 'todo' }), gradleWorkflow({ label: 'Todo', apkName: 'todo' })]) {
    assert.ok(wf.includes('~/.android/debug.keystore'));
    assert.ok(wf.indexOf('~/.android/debug.keystore') < wf.indexOf('gradle assembleDebug') + (wf.includes('gradle assembleDebug') ? 0 : 1e9) || wf.includes('flutter build'));
    assert.ok(wf.includes('${{ github.run_number }}'), 'GitHub expressions must reach the file unescaped');
    assert.ok(wf.includes('gh release create'));
    assert.ok(!wf.includes('\\${'), 'no stray escape left in the yaml');
  }
  const flutter = flutterWorkflow({ pkg: 'todo_app', label: 'Todo', apkName: 'todo' });
  assert.ok(flutter.indexOf('debug.keystore') < flutter.indexOf('flutter build apk'), 'key before the build');
  assert.ok(flutter.includes('--project-name todo_app'));
  const gradle = gradleWorkflow({ label: 'Todo', apkName: 'todo' });
  assert.ok(gradle.indexOf('debug.keystore') < gradle.indexOf('gradle assembleDebug'), 'key before the build');
  assert.ok(gradle.includes('platforms;android-35') && gradle.includes('-PversionCodeOverride='));
  // the generated project is pointed at the key explicitly, not left to whatever Gradle finds under ~/.android
  assert.ok(gradle.includes('export SIDELOAD_KEYSTORE="$HOME/.android/debug.keystore"'));
  assert.ok(gradle.indexOf('SIDELOAD_KEYSTORE') > gradle.indexOf('debug.keystore'));
});

// ── a fake GitHub ───────────────────────────────────────────────────────────

function fakeGitHub(opts = {}) {
  const s = {
    // null must stay null (a fine-grained token sends no scope header), so `??` would be wrong here
    scopes: 'scopes' in opts ? opts.scopes : 'repo, workflow',
    repoExists: opts.repoExists ?? false,
    conclusion: opts.conclusion ?? 'success',
    runsBeforeFound: opts.runsBeforeFound ?? 1,
    pollsUntilDone: opts.pollsUntilDone ?? 2,
    releaseAsset: opts.releaseAsset ?? true,
    user: opts.user ?? 'tester',
    logStatus: opts.logStatus ?? 200,
    calls: [], tree: null, commitMessage: null, createdRepo: null, tokenSeen: new Set(),
  };
  let runLookups = 0;
  let getRunCalls = 0;
  const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    const path = u.pathname + u.search;
    s.calls.push(`${method} ${path}`);
    s.tokenSeen.add(init.headers?.Authorization);
    const body = init.body ? JSON.parse(init.body) : null;
    if (opts.token401) return json({ message: 'Bad credentials' }, 401);
    if (path === '/user') return json({ login: s.user }, 200, s.scopes === null ? {} : { 'x-oauth-scopes': s.scopes });
    if (method === 'GET' && path === `/repos/${s.user}/todo-app`) return s.repoExists || s.createdRepo ? json({ html_url: `https://github.com/${s.user}/todo-app`, default_branch: 'main' }) : json({ message: 'Not Found' }, 404);
    if (method === 'POST' && path === '/user/repos') { s.createdRepo = body; return json({ html_url: `https://github.com/${s.user}/todo-app`, default_branch: 'main' }, 201); }
    if (path.endsWith('/git/ref/heads/main')) return json({ object: { sha: 'p1' } });
    if (path.endsWith('/git/commits/p1')) return json({ tree: { sha: 't0' } });
    if (method === 'POST' && path.endsWith('/git/blobs')) return json({ sha: 'blob1' }, 201);
    if (method === 'POST' && path.endsWith('/git/trees')) { s.tree = body.tree; return json({ sha: 't1' }, 201); }
    if (method === 'POST' && path.endsWith('/git/commits')) { s.commitMessage = body.message; return json({ sha: 'c1' }, 201); }
    if (method === 'PATCH' && path.endsWith('/git/refs/heads/main')) return json({});
    if (path.includes('/actions/runs?head_sha=c1')) return ++runLookups <= s.runsBeforeFound ? json({ workflow_runs: [] }) : json({ workflow_runs: [{ id: 77, run_number: 5, status: 'queued', html_url: 'https://github.com/run/77' }] });
    if (path.endsWith('/actions/runs/77')) { const done = ++getRunCalls >= s.pollsUntilDone; return json({ id: 77, run_number: 5, status: done ? 'completed' : 'in_progress', conclusion: done ? s.conclusion : null, html_url: 'https://github.com/run/77' }); }
    if (path.endsWith('/releases/tags/build-5')) return s.releaseAsset ? json({ html_url: 'https://github.com/rel/5', assets: [{ name: 'todo-app.apk', browser_download_url: 'https://github.com/dl/todo-app.apk' }] }) : json({ message: 'Not Found' }, 404);
    if (path.endsWith('/releases/latest')) return json({ message: 'Not Found' }, 404);
    if (path.endsWith('/actions/runs/77/jobs')) return json({ jobs: [{ id: 900, conclusion: 'failure', steps: [{ name: 'Build', conclusion: 'failure' }] }] });
    if (path.endsWith('/actions/jobs/900/logs')) return s.logStatus === 200 ? new Response('2026-01-01T00:00:00.0000000Z \u001b[31merror\u001b[0m: Could not find kotlin 9.9\nother line\n', { status: 200 }) : json({ message: 'x' }, s.logStatus);
    return json({ message: `unexpected ${method} ${path}` }, 404);
  };
  return { s, fetchImpl };
}

const flutterFiles = [
  { path: 'pubspec.yaml', content: 'name: todo_app\nflutter:\n  uses-material-design: true\n' },
  { path: 'lib/main.dart', content: "void main() {}\n// ünïcode ✓\n" },
  { path: '.github/workflows/evil.yml', content: 'on: push' },
];
const noSleep = async () => {};
const build = (g, extra = {}) => buildOnGitHub({ token: 'ghp_secret', files: flutterFiles, title: 'Todo App', fetchImpl: g.fetchImpl, sleep: noSleep, now: (() => { let t = 1_700_000_000_000; return () => (t += 20_000); })(), ...extra });

// ── the build ───────────────────────────────────────────────────────────────

test('a Flutter project is pushed, built on Actions and comes back with a download link', async () => {
  const g = fakeGitHub();
  const steps = [];
  const out = await build(g, { onStep: (t) => steps.push(t) });
  assert.equal(out.ok, true);
  assert.equal(out.apkUrl, 'https://github.com/dl/todo-app.apk');
  assert.equal(out.runUrl, 'https://github.com/run/77');
  assert.equal(out.repoUrl, 'https://github.com/tester/todo-app');
  assert.equal(out.kind, 'flutter');
  // a new repository was made, public so the link opens without signing in
  assert.deepEqual(g.s.createdRepo, { name: 'todo-app', private: false, auto_init: true, description: 'Built with Chomugiri' });
  // exactly one commit, holding the project and the workflow, and nothing the model tried to slip in
  const paths = g.s.tree.map((t) => t.path).sort();
  assert.deepEqual(paths, ['.github/workflows/chomugiri-apk.yml', '.gitignore', 'lib/main.dart', 'pubspec.yaml']);
  assert.deepEqual(out.dropped, ['.github/workflows/evil.yml']);
  const wf = g.s.tree.find((t) => t.path === '.github/workflows/chomugiri-apk.yml').content;
  assert.ok(wf.includes('--project-name todo_app') && wf.includes('flutter build apk'));
  assert.equal(g.s.tree.find((t) => t.path === 'lib/main.dart').content, "void main() {}\n// ünïcode ✓\n", 'text goes through untouched');
  assert.ok(/^Chomugiri: build 20\d\d-/.test(g.s.commitMessage));
  // progress was reported in order
  const order = ['Checking the GitHub token', 'Preparing repository tester/todo-app', 'Pushing 4 files', 'Waiting for GitHub Actions to start', 'Building the APK', 'APK ready'];
  let at = -1;
  for (const want of order) { const i = steps.findIndex((x, k) => k > at && x.startsWith(want)); assert.ok(i > at, `step "${want}" missing or out of order in ${JSON.stringify(steps)}`); at = i; }
  // the token went only in the Authorization header, as a bearer token
  assert.deepEqual([...g.s.tokenSeen], ['Bearer ghp_secret']);
});

test('a second build of the same app reuses its repository', async () => {
  const g = fakeGitHub({ repoExists: true });
  await build(g);
  assert.equal(g.s.createdRepo, null);
  assert.ok(g.s.calls.includes('PATCH /repos/tester/todo-app/git/refs/heads/main'));
});

test('a private repository is made when asked for', async () => {
  const g = fakeGitHub();
  await build(g, { isPublic: false });
  assert.equal(g.s.createdRepo.private, true);
});

test('a Gradle project (Android suite) gets the Gradle workflow and keeps its android files', async () => {
  const g = fakeGitHub();
  const out = await buildOnGitHub({
    token: 't', title: 'Todo App', fetchImpl: g.fetchImpl, sleep: noSleep,
    files: [{ path: 'settings.gradle.kts', content: 'rootProject.name = "x"' }, { path: 'app/build.gradle.kts', content: 'x' }, { path: 'app/src/main/AndroidManifest.xml', content: '<m/>' }],
  });
  assert.equal(out.kind, 'gradle');
  assert.ok(g.s.tree.some((t) => t.path === 'app/src/main/AndroidManifest.xml'));
  assert.ok(g.s.tree.find((t) => t.path.startsWith('.github/')).content.includes('gradle assembleDebug'));
});

test('binary files are sent as blobs, text inline', async () => {
  const g = fakeGitHub();
  await build(g, { files: [...flutterFiles, { path: 'assets/icon.png', content: 'iVBORw0KGgo=', encoding: 'base64' }] });
  assert.equal(g.s.tree.find((t) => t.path === 'assets/icon.png').sha, 'blob1');
  assert.ok(g.s.calls.some((c) => c.endsWith('/git/blobs')));
});

test('GitHub is given time to start the run', async () => {
  const g = fakeGitHub({ runsBeforeFound: 3 });
  const out = await build(g);
  assert.equal(out.ok, true);
  assert.equal(g.s.calls.filter((c) => c.includes('/actions/runs?head_sha=')).length, 4);
});

test('a failed build returns the part of the log that explains it, and no link', async () => {
  const g = fakeGitHub({ conclusion: 'failure' });
  const out = await build(g);
  assert.equal(out.ok, false);
  assert.equal(out.apkUrl, null);
  assert.ok(out.log.includes('Failed step: Build'));
  assert.ok(out.log.includes('Could not find kotlin 9.9'));
  assert.ok(!out.log.includes('\u001b'), 'colour codes removed');
});

test('a log GitHub will not hand to a browser still gives a useful message', async () => {
  const g = fakeGitHub({ conclusion: 'failure', logStatus: 403 });
  const out = await build(g);
  assert.equal(out.ok, false);
  assert.ok(/open the run page/i.test(out.log));
});

test('a green build whose release has no APK is not reported as success', async () => {
  const g = fakeGitHub({ releaseAsset: false });
  const out = await build(g);
  assert.equal(out.ok, false);
  assert.equal(out.apkUrl, null);
});

test('a token that GitHub refuses says so in plain words', async () => {
  const g = fakeGitHub({ token401: true });
  await assert.rejects(build(g), (e) => e instanceof GitHubError && e.status === 401 && /invalid or expired/.test(e.message));
});

test('a token without the workflow scope is caught before anything is pushed', async () => {
  const g = fakeGitHub({ scopes: 'repo' });
  await assert.rejects(build(g), /no "workflow" scope/);
  assert.ok(!g.s.calls.some((c) => c.startsWith('POST')), 'nothing was created');
  const g2 = fakeGitHub({ scopes: 'gist' });
  await assert.rejects(build(g2), /no "repo" scope/);
});

test('a fine-grained token (no scope header) is allowed to try', async () => {
  const g = fakeGitHub({ scopes: null });
  assert.equal((await build(g)).ok, true);
});

test('no token, a website and an empty project each get their own honest message', async () => {
  const g = fakeGitHub();
  await assert.rejects(buildOnGitHub({ token: '  ', files: flutterFiles, title: 'x', fetchImpl: g.fetchImpl }), /Add your GitHub token/);
  await assert.rejects(buildOnGitHub({ token: 't', files: [{ path: 'index.html', content: '<p>' }], title: 'x', fetchImpl: g.fetchImpl }), /website, not an app.*Deploy \(Vercel\)/);
  await assert.rejects(buildOnGitHub({ token: 't', files: [{ path: 'notes.md', content: 'x' }], title: 'x', fetchImpl: g.fetchImpl }), /Nothing to build/);
  assert.equal(g.s.calls.length, 0, 'no request was made for any of them');
});

test('a build that never finishes stops waiting and says where to look', async () => {
  const g = fakeGitHub({ pollsUntilDone: 1e9 });
  await assert.rejects(build(g, { timeoutMs: 5 * 60_000 }), (e) => e instanceof GitHubError && /did not finish in 5 minutes/.test(e.message) && e.message.includes('https://github.com/run/77'));
});

test('being offline is reported, not thrown as a TypeError', async () => {
  await assert.rejects(buildOnGitHub({ token: 't', files: flutterFiles, title: 'x', fetchImpl: async () => { throw new TypeError('fetch failed'); }, sleep: noSleep }), /Could not reach GitHub/);
});

// ── the Settings "Check token" button ───────────────────────────────────────

test('Check token: ok, missing scope, fine-grained, bad token and empty', async () => {
  assert.deepEqual(await checkGitHubToken('t', fakeGitHub().fetchImpl), { ok: true, message: 'Signed in as tester. The token can build APKs (repo and workflow).' });
  const missing = await checkGitHubToken('t', fakeGitHub({ scopes: 'repo' }).fetchImpl);
  assert.equal(missing.ok, false);
  assert.match(missing.message, /lacks: workflow/);
  const fine = await checkGitHubToken('t', fakeGitHub({ scopes: null }).fetchImpl);
  assert.equal(fine.ok, true);
  assert.match(fine.message, /fine-grained/);
  assert.equal((await checkGitHubToken('t', fakeGitHub({ token401: true }).fetchImpl)).ok, false);
  assert.deepEqual(await checkGitHubToken('  '), { ok: false, message: 'Paste a token first.' });
});
