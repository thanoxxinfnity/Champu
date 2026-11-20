/**
 * Write exactly what "build APK on GitHub" would push for a sample project, so CI can run that workflow's own steps.
 *
 *   node --experimental-strip-types scripts/emit-build-sample.mjs <flutter|gradle> <dir>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { planBuild } from '../src/lib/deploy/github.ts';
import { analyzeSource } from '../src/lib/suites/android/analyzer.ts';
import { generateAndroidProject } from '../src/lib/suites/android/generator.ts';

const [kind = 'flutter', dir = '/tmp/chomugiri-sample'] = process.argv.slice(2);

const input = kind === 'flutter'
  ? [
      { path: 'pubspec.yaml', content: 'name: sample_app\ndescription: sample\nversion: 1.0.0+1\nenvironment:\n  sdk: ">=3.4.0 <4.0.0"\ndependencies:\n  flutter:\n    sdk: flutter\nflutter:\n  uses-material-design: true\n' },
      { path: 'lib/main.dart', content: "import 'package:flutter/material.dart';\nvoid main() => runApp(const MaterialApp(home: Scaffold(body: Center(child: Text('hi')))));\n" },
      // things a model must never get into the repository
      { path: '.github/workflows/evil.yml', content: 'on: push\njobs: {}\n' },
      { path: 'android/app/build.gradle', content: 'broken' },
    ]
  : generateAndroidProject({ analysis: analyzeSource([{ path: 'main.py', content: 'print("hello")\n' }], 'Sample App') }).files.map((f) => ({ path: f.path, content: f.content }));

const plan = planBuild(input, 'Sample App', kind);
for (const f of plan.files) {
  const path = join(dir, f.path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, f.content);
}
console.log(`${kind}: wrote ${plan.files.length} files to ${dir}; left out: ${plan.dropped.join(', ') || 'nothing'}`);
