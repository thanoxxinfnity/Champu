#!/usr/bin/env bash
# bash scripts/check-sideload-apk.sh <apk> <expected versionCode>
# The APK must verify, carry the fixed public sideload certificate (the one the generated workflow installs as the debug
# key) and not the runner's own throwaway debug key, and have the version code the workflow was given.
set -euo pipefail
apk="$1"; want_code="$2"
BT="$(ls -d "${ANDROID_HOME:?}"/build-tools/* | sort -V | tail -1)"

"$BT/apksigner" verify --verbose --print-certs "$apk" | tee /tmp/sig.txt
grep -q "CN=Chomugiri Sideload (public)" /tmp/sig.txt || { echo "::error::not signed with the fixed sideload key"; exit 1; }
if grep -q "CN=Android Debug" /tmp/sig.txt; then echo "::error::signed with the runner's debug key"; exit 1; fi

# the certificate in the APK is the one in the keystore the workflow installed
got="$(grep -m1 'certificate SHA-256 digest' /tmp/sig.txt | sed 's/.*: //' | tr 'a-f' 'A-F')"
want="$(keytool -list -v -keystore ~/.android/debug.keystore -storepass android -alias androiddebugkey 2>/dev/null | grep -m1 'SHA256:' | sed 's/.*SHA256: *//' | tr -d ':')"
echo "apk certificate      $got"; echo "installed keystore   $want"
test -n "$got" && test "$got" = "$want"

code="$("$BT/aapt2" dump badging "$apk" | sed -n "s/^package: .*versionCode='\([0-9]*\)'.*/\1/p" | head -1)"
echo "versionCode $code (expected $want_code)"
test "$code" = "$want_code"
echo "sideload signing check passed"
