/** node --experimental-strip-types --test scripts/test-activity.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { activityOf } from '../src/lib/agent/activity.ts';
import { describeCommand } from '../src/lib/agent/narrate.ts';

test('each real stage phrase moves the way its work does', () => {
  const cases = {
    'Thinking…': 'think', 'Reasoning…': 'think', 'Writing main.gd…': 'write', 'Writing the answer…': 'write',
    'Running Godot…': 'terminal', 'Downloading from drive.google.com…': 'download', 'Painting 15 surfaces…': 'paint',
    'Compiling the APK on the bridge…': 'build', 'Exporting the Godot project…': 'build', 'Installing packages…': 'build',
    'Researching the live web before building…': 'search', 'Checking the live web…': 'search', 'Deploying to Vercel…': 'deploy',
    'Writing the soundtrack…': 'audio', 'Decomposing into atomic steps...': 'plan', 'Reading what came back…': 'read',
  };
  for (const [phrase, kind] of Object.entries(cases)) assert.equal(activityOf(phrase), kind, phrase);
});

test('terminal commands are described so the bubble can tell a download from a run', () => {
  assert.equal(describeCommand('curl -L https://drive.usercontent.google.com/download?id=x -o f.zip'), 'Downloading from drive.usercontent.google.com…');
  assert.equal(describeCommand('unzip f.zip'), 'Unpacking the archive…');
  assert.equal(activityOf(describeCommand('wget https://github.com/a/b.zip')), 'download');
  assert.equal(activityOf(describeCommand('ls -la')), 'terminal');
});
