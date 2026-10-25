"""Batch text->3D for Crimson Mist enemies and props (Triverse). TRIVERSE_KEYS from the environment.
    python3 tools/gen_assets.py enemies|props [shard_index shard_count]
Skips what is already in raw/. The word "zombie" is avoided on purpose (image/3D filters)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import triverse_gen as tv

STYLE = 'anime cel-shaded style, game asset, clean colors'
os.environ.setdefault('TV_POLY', '20000')
os.environ.setdefault('TV_TEX', '1024')
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
TPOSE = 'standing in a T-pose with both arms stretched straight out to the sides, full body, front view'
TP_ENEMIES = {
    'z_walker': 'gaunt infected townsperson with glowing red eyes, red veins, tattered clothes, ' + TPOSE,
    'z_bloater': 'bloated infected man with glowing red sacs on his belly, tattered shirt, ' + TPOSE,
    'z_weeper': 'pale ghost girl in a long white dress, long black hair over her face, ' + TPOSE,
    'z_bellkeeper': 'giant hulking monster with a bronze bell fused to its back, red veins, glowing eyes, ' + TPOSE,
}
TP_NPCS = {
    'npc_nurse': 'young anime nurse woman with a white uniform and pink cap, ' + TPOSE,
    'npc_shopkeeper': 'middle aged anime man shopkeeper with a green apron and glasses, ' + TPOSE,
    'npc_priest': 'old anime priest man in a black cassock with a white collar, ' + TPOSE,
    'npc_student': 'anime schoolgirl with a sailor uniform and short brown hair, ' + TPOSE,
    'npc_fisher': 'anime fisherman woman in a yellow raincoat and rubber boots, ' + TPOSE,
    'npc_granny': 'kind anime old grandmother with grey hair bun and a knitted cardigan, ' + TPOSE,
}
TP_HEROES = {
    'hero_a': 'anime girl with long blonde hair, white hooded jacket and black shorts, boots, ' + TPOSE,
    'hero_b': 'anime girl with silver hair and blue eyes, white coat with blue lines, black skirt, ' + TPOSE,
    'hero_c': 'anime fox girl with cat ears, pink hair, black crop jacket, white shorts, a fluffy tail, ' + TPOSE,
    'hero_d': 'anime girl with wavy blonde hair and a red headband, red high-neck leotard, white thigh-high stockings, ' + TPOSE,
}
which = {'enemies': ENEMIES, 'props': PROPS, 'tp_enemies': TP_ENEMIES, 'tp_npcs': TP_NPCS, 'tp_heroes': TP_HEROES}[sys.argv[1]]
idx, cnt = (int(sys.argv[2]), int(sys.argv[3])) if len(sys.argv) > 3 else (0, 1)
ok = True
for i, (name, desc) in enumerate(which.items()):
    if i % cnt != idx:
        continue
    ok &= bool(tv.gen_text(name, f'{desc}, {STYLE}'))
sys.exit(0 if ok else 1)
