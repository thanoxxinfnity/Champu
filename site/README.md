# The Chomugiri site

Two static pages — the landing page and the privacy policy — plus the three voice
recordings, which are not kept here: they already live in `public/voice/` for the
app, and a second 10 MB copy in git would be 10 MB of the same bytes. `deploy.sh`
copies them in at deploy time.

    ./site/deploy.sh          # needs VERCEL_TOKEN

Live at <https://chomugiri.vercel.app>, `/privacy` for the policy.

`cleanUrls` is what serves `privacy.html` at `/privacy`. The `framework: null`
and `buildCommand: null` in `vercel.json` matter: the Vercel project is shared
with the app, so without them Vercel runs `npm run vercel-build` against a
directory that has no package.json and the deploy fails.

## The APK

`deploy.sh` publishes one at `/download/<name>.apk` when `APK` points at a file:

    APK=/tmp/ChomuGame-1.0.apk ./site/deploy.sh

It is not kept in git — 28 MB of compiled output that Godot regenerates from the
project on demand. Vercel Blob would be the tidier home, but the token Vercel
hands a project is a v2 envelope that only resolves inside a deployment; using
it from a shell needs a classic `vercel_blob_rw_…` token minted in the
dashboard, which is the user's to create.
