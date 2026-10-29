#!/bin/bash
# Generated hero (raw/hero_<id>_tv.glb, Triverse image-to-3D) -> rigged, heat-weighted assets/cast/<model>.glb.
#   tools/rig_heroes.sh <id> <model> <height> [autorig flags...]
# autorig_obj.py places the skeleton (T-pose or A-pose, measured on the mesh); heat_rig.py replaces its distance weights by bone heat.
set -e
cd "$(dirname "$0")/.."
BL=${BLENDER:-/opt/blender-4.2.3/blender}
id=$1; model=$2; h=$3; shift 3
tmp=$(mktemp -d)
$BL -b -P tools/autorig_obj.py -- raw/hero_${id}_tv.glb $tmp/rig.glb --adaptive --height $h --max-tris 14000 "$@" 2>&1 | grep -E "POSE|BONES|SAVED|Error|Traceback"
$BL -b -P tools/heat_rig.py -- $tmp/rig.glb assets/cast/$model.glb 2>&1 | grep -E "PROXY|HEAT|CAPSULE|UNWEIGHTED|SAVED|Error|Traceback|failed"
# the decimated mesh no longer matches the atlas of the generated model (blotches): bake its colour onto clean UVs from the original
$BL -b -P tools/rebake.py -- raw/hero_${id}_tv.glb assets/cast/$model.glb $tmp/baked.glb 2>&1 | grep -E "REBAK|Error|Traceback"
[ -s $tmp/baked.glb ] && cp $tmp/baked.glb assets/cast/$model.glb
rm -rf $tmp
