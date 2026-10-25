#!/usr/bin/env node
/**
 * Copies the terminal bridge's own files into public/agent/, so the app can hand them to a bridge that is too old.
 *
 * The bridge is a few plain .mjs files that run on the user's machine or in Termux. When the app finds that one is older than it needs
 * (no key store, say), Settings offers "Update the terminal bridge": the app reads these copies and writes them into the bridge's
 * workspace through the bridge's own file route, then shows the one command that restarts the bridge from the new files.
 * Run before every build (`prebuild`, `predev`, and the Android export), so the copies can never lag the agent.
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'agent');
const to = join(root, 'public', 'agent');

rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });

const files = readdirSync(from).filter((n) => n.endsWith('.mjs')).sort();
for (const n of files) copyFileSync(join(from, n), join(to, n));

const main = readFileSync(join(from, 'chomugiri-agent.mjs'), 'utf8');
const version = /const VERSION = '([^']+)'/.exec(main)?.[1];
if (!version) throw new Error('VERSION not found in agent/chomugiri-agent.mjs');
const sha = createHash('sha256');
for (const n of files) sha.update(readFileSync(join(from, n)));
writeFileSync(join(to, 'manifest.json'), `${JSON.stringify({ version, files, sha256: sha.digest('hex').slice(0, 16) }, null, 2)}\n`);
console.log(`agent ${version}: ${files.length} files → public/agent/`);
