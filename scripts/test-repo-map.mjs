/** node --experimental-strip-types --test scripts/test-repo-map.mjs — the project map. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRepoMap, projectView, queryTerms, rankFiles, symbolsOf } from '../src/lib/agent/repo-map.ts';

const TS = `export interface User { id: string }
export const LIMIT = 5;
export function loginUser(name: string): User {
  return { id: name };
}
export const logout = async (u: User) => {};
class Session {
  open() {
    return 1;
  }
  private close(force: boolean) {
    return 0;
  }
}
`;

test('finds functions, types, constants, classes and methods in TypeScript', () => {
  const s = symbolsOf('src/auth.ts', TS);
  const names = s.map((x) => `${x.kind}:${x.name}`);
  assert.deepEqual(names, ['type:User', 'const:LIMIT', 'function:loginUser', 'function:logout', 'class:Session', 'method:open', 'method:close']);
  assert.equal(s.find((x) => x.name === 'loginUser').line, 3);
  assert.ok(s.find((x) => x.name === 'loginUser').signature.startsWith('export function loginUser'));
});

test('Python, GDScript and Kotlin', () => {
  assert.deepEqual(symbolsOf('a.py', 'class A:\n    def go(self):\n        pass\n\ndef run():\n    pass\n').map((x) => x.name), ['A', 'go', 'run']);
  assert.deepEqual(symbolsOf('f.gd', 'class_name Fighter\nsignal hit\nfunc _ready():\n\tpass\nfunc punch(a):\n\tpass\n').map((x) => x.name), ['Fighter', 'hit', '_ready', 'punch']);
  assert.deepEqual(symbolsOf('M.kt', 'class Main {\n  fun start() {}\n}\nprivate fun helper(x: Int) = x\n').map((x) => x.name), ['Main', 'start', 'helper']);
});

test('request words become search terms', () => {
  assert.deepEqual(queryTerms('please fix the loginUser bug in auth'), ['login', 'user', 'auth']);
});

const FILES = [
  { path: 'src/auth.ts', content: TS },
  { path: 'src/ui/Button.tsx', content: 'export function Button() { return null; }\n' },
  { path: 'src/main.ts', content: 'import { loginUser } from "./auth";\nexport function main() { loginUser("a"); }\n' },
  { path: 'assets/logo.png', content: 'data:image/png;base64,AAAA' },
  { path: 'node_modules/x/index.js', content: 'export function junk() {}' },
  { path: 'package-lock.json', content: '{}' },
];

test('files are ranked by the request, binaries and vendor folders are left out', () => {
  const r = rankFiles(FILES, 'fix the login flow');
  assert.equal(r[0].path, 'src/auth.ts');
  assert.ok(!r.some((e) => /logo|node_modules|package-lock/.test(e.path)));
});

test('a file that other files use outranks an unused one, with no request at all', () => {
  const r = rankFiles(FILES, '');
  assert.ok(r.findIndex((e) => e.path === 'src/auth.ts') < r.findIndex((e) => e.path === 'src/ui/Button.tsx'));
});

test('the map shows signatures, most relevant first, within the budget', () => {
  const map = buildRepoMap(FILES, { query: 'login', maxChars: 400 });
  assert.match(map, /^src\/auth\.ts {2}\(\d+ lines\)/);
  assert.match(map, /⋮ export function loginUser/);
  assert.ok(map.length < 700);
  const tiny = buildRepoMap(FILES, { query: 'login', maxChars: 120 });
  assert.match(tiny, /more file/);
});

test('a small project is shown whole; a big one as a map plus the relevant files in full', () => {
  const small = projectView(FILES, { query: 'login', fullChars: 100_000 });
  assert.equal(small.mode, 'whole');
  assert.match(small.text, /### src\/main\.ts/);
  const filler = { path: 'src/other.ts', content: '// filler\n'.repeat(200) + 'export function other() {}\n' };
  const big = projectView([...FILES, filler], { query: 'login', fullChars: 1200 });
  assert.equal(big.mode, 'map');
  assert.match(big.text, /^Project map/);
  assert.ok(big.included.includes('src/auth.ts'));
  assert.ok(!big.included.includes('src/ui/Button.tsx'));
});
