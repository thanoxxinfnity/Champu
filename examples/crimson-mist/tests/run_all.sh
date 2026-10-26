#!/bin/bash
# Runs every headless gate of Crimson Mist; each must print ALL OK.   usage: tests/run_all.sh [godot binary]
GODOT=${1:-godot}
cd "$(dirname "$0")/.."
status=0
for t in smoke rig nav enemy bestiary roof mission stream save ui; do
  [ -f tests/${t}_test.gd ] || [ -f tests/${t}.gd ] || continue
  f=tests/${t}_test.gd; [ -f $f ] || f=tests/${t}.gd
  out=$(timeout 900 $GODOT --headless --fixed-fps 60 --path . -s $f 2>&1)
  verdict=$(echo "$out" | grep -E "^(ALL OK|FAILED)" | tail -1)
  echo "$t: ${verdict:-NO VERDICT}"
  echo "$out" | grep -E "^FAIL|SCRIPT ERROR" | head -10
  [ "$verdict" = "ALL OK" ] || status=1
done
exit $status
