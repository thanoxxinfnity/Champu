/**
 * Write a generated Godot project to disk, so Godot itself can be the test.
 *
 * Unit tests check the strings this suite produces; only the engine can say
 * whether the strings are a game. Every bug worth catching here — a scene that
 * loads with nodes missing, a script that fails to parse, a control that never
 * receives a touch — is silent in a string comparison and obvious in Godot.
 *
 *   node --experimental-strip-types scripts/emit-project.mjs <dir> [genre]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildProject } from '../src/lib/suites/godot/project.ts';

const dir = process.argv[2] ?? '/tmp/chomu-project';
const genre = process.argv[3] ?? 'shooter';

const spec = {
  name: 'Chomu Game',
  dimension: '3d',
  genre,
  view: genre === 'shooter' ? 'first-person' : 'third-person',
  music: false,
};

for (const file of buildProject(spec)) {
  const path = join(dir, file.path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, file.content);
  console.log(' ', file.path, `(${file.content.length} bytes)`);
}
console.log('\nwrote', dir);
