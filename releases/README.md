# Chomugiri release APK

`Chomugiri.apk` here is the **signed** release build. It is built locally (see
`RELEASE.md`) because the signing keystore must never be in git or CI; this
folder only carries the finished file so a workflow can publish it.

Pushing a new `releases/Chomugiri.apk` triggers `.github/workflows/chomugiri-apk-release.yml`,
which publishes it as the `chomugiri-latest` GitHub release — a stable download link.
Current version: see the release title (versionName in `android/app/build.gradle.kts`).
