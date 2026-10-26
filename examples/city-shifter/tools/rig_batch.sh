#!/bin/bash
# Rig every generated T-pose survivor (raw/<name>_tv.glb, from tools/triverse_gen.py gen) into assets/cast/<name>.glb. Skips what exists.
cd "$(dirname "$0")/.."
BL=${BLENDER:-/opt/blender-4.2.3/blender}
rig() {  # raw_name out height max_tris extra...
  local src=raw/$1_tv.glb out=assets/cast/$2.glb h=$3 t=$4; shift 4
  [ -f "$src" ] || { echo "skip $1 (not generated yet)"; return; }
  [ -f "$out" ] && { echo "have $out"; return; }
  $BL -b -P tools/autorig_obj.py -- "$src" "$out" --adaptive --height "$h" --max-tris "$t" "$@" 2>&1 | grep -E "BONES|SAVED|Error|Traceback"
}
mkdir -p assets/cast
rig outlaw outlaw 1.78 9000
rig engineer engineer 1.9 9000
rig ninja ninja 1.75 9000
rig tracker2 tracker2 1.72 9000 --hair
rig mechanic mechanic 1.72 9000 --hair
