#!/bin/bash
# Poly Haven models -> assets/ph/*.glb (budgets in tris). needs: python3 tools/polyhaven.py all
cd "$(dirname "$0")/.."
BL=${BLENDER:-/opt/blender-4.2.3/blender}
prep() {  # polyhaven_name game_name budget
  [ -f assets/ph/$2.glb ] && return
  f=raw/ph/models/$1/$1.gltf
  [ -f "$f" ] || { echo "missing $1"; return; }
  $BL -b -P tools/prep_ph.py -- "$f" assets/ph/$2.glb $3 2>&1 | grep -E "SAVED|Error|Traceback"
}
python3 - <<'PY' > /tmp/ph_list.txt
import re,sys
sys.path.insert(0,'tools')
import polyhaven as p
big={'ship':9000,'pinnace':7000,'pier':5000,'fir':3500,'bed':4500,'covered_car':6000,'fence':2500,'dead_tree':3500,'dead_tree_b':3500,'boulder':2500,'sofa':4000,'shelf':3000,'coffee_cart':5000,'lamp_a':3000,'lamp_b':3000,'cabinet':4000,'dining':3000,'table':3000,'bust':3000}
for k,v in p.MODELS.items(): print(k,v,big.get(v,2000))
PY
while read a b c; do prep $a $b $c; done < /tmp/ph_list.txt
