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

# The APK, when one has been built. Not in git — it is tens of megabytes of
# compiled output that Godot can produce again from the project any time.
#
# Published under a fixed name rather than the build's own, so the page's link
# never has to be edited and can never point at a file the last deploy renamed.
# With no APK the whole download section is cut out, because a call-to-action
# that 404s is worse than no call-to-action.
if [ -n "${APK:-}" ]; then
  [ -f "$APK" ] || { echo "APK is set to '$APK', which is not a file." >&2; exit 1; }
  mkdir -p "$stage/download"
  cp "$APK" "$stage/download/ChomuGame.apk"
else
  python3 - "$stage/index.html" <<'TRIM'
import re, sys, pathlib
page = pathlib.Path(sys.argv[1])
page.write_text(re.sub(r'<!--APK-->.*?<!--/APK-->\n?', '', page.read_text(), flags=re.S))
TRIM
fi

cd "$stage"
# Linked by name rather than by a committed .vercel/project.json: the stage is a
# fresh temp directory every time, and without this Vercel would make a new
# project named after the mktemp path.
npx --yes vercel@latest link --yes --project "${VERCEL_PROJECT:-chomugiri}"
npx --yes vercel@latest deploy --prod --yes
