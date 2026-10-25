#!/bin/bash
# Re-decimate the Poly Haven props already in assets/ph to phone budgets (triangles). Safe to rerun.
cd "$(dirname "$0")/.."
BL=${BLENDER:-/opt/blender-4.2.3/blender}
while read n b; do
  f=assets/ph/$n.glb
  [ -f $f ] || continue
  cp $f /tmp/slim_$n.glb
  $BL -b -P tools/prep_ph.py -- /tmp/slim_$n.glb $f $b 2>&1 | grep -E "SAVED|Error|Traceback"
  rm -f /tmp/slim_$n.glb
done <<'LIST'
barrel 600
barrels 900
crate_a 400
crate_b 400
crate_plastic 400
tyre 500
hydrant 700
lamp_a 1200
lamp_b 1200
bin 600
trashbag 300
barrier 400
fence 600
bench 400
picnic 600
planter 500
utility_box 400
ship 4000
pinnace 3500
pier 1500
lifebuoy 400
buoy 600
dead_tree 1800
dead_tree_b 1800
fir 1500
ladder 500
covered_car 2500
hand_truck 600
bucket 300
bed 1500
medical_box 400
toolbox 400
desk 700
chair 600
sofa 1500
cabinet 1500
drawers 800
desk_lamp 500
register 600
wheelchair 1200
hang_lamp 600
cart 800
carton 300
lantern 800
coffee_cart 2000
table 700
dining 700
bust 1000
LIST
