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
prep tree_jungle_a_nv.glb $W/tree_jungle_a.glb 650 512
prep tree_jungle_b_nv.glb $W/tree_jungle_b.glb 650 512
prep palm_nv.glb $W/palm.glb 650 512
prep cherry_tree_nv.glb $W/cherry_tree.glb 650 512
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
prep tree_acacia_nv.glb $W/tree_acacia.glb 650 512
prep tree_pine_nv.glb $W/tree_pine.glb 650 512
prep tree_maple_nv.glb $W/tree_maple.glb 650 512
prep tree_willow_nv.glb $W/tree_willow.glb 650 512
prep tree_baobab_nv.glb $W/tree_baobab.glb 650 512
prep tree_jungle_c_nv.glb $W/tree_jungle_c.glb 650 512
prep tree_jungle_d_nv.glb $W/tree_jungle_d.glb 650 512
prep bamboo_nv.glb $W/bamboo.glb 650 512
prep banana_nv.glb $W/banana.glb 650 512
prep flower_patch_nv.glb $W/flower_patch.glb 400 512
prep log_nv.glb $W/log.glb 500 512
prep tent_nv.glb $W/tent.glb 1500 512
prep windmill_nv.glb $W/windmill.glb 3500 1024
prep pagoda_nv.glb $W/pagoda.glb 3500 1024
V=assets/vehicles
# (the car bodies go through tools/prep_vehicles.sh: their wheels are cut off and measured)
prep tire_tv.glb $V/tire.glb 1500 512
prep monster_tire_tv.glb $V/monster_tire.glb 2500 512
prep jetpack_tv.glb assets/cast/jetpack.glb 3500 1024
# melee weapons: like the gauntlets (longest side along -Z); the heavy-headed ones (hammers, axe) come out head-first as they are, the blades and the spear are turned round
for w in hammer hammer_big katana katana2 axe spear; do
  [ -f "assets/weapons/$w.glb" ] && continue
  [ -f "raw/w_${w}_nv.glb" ] || { echo "skip $w"; continue; }
  yaw="0,180,0"; case $w in hammer|hammer_big|axe) yaw="";; esac
  $BL -b -P tools/prep_sf.py -- "raw/w_${w}_nv.glb" "assets/weapons/$w.glb" gun 2500 512 $yaw 2>&1 | grep -E "PREP|Error|Traceback" | head -3
done
