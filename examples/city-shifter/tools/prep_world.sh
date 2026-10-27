#!/bin/bash
# Generated world models (raw/<name>_nv.glb from NVIDIA TRELLIS, raw/<name>_tv.glb from Triverse) -> phone-sized, upright, origin at the bottom centre, front along -Z.
# Delete an output to redo it. Usage: tools/prep_world.sh [yaw overrides in the table below]
cd "$(dirname "$0")/.."
BL=${BLENDER:-/opt/blender-4.2.3/blender}
prep() {  # raw_file out tris tex [yaw]
  [ -f "raw/$1" ] || { echo "skip $1"; return; }
  [ -f "$2" ] && return
  mkdir -p "$(dirname "$2")"
  $BL -b -P tools/prep_sf.py -- "raw/$1" "$2" keep "$3" "$4" $5 2>&1 | grep -E "PREP|Error|Traceback" | head -3
}
W=assets/world
prep tree_jungle_a_nv.glb $W/tree_jungle_a.glb 900 512
prep tree_jungle_b_nv.glb $W/tree_jungle_b.glb 900 512
prep palm_nv.glb $W/palm.glb 700 512
prep cherry_tree_nv.glb $W/cherry_tree.glb 900 512
prep rock_big_nv.glb $W/rock_big.glb 900 512
prep rock_small_nv.glb $W/rock_small.glb 400 512
prep bush_nv.glb $W/bush.glb 400 512
prep fern_nv.glb $W/fern.glb 300 512
prep torii_nv.glb $W/torii.glb 1500 512
prep stone_lantern_nv.glb $W/stone_lantern.glb 800 512
prep shop_house_nv.glb $W/shop_house.glb 3500 1024
prep road_sign_nv.glb $W/road_sign.glb 500 512
prep vending_nv.glb $W/vending.glb 900 512
prep bridge_arch_nv.glb $W/bridge_arch.glb 2500 512
prep stable_nv.glb $W/stable.glb 3000 1024
V=assets/vehicles
prep truck_body_tv.glb $V/truck_body.glb 7000 1024 180
prep monster_body_tv.glb $V/monster_body.glb 7000 1024 180
prep car_body_tv.glb $V/car_body.glb 6000 1024 180
prep tire_tv.glb $V/tire.glb 1500 512
prep monster_tire_tv.glb $V/monster_tire.glb 2500 512
prep jetpack_tv.glb assets/cast/jetpack.glb 3500 1024
