#!/usr/bin/env bash
# Deploys the static site to Vercel.
#
# The voice recordings are not stored under site/ — they are the same files the
# app ships in public/voice/, so they are staged into a temp copy here rather
# than duplicated in git.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(dirname "$here")"

: "${VERCEL_TOKEN:?set VERCEL_TOKEN (Settings → API Keys, or your Vercel account)}"

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

cp "$here"/index.html "$here"/privacy.html "$here"/vercel.json "$here"/package.json "$stage/"
# The page itself: styles, scripts, the 3D library, pictures, textures, fonts, transcripts.
for dir in css js vendor img textures fonts data; do
  cp -r "$here/$dir" "$stage/$dir"
done
# The serverless routes: /api/nasa (the NASA proxy — its key is the NASA_API_KEY
# environment variable of the Vercel project, never a file) and the Blob upload
# route, a function alongside a static site because the Blob token only resolves
# inside a deployment — see site/api/blob-upload.js.
cp -r "$here"/api "$stage/"
mkdir -p "$stage/voice"
cp "$root"/public/voice/*.wav "$stage/voice/"

# No APK is staged. The page links to the GitHub release assets
# (chomugiri-latest/Chomugiri.apk and latest-apk/ChomuHorizon.apk) which the
# release workflows keep current, so the site never needs redeploying for a new build.

cd "$stage"
# Linked by name rather than by a committed .vercel/project.json: the stage is a
# fresh temp directory every time, and without this Vercel would make a new
# project named after the mktemp path.
npx --yes vercel@latest link --yes --project "${VERCEL_PROJECT:-chomugiri}"

# The NASA key: put into the project's environment (hidden, production only) from the
# shell or from .env.local — never into a file that is deployed or committed.
if [ -z "${NASA_API_KEY:-}" ] && [ -f "$root/.env.local" ]; then
  NASA_API_KEY="$(sed -n 's/^NASA_API_KEY=//p' "$root/.env.local" | tail -n1 | tr -d '"' | tr -d "'")"
fi
if [ -n "${NASA_API_KEY:-}" ]; then
  printf '%s' "$NASA_API_KEY" | npx --yes vercel@latest env add NASA_API_KEY production --sensitive --force --yes >/dev/null 2>&1 \
    && echo "NASA_API_KEY set on the Vercel project" \
    || echo "could not set NASA_API_KEY (is it already set? the /api/nasa route falls back to NASA's shared DEMO_KEY, which is heavily rate-limited)"
else
  echo "NASA_API_KEY not provided — /api/nasa will use NASA's shared DEMO_KEY"
fi

npx --yes vercel@latest deploy --prod --yes
