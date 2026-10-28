"""Hero bodies straight from text through Triverse text-to-model (the hero descriptions of tools/nv_art.py, full body, A-pose), when no
full-body reference image is at hand.   set -a; . ~/.city-shifter-tv.env; set +a; python3 tools/hero_text3d.py outlaw viper ...
-> raw/hero_<id>_tv.glb, then rig with tools/autorig_obj.py (see tools/rig_heroes.sh)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from nv_art import HEROES
import triverse_gen as tv

POSE = ('full body anime style 3D game character, standing straight in an A-pose with both arms held away from the body and legs slightly apart, '
        'whole figure from head to shoes, clean stylised shapes, hands with separate fingers, no base, no weapon in hand')

if __name__ == '__main__':
    ok = True
    for hid in sys.argv[1:]:
        ok = tv.gen_text('hero_' + hid, f'{HEROES[hid]}, {POSE}') and ok
    sys.exit(0 if ok else 1)
