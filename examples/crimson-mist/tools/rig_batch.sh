#!/bin/bash
# Rig every generated T-pose model that is not rigged yet: enemies + NPCs -> assets/world, stand-in heroes -> assets/cast.
#   tools/rig_batch.sh      (needs raw/*_tv.glb from tools/gen_assets.py tp_enemies|tp_npcs|tp_heroes)
cd "$(dirname "$0")/.."
BL=${BLENDER:-/opt/blender-4.2.3/blender}
rig() {  # raw_name out_path height max_tris extra...
  local src=raw/$1_tv.glb out=$2 h=$3 t=$4; shift 4
  [ -f "$src" ] || { echo "skip $1 (not generated yet)"; return; }
  [ -f "$out" ] && { echo "have $out"; return; }
  $BL -b -P tools/autorig_obj.py -- "$src" "$out" --adaptive --height "$h" --max-tris "$t" "$@" 2>&1 | grep -E "BONES|SAVED|Error|Traceback"
}
mkdir -p assets/world assets/cast
rig z_walker assets/world/rig_mist_walker.glb 1.9 6500
rig z_bloater assets/world/rig_bloater.glb 1.9 7000
rig z_weeper assets/world/rig_weeper.glb 1.9 7000 --hair --skirt
rig z_bellkeeper assets/world/rig_bellkeeper.glb 1.9 10000
for n in nurse shopkeeper priest student fisher granny; do rig npc_$n assets/world/npc_$n.glb 1.62 6000; done
rig hero_a assets/cast/rachel.glb 1.6 14000 --hair
rig hero_b assets/cast/kafu.glb 1.6 14000 --hair
rig hero_c assets/cast/mococo.glb 1.6 14000 --hair
rig hero_d assets/cast/rina.glb 1.6 14000 --hair
