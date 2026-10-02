# The Chomugiri site

<https://chomugiri.vercel.app> — one page (`index.html`) plus `/privacy`.

| Path | What it is |
| --- | --- |
| `index.html`, `css/`, `js/` | The page. `js/demo.js` is the phone replica (HTML, not video); `js/space.js` the three.js solar system; `js/nasa-cards.js` the NASA cards; `js/type.js` the typing effect |
| `js/ephemeris.js` | Planet and Moon positions for any date (JPL Keplerian elements, Meeus Moon). Tested against JPL Horizons in `scripts/test-ephemeris.mjs` |
| `api/nasa.js`, `api/_nasa-lib.js` | The NASA proxy. A narrow door: four kinds (`apod`, `neo`, `epic`, `horizons`), fixed hosts and parameters. The key is `NASA_API_KEY` in the Vercel project environment — never in a file, never in a response |
| `api/blob-upload.js`, `api/gradio.js` | Older routes, unchanged |
| `vendor/three`, `fonts/`, `img/`, `textures/`, `data/` | Everything self-hosted, so the page asks no third party anything. Texture credits are on the page |
| `vercel.json` | Headers: Content-Security-Policy (inline scripts allowed by hash — `scripts/test-website.mjs` fails if the hash drifts), caching |

The three voice recordings are not kept here — they live in `public/voice/` for the app, and `deploy.sh` stages them.

## Look at it locally

    node scripts/dev-site.mjs        # http://localhost:4173, same headers as Vercel, real /api/nasa (reads .env.local)

## Deploy

    VERCEL_TOKEN=… ./site/deploy.sh  # also sets NASA_API_KEY on the project if it is in the environment or .env.local

`cleanUrls` serves `privacy.html` at `/privacy`. `framework: null` and `buildCommand: null` matter: the Vercel
project is shared with the app, so without them Vercel runs `npm run vercel-build` in a directory with no such script.

## Downloads

The buttons link to GitHub release assets that the workflows keep current, so a new build never needs a site deploy:
`chomugiri-latest/Chomugiri.apk` and `latest-apk/ChomuHorizon.apk`. `scripts/test-website.mjs` reads the workflows
and fails if the page and the workflows disagree.

## NASA key

`.env.local` (gitignored) for local runs; `NASA_API_KEY` as a sensitive production variable on Vercel. Without it the
proxy falls back to NASA's shared `DEMO_KEY`, which is rate-limited hard. Rotate it at <https://api.nasa.gov> if it leaks.
