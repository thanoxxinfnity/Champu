/** node --experimental-strip-types --test scripts/test-resolve-suite.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSuite } from '../src/lib/agent/router.ts';

test('a build typed into plain chat adopts the suite it is about', () => {
  assert.equal(resolveSuite('chat', 'make me an android app for tracking expenses', 'B'), 'android');
  assert.equal(resolveSuite('chat', 'build the APK for this', 'B'), 'android');
  assert.equal(resolveSuite('chat', 'create a minecraft addon with a ruby sword', 'B'), 'minecraft');
  assert.equal(resolveSuite('chat', 'build a zombie survival shooter game', 'B'), 'godot');
});

test('a Minecraft-themed website is a website, not a Bedrock add-on', () => {
  assert.equal(resolveSuite('chat', 'Make an animated Minecraft-themed website with a player who walks as you scroll', 'B'), 'chat');
  assert.equal(resolveSuite('chat', 'build a landing page for my voxel game', 'B'), 'chat');
});

test('an explicit APK request beats the word website', () => {
  assert.equal(resolveSuite('chat', 'Turn this website into an Android app and build the APK', 'B'), 'android');
});

test('a question is left alone, even one that mentions Android', () => {
  assert.equal(resolveSuite('chat', 'what is the difference between an apk and an aab?', 'A'), 'chat');
});

test('a suite the user already chose is never overridden', () => {
  assert.equal(resolveSuite('minecraft', 'make me an android app', 'B'), 'minecraft');
  assert.equal(resolveSuite('godot', 'build the APK', 'B'), 'godot');
  assert.equal(resolveSuite('game', 'make a shooter', 'B'), 'game');
});

test('ordinary builds stay in chat', () => {
  assert.equal(resolveSuite('chat', 'write a python script that renames files', 'B'), 'chat');
});

test('"runner" and "pack" in ordinary dev work do not summon a game or a Bedrock pack', () => {
  assert.equal(resolveSuite('chat', 'build a test runner for my node project', 'B'), 'chat');
  assert.equal(resolveSuite('chat', 'create a task runner that packs the assets', 'B'), 'chat');
  assert.equal(resolveSuite('chat', 'build a webpack plugin using a resource pack of icons', 'B'), 'chat');
  assert.equal(resolveSuite('chat', 'set up fabric for my deployment', 'B'), 'chat');
});

test('a game has to say it is a game', () => {
  assert.equal(resolveSuite('chat', 'make an endless runner game', 'B'), 'godot');
  assert.equal(resolveSuite('chat', 'build a godot platformer', 'B'), 'godot');
});
