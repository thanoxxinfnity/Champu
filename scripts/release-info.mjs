#!/usr/bin/env node
/**
 * Writes site/data/release.json: which build the download buttons hand out.
 *
 * Read from the files themselves — the version from the Android project, the size from the
 * APK that is committed — rather than asked of GitHub at page-load time. GitHub's unauthenticated
 * API is rate-limited per IP and a shared host's IP is exactly the one that runs out, so a page that
 * asked it would intermittently show nothing. deploy.sh runs this before every deploy.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const gradle = readFileSync(join(root, 'android/app/build.gradle.kts'), 'utf8');
const version = /versionName\s*=\s*"([^"]+)"/.exec(gradle)?.[1];
if (!version) throw new Error('versionName not found in build.gradle.kts');

const mb = (file) => (existsSync(file) ? Math.round((statSync(file).size / 1_000_000) * 10) / 10 : null);
const day = (file) => {
  try {
    return execFileSync('git', ['log', '-1', '--format=%cs', '--', file], { cwd: root, encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
};

const info = {
  chomugiri: { version, date: day('releases/Chomugiri.apk'), mb: mb(join(root, 'releases/Chomugiri.apk')) },
  horizon: { version: null, date: null, mb: mb(join(root, 'examples/chomu-horizon/build/ChomuHorizon.apk')) ?? 110 },
};
writeFileSync(join(root, 'site/data/release.json'), `${JSON.stringify(info, null, 2)}\n`);
console.log(JSON.stringify(info));
