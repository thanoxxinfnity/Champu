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
    # the rest of the garage: ten more cars (bodies only, tyres are mounted in the game)
    ('sports_body', 'low sporty anime supercar, yellow with a black stripe, NO WHEELS, empty wheel wells, body only', 14000),
    ('pickup_body', 'rugged pickup truck with an open bed, green, NO WHEELS, empty wheel wells, body only', 14000),
    ('jeep_body', 'boxy off-road jeep with a spare tyre on the back, desert tan, NO WHEELS, empty wheel wells, body only', 14000),
    ('van_body', 'cute retro delivery van, mint green and white, NO WHEELS, empty wheel wells, body only', 14000),
    ('taxi_body', 'japanese city taxi sedan, yellow with a roof lamp, NO WHEELS, empty wheel wells, body only', 14000),
    ('police_body', 'police patrol car, black and white with roof lights, NO WHEELS, empty wheel wells, body only', 14000),
    ('bus_body', 'long city bus, blue and cream, big windows, NO WHEELS, empty wheel wells, body only', 18000),
    ('firetruck_body', 'red fire engine truck with a ladder on top, NO WHEELS, empty wheel wells, body only', 18000),
    ('buggy_body', 'open dune buggy with a roll cage, orange, NO WHEELS, empty wheel wells, body only', 14000),
    ('ambulance_body', 'white ambulance van with red cross and roof lights, NO WHEELS, empty wheel wells, body only', 14000),
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
    # more trees, each its own species; "no ground" because the generator likes to add a grass slab under them
    ('tree_acacia', 'isolated single acacia savanna tree with a flat wide canopy, no ground, no grass base, no platform'),
    ('tree_pine', 'isolated single tall pine tree with layered dark green branches, no ground, no grass base, no platform'),
    ('tree_maple', 'isolated single red autumn maple tree with a round canopy, no ground, no grass base, no platform'),
    ('tree_willow', 'isolated single weeping willow tree with long hanging branches, no ground, no grass base, no platform'),
    ('tree_baobab', 'isolated single baobab tree with a huge thick trunk and a small crown, no ground, no grass base, no platform'),
    ('tree_jungle_c', 'isolated single giant rainforest tree with hanging vines and orchids, no ground, no grass base, no platform'),
    ('tree_jungle_d', 'isolated single broad leaf tropical tree with big dark green leaves, no ground, no grass base, no platform'),
    ('bamboo', 'isolated bamboo clump with five tall green stalks, no ground, no grass base, no platform'),
    ('banana', 'isolated single banana plant with big leaves and a fruit bunch, no ground, no grass base, no platform'),
    ('flower_patch', 'isolated cluster of colourful anime flowers on stems, no ground, no grass base, no platform'),
    ('log', 'isolated mossy fallen log, no ground, no grass base, no platform'),
    ('tent', 'small colourful camping tent, no ground, no grass base'),
    ('windmill', 'small japanese wooden water mill with a wheel, no ground'),
    ('pagoda', 'small red japanese pagoda tower with curved roofs, no ground'),
    # melee weapons (held props, no ground)
    ('w_hammer_big', 'huge two handed war sledgehammer with a giant square steel head and long wooden handle, anime fantasy weapon, no ground'),
    ('w_hammer', 'medium wooden handled hammer with a steel head, anime style tool weapon, no ground'),
    ('w_katana', 'anime katana sword with a glowing blue edge and black handle, no ground'),
    ('w_axe', 'big battle axe with a double bladed steel head and red handle, anime style, no ground'),
    ('w_spear', 'long anime spear with a gold leaf shaped tip and a red tassel, no ground'),
    # more characters, T-pose for the auto-rig
    ('c_kunoichi', 'anime kunoichi girl ninja with purple scarf, full body standing in T-pose with both arms stretched straight out sideways, front view, plain background'),
    ('c_samurai', 'anime samurai young man in red and black armor, full body standing in T-pose with both arms stretched straight out sideways, front view, plain background'),
    ('c_mage', 'anime mage girl with long white hair and a blue robe, full body standing in T-pose with both arms stretched straight out sideways, front view, plain background'),
    ('c_school', 'anime high school girl in a sailor uniform with short pink hair, full body standing in T-pose with both arms stretched straight out sideways, front view, plain background'),
    ('c_cyber', 'anime cyberpunk boy with neon green jacket and goggles, full body standing in T-pose with both arms stretched straight out sideways, front view, plain background'),
    ('c_pirate', 'anime pirate captain man with a tricorn hat and long coat, full body standing in T-pose with both arms stretched straight out sideways, front view, plain background'),
    ('c_knight', 'anime knight girl in shiny silver armor with a blonde ponytail, full body standing in T-pose with both arms stretched straight out sideways, front view, plain background'),
    ('c_monk', 'anime warrior monk bald man in orange robes, full body standing in T-pose with both arms stretched straight out sideways, front view, plain background'),
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
    lo, hi = (int(sys.argv[2]), int(sys.argv[3])) if len(sys.argv) > 3 else (0, len(NV))
    for name, prompt in NV[lo:hi]:
        ok &= nv_gen.gen(name, f'anime style, cel shaded, vibrant colors, {prompt}, game asset')
sys.exit(0 if ok else 1)
