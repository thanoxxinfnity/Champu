"""Batch text->3D for Crimson Mist enemies and props (Triverse). TRIVERSE_KEYS from the environment.
    python3 tools/gen_assets.py enemies|props [shard_index shard_count]
Skips what is already in raw/. The word "zombie" is avoided on purpose (image/3D filters)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import triverse_gen as tv

STYLE = 'anime cel-shaded style, game asset, clean colors'
ENEMIES = {
    'mist_walker': 'gaunt infected townsperson with glowing red eyes, red veins, tattered clothes, arms hanging, standing, full body',
    'crawler': 'infected person crawling on all fours, red veins, tattered clothes, glowing red eyes',
    'bloater': 'bloated infected man with glowing red sacs on belly, tattered shirt, standing, full body',
    'weeper': 'pale ghost girl in long white dress, long black hair over face, standing, full body',
    'bellkeeper': 'giant monster fused with a bronze church bell, red veins, glowing eyes, tall',
}
PROPS = {
    'generator': 'old yellow portable generator, rusty, small',
    'fuel_can': 'red metal fuel jerry can',
    'fuse_box': 'wall electrical fuse box with open door',
    'medkit': 'white first aid kit with red cross',
    'crowbar': 'iron crowbar',
    'flare': 'red emergency road flare stick',
    'radio': 'old desk radio transceiver with antenna',
    'car_wreck': 'abandoned small old car, rusty, flat tires',
    'streetlamp': 'old iron street lamp post',
    'house_small': 'small seaside town house with wooden walls and tiled roof',
    'market_stall': 'wooden market stall with striped awning',
    'crate': 'wooden shipping crate',
    'clinic_bed': 'hospital bed with white sheets',
    'lighthouse': 'white and red striped lighthouse tower',
    'church_bell': 'large bronze church bell hanging in a wooden frame',
    'boat': 'small wooden fishing boat',
}
which = ENEMIES if sys.argv[1] == 'enemies' else PROPS
idx, cnt = (int(sys.argv[2]), int(sys.argv[3])) if len(sys.argv) > 3 else (0, 1)
ok = True
for i, (name, desc) in enumerate(which.items()):
    if i % cnt != idx:
        continue
    ok &= bool(tv.gen_text(name, f'{desc}, {STYLE}'))
sys.exit(0 if ok else 1)
