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
# The upload route. A serverless function alongside a static site, because the
# Blob token only resolves inside a deployment — see site/api/blob-upload.js.
cp -r "$here"/api "$stage/"
mkdir -p "$stage/voice"
cp "$root"/public/voice/*.wav "$stage/voice/"

# No APK is staged any more.
#
# The builds live on Vercel Blob, which is what it is for: thirty megabytes in a
# static deployment is thirty megabytes re-uploaded on every deploy of a page
# that is eight kilobytes. `scripts/upload-blob.mjs` puts them there, the page
# links to them, and the two are deployed independently.
#
# This used to stage the file and cut the whole download section out when there
# was none — which, once the links moved to Blob, silently removed a section
# whose links were already fine.

cd "$stage"
# Linked by name rather than by a committed .vercel/project.json: the stage is a
# fresh temp directory every time, and without this Vercel would make a new
# project named after the mktemp path.
npx --yes vercel@latest link --yes --project "${VERCEL_PROJECT:-chomugiri}"
npx --yes vercel@latest deploy --prod --yes
