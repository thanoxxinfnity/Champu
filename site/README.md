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
