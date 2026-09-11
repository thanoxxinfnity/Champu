#!/usr/bin/env node
/**
 * Static export for the Android shell.
 *
 * The web build needs its `/api/*` routes because a browser cannot call NVIDIA
 * NIM directly — no CORS headers — and the key must stay off the client. Neither
 * constraint exists inside an Android app: a native HTTP client ignores CORS, and
 * the key sits in the user's own device storage.
 *
 * So the Android build strips the route handlers and ships only the client
 * bundle. The APK's embedded HTTP server re-implements the same `/api` contract
 * in Kotlin, which means the web UI runs completely unchanged.
 */

import { cp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const ROOT = process.cwd();
// Staged outside the repo: node's cp refuses to copy a directory into itself.
const STAGE = path.join(os.tmpdir(), 'chomugiri-android-export');
const OUT = process.argv[2] ?? path.join(ROOT, 'android/app/src/main/assets/web');

const SKIP = new Set(['node_modules', '.next', '.git', 'android', 'dist', 'out', 'agent']);

async function stage() {
  await rm(STAGE, { recursive: true, force: true });
  await mkdir(STAGE, { recursive: true });

  await cp(ROOT, STAGE, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(ROOT, src);
      if (!rel) return true;
      const [head] = rel.split(path.sep);
      return !SKIP.has(head);
    },
  });

  // Route handlers cannot exist in a static export.
  await rm(path.join(STAGE, 'src/app/api'), { recursive: true, force: true });

  await writeFile(
    path.join(STAGE, 'next.config.ts'),
    `import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'export',
  reactStrictMode: true,
  poweredByHeader: false,
  // The APK serves from file-backed assets; hashed chunk names make the router's
  // default trailing-slash directories awkward, so keep flat .html output off.
  trailingSlash: true,
  images: { unoptimized: true },
  env: {
    NEXT_PUBLIC_CHOMUGIRI_SHELL: 'android',
  },
};

export default config;
`,
  );

  // The export runs from a copy; node_modules is symlinked to avoid a reinstall.
  const link = path.join(STAGE, 'node_modules');
  if (!existsSync(link)) {
    execFileSync('ln', ['-s', path.join(ROOT, 'node_modules'), link]);
  }
}

async function build() {
  execFileSync('npx', ['next', 'build'], { cwd: STAGE, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } });
}

async function collect() {
  const exported = path.join(STAGE, 'out');
  if (!existsSync(exported)) throw new Error('next build produced no out/ directory');

  await rm(OUT, { recursive: true, force: true });
  await mkdir(path.dirname(OUT), { recursive: true });
  await cp(exported, OUT, { recursive: true });

  // Android's asset packer silently drops files whose names start with `_`,
  // which is exactly what Next names its chunk directory. Rename it and rewrite
  // every reference, or the app loads a blank page.
  const underscore = path.join(OUT, '_next');
  if (existsSync(underscore)) {
    await cp(underscore, path.join(OUT, 'next'), { recursive: true });
    await rm(underscore, { recursive: true, force: true });

    const rewrite = async (dir) => {
      const { readdir } = await import('node:fs/promises');
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await rewrite(full);
        else if (/\.(html|js|json|css|txt)$/.test(entry.name)) {
          const body = await readFile(full, 'utf8');
          if (body.includes('_next')) await writeFile(full, body.replaceAll('/_next', '/next').replaceAll('"_next', '"next'));
        }
      }
    };
    await rewrite(OUT);
  }
}

await stage();
await build();
await collect();
console.log(`\nstatic export → ${OUT}`);
