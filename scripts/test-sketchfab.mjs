/** node --experimental-strip-types --test scripts/test-sketchfab.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attribution,
  creditsFile,
  downloadUrlFrom,
  isGlb,
  isUsable,
  modelFrom,
  sketchfabError,
} from '../src/lib/suites/godot/sketchfab.ts';
import { sourceChain, pipelineStatement } from '../src/lib/suites/godot/model-source.ts';

// A real search result, trimmed. Kept verbatim so the readers are tested
// against the shape the API actually sends rather than the one I expected.
const RESULT = {
  uid: '23708528454e43b58e02d78fd427c240',
  name: 'ZOMBIE PICKUP TRUCK',
  viewerUrl: 'https://sketchfab.com/3d-models/none-23708528454e43b58e02d78fd427c240',
  isDownloadable: true,
  animationCount: 1,
  faceCount: 9826,
  license: { uid: '322a', label: 'CC Attribution' },
  user: { username: 'seangorman', displayName: 'seangorman', profileUrl: 'https://sketchfab.com/seangorman' },
  archives: { glb: { size: 3845312, faceCount: 9826 }, gltf: { size: 3512307 } },
  thumbnails: {
    images: [
      { url: 'https://media/50x50.jpeg', width: 50, height: 50 },
      { url: 'https://media/640.jpeg', width: 640, height: 360 },
      { url: 'https://media/1024.jpeg', width: 1024, height: 576 },
    ],
  },
};

test('a real result is read into every field the credit line needs', () => {
  const m = modelFrom(RESULT);
  assert.equal(m.uid, '23708528454e43b58e02d78fd427c240');
  assert.equal(m.author, 'seangorman');
  assert.equal(m.authorUrl, 'https://sketchfab.com/seangorman');
  assert.equal(m.licence, 'CC Attribution');
  assert.equal(m.glbBytes, 3845312);
  assert.equal(m.animations, 1);
  assert.equal(m.downloadable, true);
});

test('the thumbnail picked is the biggest one that is not enormous', () => {
  // The 1024 versions are most of a megabyte each and the list shows them small.
  assert.equal(modelFrom(RESULT).thumbnail, 'https://media/640.jpeg');
});

test('a result missing everything optional still reads', () => {
  const m = modelFrom({ uid: 'x', name: 'y' });
  assert.equal(m.author, 'Unknown');
  assert.equal(m.licence, 'Unknown');
  assert.equal(m.faceCount, 0);
  assert.equal(m.downloadable, false);
  assert.equal(modelFrom({ name: 'no uid' }), null);
  assert.equal(modelFrom(null), null);
});

test('a licence this module has never seen is not shippable', () => {
  // Allow-list, not deny-list: the cost of guessing wrong falls on the user.
  assert.equal(isUsable('CC Attribution'), true);
  assert.equal(isUsable('CC0 Public Domain'), true);
  assert.equal(isUsable('CC Attribution-NonCommercial'), false);
  assert.equal(isUsable('CC Attribution-NonCommercial-ShareAlike'), false);
  assert.equal(isUsable('Editorial Use Only'), false);
  assert.equal(isUsable('Unknown'), false);
});

test('the credit names the author, the model and the licence, with links', () => {
  // CC Attribution requires exactly this, and a pipeline that drops it hands
  // the user a licence violation wearing an asset's clothes.
  const line = attribution(modelFrom(RESULT));
  assert.match(line, /ZOMBIE PICKUP TRUCK/);
  assert.match(line, /seangorman/);
  assert.match(line, /CC Attribution/);
  assert.match(line, /https:\/\/sketchfab\.com\/3d-models/);
  assert.match(line, /https:\/\/sketchfab\.com\/seangorman/);
});

test('the credits file is a file, not a chat message', () => {
  const file = creditsFile([modelFrom(RESULT)]);
  assert.match(file, /^# Credits/);
  assert.match(file, /keep this file with the build/);
  // Nothing to credit means no file at all, rather than an empty heading.
  assert.equal(creditsFile([]), '');
});

test('the download link is found whichever key it arrives under', () => {
  // Reading a working response as a failure tells the user their token is bad
  // when it is not.
  assert.equal(downloadUrlFrom({ glb: { url: 'https://cdn/a.glb' } }).url, 'https://cdn/a.glb');
  assert.equal(downloadUrlFrom({ glb: { uri: 'https://cdn/b.glb' } }).url, 'https://cdn/b.glb');
  assert.equal(downloadUrlFrom({ gltf: { url: 'https://cdn/c.zip' } }).url, 'https://cdn/c.zip');
  assert.match(downloadUrlFrom({}).error, /no \.glb/);
  assert.match(downloadUrlFrom(null).error, /no download links/);
});

test('a 401 says where the token comes from, not what the server said', () => {
  assert.match(sketchfabError(401, '{}'), /sketchfab\.com\/settings\/password/);
  assert.match(sketchfabError(403, '{}'), /Settings → API Keys/);
  assert.match(sketchfabError(429, '{}'), /rate limiting/);
  assert.match(sketchfabError(503, ''), /Not the key/);
  assert.match(sketchfabError(400, '{"detail":"bad uid"}'), /bad uid/);
});

test('an HTML error page is not mistaken for a model', () => {
  // The signed CDN URL can answer 200 with an error document.
  assert.equal(isGlb(new TextEncoder().encode('<!doctype html><html>…')), false);
  assert.equal(isGlb(new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 0, 0, 0, 0, 0])), true);
  assert.equal(isGlb(new Uint8Array(4)), false);
});

test('Sketchfab is offered for characters and never for props', () => {
  // A crate is a crate. Choosing between eight of them is slower than building
  // one, and it spends a download on something nobody looks at.
  assert.deepEqual(sourceChain({ sketchfab: 's', nim: 'n' }, 'character'), ['sketchfab', 'trellis', 'built']);
  assert.deepEqual(sourceChain({ sketchfab: 's', nim: 'n' }, 'prop'), ['trellis', 'built']);
  // And it goes before the generators: one download beats ninety seconds.
  assert.deepEqual(sourceChain({ sketchfab: 's', meshy: 'm', tripo: 't' }, 'character'), [
    'sketchfab',
    'meshy',
    'tripo',
    'built',
  ]);
});

test('the pipeline line names Sketchfab only when the token is set', () => {
  assert.match(pipelineStatement({ sketchfab: 's' }), /Sketchfab/);
  assert.ok(!pipelineStatement({ nim: 'n' }).includes('Sketchfab'));
});
