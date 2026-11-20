/** node --experimental-strip-types --test scripts/test-android-gradle.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeSource } from '../src/lib/suites/android/analyzer.ts';
import { generateAndroidProject } from '../src/lib/suites/android/generator.ts';

const project = () => generateAndroidProject({ analysis: analyzeSource([{ path: 'main.py', content: 'print("hello")\n' }], 'Sample App') });
const file = (p) => project().files.find((f) => f.path === p)?.content ?? '';

test('BACKEND_URL reaches BuildConfig as a valid Kotlin string (a real Gradle build rejected the old line)', () => {
  const gradle = file('app/build.gradle.kts');
  // "\"$backendUrl\"" in Kotlin: the value in quotes, from a variable that exists
  assert.ok(gradle.includes('buildConfigField("String", "BACKEND_URL", "\\"$backendUrl\\"")'), gradle.split('\n').find((l) => l.includes('buildConfigField')));
  assert.ok(!gradle.includes('""${'), 'the quotes were swallowed by the template literal');
  const define = gradle.indexOf('val backendUrl');
  assert.ok(define > 0 && define < gradle.indexOf('android {'), 'defined before it is used');
  assert.ok(gradle.includes('project.findProperty("BACKEND_URL")'));
});

test('every build can be installed over the last: the version code follows the run number CI passes', () => {
  assert.ok(file('app/build.gradle.kts').includes('findProperty("versionCodeOverride")'));
});

test('no template placeholder is left in any generated file', () => {
  for (const f of project().files) assert.ok(!/\$\{(pkg|targetSdk|minSdk|backendUrl)\}/.test(f.content), `${f.path} still has a placeholder`);
});
