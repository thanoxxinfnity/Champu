/** node --experimental-strip-types --test scripts/test-android-resources.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { findMissingResources, repairResources } from '../src/lib/suites/android/resources.ts';

const manifest = (extra = '') => ({
  path: 'app/src/main/AndroidManifest.xml',
  content: `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application android:icon="@mipmap/ic_launcher" android:roundIcon="@mipmap/ic_launcher_round" android:label="Todo" ${extra}>
    <activity android:name=".MainActivity" android:exported="true" />
  </application>
</manifest>`,
});

test('a manifest naming a launcher icon nothing defines is reported as the launcher', () => {
  const missing = findMissingResources([manifest()]);
  assert.deepEqual(
    missing.map((m) => `${m.kind}/${m.name}:${m.launcher}`).sort(),
    ['mipmap/ic_launcher:true', 'mipmap/ic_launcher_round:true'],
  );
});

test('a project that defines its icons is left exactly as written', () => {
  const files = [
    manifest(),
    { path: 'app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml', content: '<adaptive-icon/>' },
    { path: 'app/src/main/res/mipmap-hdpi/ic_launcher_round.png', content: '' },
  ];
  assert.deepEqual(findMissingResources(files), []);
  assert.deepEqual(repairResources(files, 'Todo').files, []);
});

test('repair adds a real adaptive icon, a legacy icon and the layers they use', () => {
  const repair = repairResources([manifest()], 'Todo');
  const paths = repair.files.map((f) => f.path);

  for (const name of ['ic_launcher', 'ic_launcher_round']) {
    assert.ok(paths.includes(`app/src/main/res/mipmap-anydpi-v26/${name}.xml`), `adaptive ${name}`);
    assert.ok(paths.includes(`app/src/main/res/mipmap-anydpi/${name}.xml`), `legacy ${name}`);
    assert.ok(paths.includes(`app/src/main/res/drawable/${name}_bg.xml`), `${name} background`);
    assert.ok(paths.includes(`app/src/main/res/drawable/${name}_fg.xml`), `${name} foreground`);
  }
  assert.deepEqual(repair.launcherIcons.sort(), ['mipmap/ic_launcher', 'mipmap/ic_launcher_round']);
  assert.equal(new Set(paths).size, paths.length, 'no file is emitted twice');
});

test('every layer an adaptive icon points at is itself one of the added files', () => {
  const repair = repairResources([manifest()], 'Todo');
  const paths = new Set(repair.files.map((f) => f.path));
  for (const f of repair.files.filter((x) => x.content.includes('<adaptive-icon'))) {
    for (const m of f.content.matchAll(/@drawable\/([A-Za-z0-9_]+)/g)) {
      assert.ok(paths.has(`app/src/main/res/drawable/${m[1]}.xml`), m[1]);
    }
  }
});

test('the icon is coloured from the app, so two apps do not look identical', () => {
  const a = repairResources([manifest()], 'Todo').files.find((f) => f.path.endsWith('ic_launcher_bg.xml')).content;
  const b = repairResources([manifest()], 'Weather Station').files.find((f) => f.path.endsWith('ic_launcher_bg.xml')).content;
  assert.notEqual(a, b);
  assert.match(a, /fillColor="#[0-9A-F]{6}"/);
});

test('a drawable used from Kotlin or a layout gets a placeholder, reported as one', () => {
  const files = [
    manifest(),
    { path: 'app/src/main/res/mipmap-anydpi/ic_launcher.xml', content: '<vector/>' },
    { path: 'app/src/main/res/mipmap-anydpi/ic_launcher_round.xml', content: '<vector/>' },
    { path: 'app/src/main/java/app/MainActivity.kt', content: 'setImageResource(R.drawable.ic_star)' },
    { path: 'app/src/main/res/layout/main.xml', content: '<ImageView android:src="@drawable/ic_add" />' },
  ];
  const repair = repairResources(files, 'Todo');
  assert.deepEqual(repair.placeholders.sort(), ['drawable/ic_add', 'drawable/ic_star']);
  assert.deepEqual(repair.launcherIcons, []);
  assert.ok(repair.files.every((f) => f.path.startsWith('app/src/main/res/drawable/')));
});

test('the res directory follows the manifest, not an assumed "app" module', () => {
  const files = [{ path: 'mobile/src/main/AndroidManifest.xml', content: manifest().content }];
  const repair = repairResources(files, 'Todo');
  assert.ok(repair.files.length > 0);
  assert.ok(repair.files.every((f) => f.path.startsWith('mobile/src/main/res/')));
});

test('android-namespaced and non-Android files are never touched', () => {
  assert.deepEqual(repairResources([{ path: 'index.html', content: '<img src="@drawable/x">' }], 'Site').files, []);
  const files = [
    { path: 'app/src/main/AndroidManifest.xml', content: '<manifest><application android:icon="@android:drawable/sym_def_app_icon"/></manifest>' },
  ];
  assert.deepEqual(findMissingResources(files), []);
});
