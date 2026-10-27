"""The open-world set for City Shifter, generated (keys from the environment, never from the repo).
    python3 tools/gen_world.py tv     # Triverse text-to-model: jetpack, horse, vehicles, tyres   -> raw/<name>_tv.glb
    python3 tools/gen_world.py nv     # NVIDIA TRELLIS: jungle, rocks, anime town props           -> raw/<name>_nv.glb
Everything is asked for in one anime cel-shaded look. What exists is skipped."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ANIME = 'anime style, cel shaded, bold clean colors, game asset'
TV = [  # name, prompt, polys
    ('jetpack', 'sci-fi jetpack backpack with two big thrusters and a fuel tank, orange and grey, worn on the back, front view', 12000),
    ('horse', 'a white horse with a brown mane standing still, four straight legs, side view, full body', 20000),
    ('truck_body', 'cargo truck with a cab and flat open bed, blue and white, NO WHEELS, empty wheel wells, hovering body only', 16000),
    ('monster_body', 'monster truck body, red flames paint, very tall, NO WHEELS, big empty wheel wells, body only', 16000),
    ('car_body', 'sporty anime hatchback car, pink and white, NO WHEELS, empty wheel wells, body only', 14000),
    ('tire', 'a single car tyre with a silver rim, standing upright, side view', 4000),
    ('monster_tire', 'a single huge monster truck tyre with deep tread and a black rim, standing upright, side view', 6000),
]
NV = [
    ('tree_jungle_a', 'tall jungle tree with a thick trunk, vines and a big green canopy'),
    ('tree_jungle_b', 'broad tropical tree with buttress roots and dense leaves'),
    ('palm', 'tropical palm tree with a curved trunk and long fronds'),
    ('cherry_tree', 'cherry blossom tree full of pink flowers'),
    ('rock_big', 'large mossy boulder'),
    ('rock_small', 'cluster of three small grey rocks'),
    ('bush', 'round green bush with flowers'),
    ('fern', 'big jungle fern plant'),
    ('torii', 'red japanese torii gate'),
    ('stone_lantern', 'japanese stone lantern toro'),
    ('shop_house', 'small japanese shop building with a tiled roof and paper lanterns'),
    ('road_sign', 'roadside sign post with an arrow'),
    ('vending', 'japanese drink vending machine'),
    ('bridge_arch', 'small arched wooden bridge'),
    ('stable', 'small wooden horse stable with a tiled roof'),
]
which = sys.argv[1] if len(sys.argv) > 1 else ''
ok = True
if which == 'tv':
    import triverse_gen as tv
    lo, hi = (int(sys.argv[2]), int(sys.argv[3])) if len(sys.argv) > 3 else (0, len(TV))     # a slice, so several processes can share the list
    for name, prompt, polys in TV[lo:hi]:
        os.environ['TV_POLY'] = str(polys)
        os.environ['TV_TEX'] = '1024'
        ok &= bool(tv.gen_text(name, f'{prompt}, {ANIME}'))
elif which == 'nv':
    import nv_gen
    for name, prompt in NV:
        ok &= nv_gen.gen(name, f'anime style, cel shaded, vibrant colors, {prompt}, game asset')
sys.exit(0 if ok else 1)
