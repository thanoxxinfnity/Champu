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

cp "$here"/index.html "$here"/privacy.html "$here"/vercel.json "$stage/"
mkdir -p "$stage/voice"
cp "$root"/public/voice/*.wav "$stage/voice/"

cd "$stage"
# Linked by name rather than by a committed .vercel/project.json: the stage is a
# fresh temp directory every time, and without this Vercel would make a new
# project named after the mktemp path.
npx --yes vercel@latest link --yes --project "${VERCEL_PROJECT:-chomugiri}"
npx --yes vercel@latest deploy --prod --yes
