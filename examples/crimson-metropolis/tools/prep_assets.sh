#!/usr/bin/env bash
# Shrink the raw generated models (≈60k triangles each) to game budgets: weld the duplicated seam vertices, then simplify.
#   tools/prep_assets.sh            # everything
#   tools/prep_assets.sh npc_casual # just these
# Raw files stay in assets/generated/raw; the game-ready ones go to assets/generated/lod/ and are what the game loads.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p assets/generated/lod
declare -A TARGET=(
  [npc_business]=10000 [npc_casual]=10000 [npc_street]=10000 [npc_police]=10000
  [car_sedan]=26000 [car_muscle]=26000 [car_police]=26000 [car_hypercar]=26000
  [helicopter]=26000 [skyscraper]=22000 [tower_a]=18000 [tower_b]=18000 [shop_block]=18000
  [bed]=12000 [wardrobe]=9000 [palm_tree]=9000 [streetlight]=4000 [traffic_light]=5000 [briefcase]=5000 [safehouse]=20000
)
names=("$@")
[ ${#names[@]} -eq 0 ] && names=("${!TARGET[@]}")
for n in "${names[@]}"; do
  in="assets/generated/raw/$n.glb"
  [ -f "$in" ] || { echo "skip $n (no raw file)"; continue; }
  # The generators return 60k triangles; ratio is the fraction kept.
  ratio=$(python3 -c "print(min(1.0, ${TARGET[$n]} / 60000))")
  tmp=$(mktemp --suffix=.glb)
  npx --yes @gltf-transform/cli@4 weld "$in" "$tmp" >/dev/null 2>&1
  npx --yes @gltf-transform/cli@4 simplify "$tmp" "assets/generated/lod/$n.glb" --ratio "$ratio" --error 0.002 >/dev/null 2>&1
  rm -f "$tmp"
  echo "$n -> $(du -k assets/generated/lod/$n.glb | cut -f1) KB (ratio $ratio)"
done
