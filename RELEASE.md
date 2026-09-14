# Releasing Chomugiri

## The keystore

`dist/chomugiri-release.keystore` signs the app. It is **not** in git, and it
must not be: whoever holds it controls updates to this application id.

Keep a copy somewhere safe, along with the password in
`dist/chomugiri-keystore-password.txt`. Android refuses an update signed with a
different key — losing this file means the app can never be updated, only
published again under a new id, and existing installs cannot upgrade to it.

To make a new one (only for a fresh app id):

```bash
keytool -genkeypair -v \
  -keystore dist/chomugiri-release.keystore -alias chomugiri \
  -keyalg RSA -keysize 4096 -validity 10000
```

## Building a release

```bash
npm run build && node scripts/export-static.mjs

cd android
PW=$(cat ../dist/chomugiri-keystore-password.txt)
gradle assembleRelease \
  -PCHOMUGIRI_KEYSTORE="$PWD/../dist/chomugiri-release.keystore" \
  -PCHOMUGIRI_KEYSTORE_PASSWORD="$PW" \
  -PCHOMUGIRI_KEY_ALIAS=chomugiri \
  -PCHOMUGIRI_KEY_PASSWORD="$PW"
```

The result is `android/app/build/outputs/apk/release/Chomugiri.apk`.

Without the keystore properties the build still runs, but produces an **unsigned**
APK that no phone will install — that is deliberate, so an unsigned build cannot
be handed out by accident.

## Before shipping one

```bash
npm test && npx tsc --noEmit          # 160 tests
cd android && gradle testDebugUnitTest # 58 tests
```

Then confirm the APK is really signed and not debuggable:

```bash
$ANDROID_HOME/build-tools/35.0.0/apksigner verify --print-certs \
  android/app/build/outputs/apk/release/Chomugiri.apk
```

## Version numbers

`versionCode` and `versionName` live in `android/app/build.gradle.kts`. Android
will not install an update whose `versionCode` is not higher than the installed
one, so bump it on every release.
