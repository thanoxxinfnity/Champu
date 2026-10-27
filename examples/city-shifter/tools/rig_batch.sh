#!/bin/bash
# Rig every generated T-pose survivor (raw/<name>_tv.glb, from tools/triverse_gen.py gen) into assets/cast/<name>.glb. Skips what exists.
cd "$(dirname "$0")/.."
BL=${BLENDER:-/opt/blender-4.2.3/blender}
rig() {  # raw_name out height max_tris extra...   (raw/<name>_tv.glb from Triverse, or raw/<name>_nv.glb from NVIDIA TRELLIS)
  local src=raw/$1_tv.glb out=assets/cast/$2.glb h=$3 t=$4
  [ -f "$src" ] || src=raw/$1_nv.glb
  shift 4
  [ -f "$src" ] || { echo "skip $1 (not generated yet)"; return; }
  [ -f "$out" ] && { echo "have $out"; return; }
  $BL -b -P tools/autorig_obj.py -- "$src" "$out" --adaptive --height "$h" --max-tris "$t" "$@" 2>&1 | grep -E "BONES|SAVED|Error|Traceback"
}
mkdir -p assets/cast
rig outlaw outlaw 1.78 5000
rig engineer engineer 1.9 5000
rig ninja ninja 1.75 5000
rig tracker2 tracker2 1.72 5000 --hair
rig mechanic mechanic 1.72 5000 --hair
rig tracker tracker 1.72 5000 --hair
rig c_kunoichi kunoichi 1.65 5000 --hair --flat-mat
rig c_samurai samurai 1.8 5000 --flat-mat
rig c_mage mage 1.62 5000 --hair --flat-mat
rig c_school school 1.6 5000 --hair --flat-mat
rig c_cyber cyber 1.7 5000 --flat-mat
rig c_pirate pirate 1.8 5000 --flat-mat
rig c_knight knight 1.7 5000 --hair --flat-mat
rig c_monk monk 1.75 5000 --flat-mat
