#!/bin/bash
# Every downloaded Sketchfab model (raw/sf) -> assets/. Rerun after changing an override below (delete the output to redo one).
cd "$(dirname "$0")/.."
BL=${BLENDER:-/opt/blender-4.2.3/blender}
prep() {  # name out kind tris tex [rot]
  local src=raw/sf/$1.glb out=$2
  [ -f "$src" ] || { echo "skip $1"; return; }
  [ -f "$out" ] && return
  $BL -b -P tools/prep_sf.py -- "$src" "$out" "$3" "$4" "$5" $6 2>&1 | grep -E "PREP|Error|Traceback" | head -3
}
declare -A ROT
mkdir -p assets/weapons assets/train assets/city assets/props
for w in shift_gauntlet vortex_blaster quantum_breaker gravity_carver plasma_magnet sonic_impactor force_gauntlet seismic_rebounder saber_grapple orbital_crush tactical_beamer thermo_vaporizer chrono_sliders nexus_tether meteor_burster; do
  prep w_$w assets/weapons/$w.glb gun 2500 512 "${ROT[$w]}"
done
prep loco assets/train/loco.glb vehicle 9000 1024
prep car_a assets/train/car_a.glb vehicle 7000 1024
prep car_b assets/train/car_b.glb vehicle 6000 1024
prep car_c assets/train/car_c.glb vehicle 7000 1024
for c in a b c d e; do prep city_$c assets/city/city_$c.glb city 9000 1024; done
prep airship assets/props/airship.glb prop 5000 1024
prep lamp assets/props/lamp.glb prop 1500 512
prep crate_a assets/props/crate_a.glb prop 600 512
