"""Download CC0 assets from Poly Haven (https://polyhaven.com, public API, no key) into raw/ph/.
    python3 tools/polyhaven.py tex brick_wall_005 asphalt_02 ...      # PBR texture sets: diffuse + normal (GL) + roughness, 2k jpg
    python3 tools/polyhaven.py model Barrel_01 fire_hydrant ...        # glTF + only the textures it references, 1k
    python3 tools/polyhaven.py all                                     # everything the game uses (see TEX / MODELS below)
Poly Haven assets are CC0 (public domain); credit is optional but listed in CREDITS.md."""
import json, os, sys, urllib.request

UA = {'User-Agent': 'curl/8.5.0'}  # the CDN rejects the default urllib agent
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'raw', 'ph')
API = 'https://api.polyhaven.com/files/'

# name -> (game id, resolution)
TEX = {
    'brick_wall_005': ('brick_red', '2k'), 'brick_wall_09': ('brick_dark', '2k'), 'painted_brick': ('brick_paint', '2k'),
    'beige_wall_001': ('plaster_beige', '2k'), 'clay_plaster': ('plaster_clay', '2k'), 'blue_plaster_weathered': ('plaster_blue', '2k'),
    'brown_planks_05': ('planks_brown', '2k'), 'blue_painted_planks': ('planks_blue', '2k'), 'distressed_painted_planks': ('planks_white', '2k'),
    'concrete_block_wall': ('concrete_block', '2k'), 'chipped_concrete': ('concrete', '2k'), 'concrete_floor': ('concrete_floor', '2k'),
    'roof_tiles_14': ('roof_tiles', '2k'), 'grey_roof_tiles': ('roof_grey', '2k'), 'rusty_corrugated_iron': ('roof_iron', '2k'),
    'asphalt_02': ('asphalt', '2k'), 'asphalt_04': ('asphalt_b', '2k'), 'brick_pavement_02': ('pavement', '2k'), 'cobblestone_floor_04': ('cobble', '2k'),
    'forrest_ground_01': ('forest_floor', '2k'), 'grass_path_2': ('grass', '2k'), 'brown_mud_leaves_01': ('mud', '2k'), 'rock_path': ('gravel', '2k'),
    'rocky_terrain': ('rock', '2k'), 'brown_floor_tiles': ('tiles_brown', '2k'), 'checkered_pavement_tiles': ('tiles_check', '2k'), 'blue_floor_tiles_01': ('tiles_blue', '2k'),
    'raw_wooden_floor_01': ('wood_floor', '2k'), 'rusty_metal_02': ('rust', '2k'), 'metal_plate': ('metal', '2k'), 'rusted_shutter': ('shutter', '2k'),
    'rough_pine_door': ('door_wood', '2k'), 'church_bricks_03': ('church_brick', '2k'), 'rustic_stone_wall': ('stone', '2k'),
}
MODELS = {
    'Barrel_01': 'barrel', 'wooden_barrels_01': 'barrels', 'wooden_crate_01': 'crate_a', 'wooden_crate_02': 'crate_b', 'plastic_crate_01': 'crate_plastic',
    'old_tyre': 'tyre', 'fire_hydrant': 'hydrant', 'street_lamp_01': 'lamp_a', 'street_lamp_02': 'lamp_b', 'metal_trash_can': 'bin', 'trashbag': 'trashbag',
    'concrete_road_barrier': 'barrier', 'modular_chainlink_fence': 'fence', 'painted_wooden_bench': 'bench', 'wooden_picnic_table': 'picnic',
    'planter_box_01': 'planter', 'utility_box_01': 'utility_box', 'dutch_ship_medium': 'ship', 'ship_pinnace': 'pinnace', 'modular_wooden_pier': 'pier',
    'lifebuoy': 'lifebuoy', 'ocean_buoy': 'buoy', 'dead_tree_trunk': 'dead_tree', 'dead_tree_trunk_02': 'dead_tree_b', 'fir_tree_01': 'fir',
    'boulder_01': 'boulder', 'wooden_ladder': 'ladder', 'covered_car': 'covered_car', 'hand_truck': 'hand_truck', 'wooden_bucket_01': 'bucket',
    'GothicBed_01': 'bed', 'medical_box': 'medical_box', 'metal_toolbox': 'toolbox', 'Shelf_01': 'shelf', 'SchoolDesk_01': 'desk', 'WoodenChair_01': 'chair',
    'Sofa_01': 'sofa', 'vintage_cabinet_01': 'cabinet', 'drawer_cabinet': 'drawers', 'desk_lamp_arm_01': 'desk_lamp', 'CashRegister_01': 'register',
    'WetFloorSign_01': 'wet_sign', 'wheelchair_01': 'wheelchair', 'hanging_industrial_lamp': 'hang_lamp', 'tool_cart': 'cart', 'cardboard_box_01': 'carton',
    'wooden_lantern_01': 'lantern', 'CoffeeCart_01': 'coffee_cart', 'WoodenTable_01': 'table', 'dining_table': 'dining', 'marble_bust_01': 'bust',
}


def get(url, dst):
    if os.path.exists(dst) and os.path.getsize(dst) > 0:
        return
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r, open(dst, 'wb') as f:
                f.write(r.read())
            return
        except Exception as e:
            if attempt == 3:
                print('FAILED', url, e)
    return


def meta(name):
    with urllib.request.urlopen(urllib.request.Request(API + name, headers=UA), timeout=60) as r:
        return json.load(r)


def tex(name, res='2k'):
    d = meta(name)
    out = os.path.join(ROOT, 'tex', name)
    for key, tag in (('Diffuse', 'diff'), ('nor_gl', 'nor'), ('Rough', 'rough')):
        if key in d and res in d[key]:
            get(d[key][res]['jpg']['url'], os.path.join(out, f'{tag}.jpg'))
    print('tex', name)


def model(name, res='1k'):
    d = meta(name)
    g = d['gltf'][res]['gltf']
    out = os.path.join(ROOT, 'models', name)
    path = os.path.join(out, name + '.gltf')
    get(g['url'], path)
    doc = json.load(open(path))
    uris = [b['uri'] for b in doc.get('buffers', [])] + [i['uri'] for i in doc.get('images', [])]
    for u in uris:
        if u in g['include']:
            get(g['include'][u]['url'], os.path.join(out, u))
    print('model', name)


if __name__ == '__main__':
    kind, names = sys.argv[1], sys.argv[2:]
    with ThreadPoolExecutor(6) as ex:
        if kind == 'all':
            list(ex.map(lambda n: tex(n, TEX[n][1]), TEX))
            list(ex.map(model, MODELS))
        elif kind == 'tex':
            list(ex.map(tex, names))
        else:
            list(ex.map(model, names))
